import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import {
  createCredentialIdentity,
  readCredentialConfig,
} from '@/server/modules/identity/credential-auth';
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { credentialSessionHandler } from '@/server/modules/identity/credential-session';
import { createAccessHttp } from '@/server/http/access';
let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let http: ReturnType<typeof createAccessHttp>;
const owned: { userId: string; partnerId: string }[] = [];
const origin = 'https://partner.example.test';
const password = 'Synthetic identity password!';
const config = readCredentialConfig({
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: 'synthetic-identity-secret-at-least-32-chars',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
beforeAll(async () => {
  sql = await connectTestDatabase();
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  http = createAccessHttp(
    sql,
    config,
    principalResolver(auth, async () => {}),
    async () => {},
  );
});
afterAll(async () => {
  for (const { userId, partnerId } of owned) {
    await sql`delete from portal_identity.password_resets where user_id=${userId}`;
    await sql`delete from portal_access.memberships where user_id=${userId}`;
    await sql`delete from portal_access.partners where id=${partnerId}`;
    await sql`delete from portal_identity.users where id=${userId}`;
  }
  // Retain append-only synthetic audit records. Never clear shared rate limits or real sessions.
  await sql.end();
});
async function fixture() {
  const ctx = await auth.$context;
  const username = 'identity_' + randomUUID().slice(0, 8);
  const user = await ctx.internalAdapter.createUser(
    {
      name: 'Synthetic Partner',
      username,
      email: randomUUID() + '@identity.invalid',
      emailVerified: false,
    },
    { method: 'admin' },
  );
  await ctx.internalAdapter.createAccount({
    accountId: user.id,
    providerId: 'credential',
    userId: user.id,
    password: await ctx.password.hash(password),
  });
  const session = await ctx.internalAdapter.createSession(user.id);
  if (!session) throw new Error('No test session');
  const cookie = `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(session.token + '.' + createHmac('sha256', config.BETTER_AUTH_SECRET).update(session.token).digest('base64'))}`;
  const partnerId = randomUUID();
  owned.push({ userId: user.id, partnerId });
  await sql`insert into portal_access.partners(id,name,status) values(${partnerId},'Synthetic Identity Partner','active')`;
  await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref) values(${randomUUID()},${partnerId},${user.id},'active',ARRAY['view_content'],'synthetic-evidence')`;
  const command = {
    expectedUserId: user.id,
    partnerId,
    permissionRevision: 'p1:m1',
    expectedName: user.name,
    expectedUsername: username,
    name: 'ชื่อใหม่ ทดสอบ',
    username: 'new_' + randomUUID().slice(0, 8),
    currentPassword: password,
    idempotencyKey: randomUUID(),
  };
  const save = (patch: object = {}, headers: Record<string, string> = {}) =>
    http(
      new Request(origin + '/api/access/account/identity', {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ ...command, ...patch }),
      }),
    );
  const login = (name: string) =>
    credentialSessionHandler(
      sql,
      config,
      auth,
    )(
      new Request(origin + '/api/auth/sign-in/username', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: name, password }),
      }),
    );
  return { user, partnerId, username, command, cookie, save, login };
}
describe('controlled native identity changes', () => {
  it('persists native name/username, retains password, revokes all sessions and pending reset links, and authenticates only new username', async () => {
    const s = await fixture();
    await (await auth.$context).internalAdapter.createSession(s.user.id);
    await sql`insert into portal_identity.password_resets(id,user_id,partner_id,membership_revision,verified_contact_ref,verification_evidence_ref,token_hash,created_by,issuer_revision,expires_at) values(${randomUUID()},${s.user.id},${s.partnerId},1,'synthetic','synthetic',${randomUUID().replaceAll('-', '').repeat(2)},${s.user.id},1,clock_timestamp()+interval '1 hour')`;
    const response = await s.save();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'requires-login' });
    const [user] =
      await sql`select name,username,email from portal_identity.users where id=${s.user.id}`;
    expect(user).toEqual({
      name: s.command.name,
      username: s.command.username,
      email: s.user.email,
    });
    expect(
      await sql`select id from portal_identity.sessions where user_id=${s.user.id}`,
    ).toHaveLength(0);
    const [reset] =
      await sql`select revoked_at from portal_identity.password_resets where user_id=${s.user.id}`;
    expect(reset.revoked_at).not.toBeNull();
    const [audit] =
      await sql`select details from portal_identity.method_audit where actor_id=${s.user.id}`;
    expect(audit.details).toMatchObject({ nameChanged: true, usernameChanged: true });
    expect(JSON.stringify(audit)).not.toContain(password);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: s.cookie }) })).toBeNull();
    expect((await s.login(s.username)).status).toBe(401);
    expect((await s.login(s.command.username.toUpperCase())).status).toBe(200);
    expect((await s.save()).status).toBe(401);
  });
  it('rejects wrong password, username collision and stale forms without mutating credentials or sessions', async () => {
    const a = await fixture(),
      b = await fixture();
    for (const [patch, status] of [
      [{ currentPassword: 'incorrect' }, 400],
      [{ username: b.username }, 409],
      [{ expectedName: 'Stale name' }, 409],
      [{ expectedUsername: 'stale_user' }, 409],
      [{ permissionRevision: 'p1:m2' }, 409],
    ] as const)
      expect((await a.save(patch)).status).toBe(status);
    const [row] = await sql`select name,username from portal_identity.users where id=${a.user.id}`;
    expect(row).toEqual({ name: a.user.name, username: a.username });
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie: a.cookie }) }),
    ).not.toBeNull();
  });
  it('enforces origin, anonymous and actor/scope boundaries, strict body and suspended memberships', async () => {
    const a = await fixture(),
      b = await fixture();
    expect((await a.save({}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await a.save({}, { cookie: '' })).status).toBe(401);
    expect((await a.save({}, { cookie: b.cookie })).status).toBe(409);
    expect((await a.save({ partnerId: b.partnerId })).status).toBe(403);
    expect((await a.save({ admin: true })).status).toBe(400);
    await sql`update portal_access.memberships set status='suspended' where user_id=${a.user.id}`;
    expect((await a.save()).status).toBe(403);
  });
  it('serializes concurrent saves with one committed identity and no partial second update', async () => {
    const s = await fixture();
    const results = await Promise.all([
      s.save(),
      s.save({ name: 'Concurrent other', idempotencyKey: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(1);
    expect(
      await sql`select id from portal_identity.method_audit where actor_id=${s.user.id}`,
    ).toHaveLength(1);
  });
});
