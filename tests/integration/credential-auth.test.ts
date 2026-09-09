import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import {
  createCredentialIdentity,
  credentialHandler,
  readCredentialConfig,
} from '@/server/modules/identity/credential-auth';

const config = readCredentialConfig({
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-credential-test-secret-32-chars',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let handle: ReturnType<typeof credentialHandler>;
const users: string[] = [];
const loginName = 'test_' + randomUUID().replaceAll('-', '').slice(0, 18);
const password = 'Synthetic password with spaces!';
function request(path: string, body?: object, cookie?: string, origin = config.BETTER_AUTH_URL) {
  return new Request(config.BETTER_AUTH_URL + '/api/auth' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      origin,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
beforeAll(async () => {
  sql = await connectTestDatabase();
  await sql`delete from portal_identity.rate_limits`;
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  handle = credentialHandler(auth);
  // Seed credential only: native sign-in/session behavior is under test, not invitation activation.
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    {
      name: 'Synthetic partner',
      username: loginName,
      email: `${randomUUID()}@identity.invalid`,
      emailVerified: false,
    },
    { method: 'admin' },
  );
  users.push(user.id);
  await ctx.internalAdapter.createAccount({
    accountId: user.id,
    providerId: 'credential',
    userId: user.id,
    password: await ctx.password.hash(password),
  });
});
afterAll(async () => {
  if (!sql) return;
  for (const id of users) await sql`delete from portal_identity.users where id = ${id}`;
  await sql`delete from portal_identity.rate_limits`;
  await sql.end();
});

describe('D-025 credential adapter on real isolated Postgres', () => {
  it('uses maintained password verification and native secure cookies; logout invalidates DB session', async () => {
    const login = await handle(
      request('/sign-in/username', {
        username: loginName.toUpperCase(),
        password,
        callbackURL: '/overview',
      }),
    );
    expect(login.status).toBe(200);
    expect(login.headers.getSetCookie().join(';')).toMatch(/HttpOnly/);
    expect(login.headers.getSetCookie().join(';')).toMatch(/Secure/);
    const cookie = cookieOf(login);
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(users[0]);
    const [stored] =
      await sql`select password from portal_identity.accounts where user_id=${users[0]}`;
    expect(stored.password).not.toBe(password);
    expect(await (await auth.$context).password.verify({ hash: stored.password, password })).toBe(
      true,
    );
    const logout = await handle(request('/sign-out', {}, cookie));
    expect(logout.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
  it('does not distinguish an unknown username from a wrong password or create a session', async () => {
    const wrong = await handle(
      request('/sign-in/username', { username: loginName, password: 'wrong-password' }),
    );
    const absent = await handle(
      request('/sign-in/username', { username: 'absent_' + loginName.slice(-10), password }),
    );
    expect(wrong.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(await wrong.json()).toEqual(await absent.json());
    expect(wrong.headers.getSetCookie()).toHaveLength(0);
    expect(
      (await sql`select id from portal_identity.sessions where user_id=${users[0]}`).length,
    ).toBe(0);
  });
  it('refuses public signup, social, reset and username enumeration, including the native handler', async () => {
    for (const path of [
      '/sign-up/email',
      '/sign-in/email',
      '/sign-in/social',
      '/link-social',
      '/unlink-account',
      '/set-password',
      '/change-password',
      '/request-password-reset',
      '/reset-password',
      '/update-user',
      '/is-username-available',
    ]) {
      const body = {
        username: loginName,
        password,
        email: 'blocked@identity.invalid',
        name: 'Blocked',
        provider: 'google',
      };
      expect((await handle(request(path, body))).status).toBe(404);
      expect((await auth.handler(request(path, body))).status).toBeGreaterThanOrEqual(400);
    }
    expect((await handle(request('/callback/google?code=unused'))).status).toBe(404);
    expect(
      (await sql`select id from portal_identity.users where email='blocked@identity.invalid'`)
        .length,
    ).toBe(0);
  });
  it('rejects foreign origins and unsafe return destinations before issuing sessions', async () => {
    for (const callbackURL of ['https://evil.example', '//evil.example', '/api/auth/get-session']) {
      expect(
        (await handle(request('/sign-in/username', { username: loginName, password, callbackURL })))
          .status,
      ).toBe(403);
    }
    expect(
      (
        await handle(
          request(
            '/sign-in/username',
            { username: loginName, password },
            undefined,
            'https://evil.example',
          ),
        )
      ).status,
    ).toBe(403);
    const absentOrigin = request('/sign-in/username', { username: loginName, password });
    absentOrigin.headers.delete('origin');
    expect((await handle(absentOrigin)).status).toBe(403);
    expect((await handle(request('/sign-out', {}, undefined, 'https://evil.example'))).status).toBe(
      403,
    );
  });
  it('enforces normalized uniqueness in storage without changing legacy identities', async () => {
    const id = randomUUID();
    await expect(
      sql`insert into portal_identity.users(id,name,email,username) values(${id},'Duplicate',${id + '@identity.invalid'},${loginName})`,
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      sql`insert into portal_identity.users(id,name,email,username) values(${id},'Invalid',${id + '@identity.invalid'},${loginName.toUpperCase()})`,
    ).rejects.toMatchObject({ code: '23514' });
    await sql`insert into portal_identity.users(id,name,email) values(${id},'Legacy',${id + '@identity.invalid'})`;
    users.push(id);
    expect(
      (await sql`select username from portal_identity.users where id=${id}`)[0].username,
    ).toBeNull();
  });
  it('allows only one concurrent creation of the same normalized username', async () => {
    const ctx = await auth.$context;
    const name = 'race_' + randomUUID().replaceAll('-', '').slice(0, 18);
    const results = await Promise.allSettled(
      [name, name.toUpperCase()].map((username) =>
        ctx.internalAdapter.createUser(
          {
            name: 'Race test',
            username,
            email: `${randomUUID()}@identity.invalid`,
            emailVerified: false,
          },
          { method: 'admin' },
        ),
      ),
    );
    for (const result of results) if (result.status === 'fulfilled') users.push(result.value.id);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await sql`select id from portal_identity.users where username=${name}`).length).toBe(1);
  });
  it('limits repeated attempts through the real persisted limiter', async () => {
    await sql`delete from portal_identity.rate_limits`;
    const statuses = [];
    for (let i = 0; i < 12; i++)
      statuses.push(
        (await handle(request('/sign-in/username', { username: loginName, password: 'incorrect' })))
          .status,
      );
    expect(statuses).toContain(429);
  });
});
