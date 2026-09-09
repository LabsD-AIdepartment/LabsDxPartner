import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { toNextJsHandler } from 'better-auth/next-js';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import { createIdentity } from '@/server/modules/identity/auth';
import { readIdentityConfig } from '@/server/modules/identity/provider-config';

const config = readIdentityConfig({
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-integration-secret-32-chars-only',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
  GOOGLE_CLIENT_ID: 'test-google',
  GOOGLE_CLIENT_SECRET: 'test-only',
  LINE_CLIENT_ID: 'test-line',
  LINE_CLIENT_SECRET: 'test-only',
  APPLE_CLIENT_ID: 'test-apple',
  APPLE_TEAM_ID: 'test-team',
  APPLE_CLIENT_SECRET: 'test-only',
});
let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createIdentity>;
const users: string[] = [];
const states: string[] = [];
beforeAll(async () => {
  sql = await connectTestDatabase();
  auth = createIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
});
afterAll(async () => {
  if (!sql) return;
  for (const id of users) await sql`delete from portal_identity.users where id = ${id}`;
  for (const id of states)
    await sql`delete from portal_identity.verifications where identifier = ${id}`;
  await sql.end();
});

describe('real isolated Postgres through maintained auth adapter; external providers not simulated as accepted', () => {
  it('persists OAuth state, refuses wrong browser and consumes cancellation once', async () => {
    const handler = toNextJsHandler(auth);
    const start = await handler.POST(
      new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/social', {
        method: 'POST',
        headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'line', callbackURL: '/access/pending' }),
      }),
    );
    expect(start.status).toBe(200);
    const state = new URL((await start.json()).url).searchParams.get('state')!;
    states.push(state);
    expect(
      (await sql`select id from portal_identity.verifications where identifier = ${state}`).length,
    ).toBe(1);
    const callback =
      config.BETTER_AUTH_URL +
      '/api/auth/callback/line?' +
      new URLSearchParams({ state, error: 'access_denied' });
    const wrong = await handler.GET(new Request(callback));
    expect(wrong.headers.get('location')).toContain('state_mismatch');
    const cookie = start.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const canceled = await handler.GET(new Request(callback, { headers: { cookie } }));
    expect(canceled.headers.get('location')).toContain('access_denied');
    expect(
      (await sql`select id from portal_identity.verifications where identifier = ${state}`).length,
    ).toBe(0);
    const replay = await handler.GET(new Request(callback, { headers: { cookie } }));
    expect(replay.headers.get('location')).toContain('state_mismatch');
  });
  it('reads sessions from DB, refuses forged cookies and sees immediate revocation', async () => {
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      {
        name: 'Synthetic integration',
        email: `${randomUUID()}@identity.invalid`,
        emailVerified: false,
      },
      { method: 'admin' },
    );
    users.push(user.id);
    const session = await context.internalAdapter.createSession(user.id);
    if (!session) throw new Error('Session creation failed');
    // Fixture signing is solely test setup; actual OAuth success remains a provider gate.
    const signature = createHmac('sha256', config.BETTER_AUTH_SECRET)
      .update(session.token)
      .digest('base64');
    const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(session.token + '.' + signature)}`;
    const headers = new Headers({ cookie });
    expect((await auth.api.getSession({ headers }))?.user.id).toBe(user.id);
    expect(
      await auth.api.getSession({
        headers: new Headers({ cookie: `${context.authCookies.sessionToken.name}=forged` }),
      }),
    ).toBeNull();
    await sql`delete from portal_identity.sessions where id = ${session.id}`;
    expect(await auth.api.getSession({ headers })).toBeNull();
  });
  it('enforces unique provider subject across two users under concurrent inserts', async () => {
    const context = await auth.$context;
    const pair = await Promise.all(
      [0, 1].map(() =>
        context.internalAdapter.createUser(
          { name: 'Synthetic', email: `${randomUUID()}@identity.invalid`, emailVerified: false },
          { method: 'admin' },
        ),
      ),
    );
    users.push(...pair.map((row) => row.id));
    const subject = randomUUID();
    const attempts = await Promise.allSettled(
      pair.map(
        (row) =>
          sql`insert into portal_identity.accounts(id,user_id,provider_id,account_id) values (${randomUUID()},${row.id},'line',${subject})`,
      ),
    );
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      (
        await sql`select id from portal_identity.accounts where provider_id = 'line' and account_id = ${subject}`
      ).length,
    ).toBe(1);
  });
});
