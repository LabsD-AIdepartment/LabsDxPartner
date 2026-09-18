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
import { createPartnerAccess } from '@/server/modules/partners/access';
import { createAccountContactsHttp } from '@/server/http/account-contacts';
import { ContactSnapshot } from '@/contracts/account-contact';

let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let http: ReturnType<typeof createAccountContactsHttp>;
const owned: { userId: string; partnerId: string }[] = [];
const origin = 'https://partner.example.test';
const config = readCredentialConfig({
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: 'synthetic-contacts-secret-at-least-32-chars',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
beforeAll(async () => {
  sql = await connectTestDatabase();
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  http = createAccountContactsHttp(
    createPartnerAccess(
      sql,
      principalResolver(auth, async () => {}),
    ),
    origin,
  );
});
afterAll(async () => {
  // Only this test's random actors; no global cleanup of live/local sessions or rate limits.
  for (const { userId, partnerId } of owned) {
    await sql`delete from portal_access.account_contacts where user_id=${userId} and partner_id=${partnerId}`;
    await sql`delete from portal_access.memberships where user_id=${userId} and partner_id=${partnerId}`;
    await sql`delete from portal_access.partners where id=${partnerId}`;
    await sql`delete from portal_identity.sessions where user_id=${userId}`;
    await sql`delete from portal_identity.users where id=${userId}`;
  }
  await sql.end();
});
async function fixture() {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    {
      name: 'Synthetic Contact Test',
      username: 'contacts_' + randomUUID().slice(0, 8),
      email: randomUUID() + '@identity.invalid',
      emailVerified: false,
    },
    { method: 'admin' },
  );
  const session = await ctx.internalAdapter.createSession(user.id);
  if (!session) throw new Error('Test session missing');
  const cookie = `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(session.token + '.' + createHmac('sha256', config.BETTER_AUTH_SECRET).update(session.token).digest('base64'))}`;
  const partnerId = randomUUID();
  owned.push({ userId: user.id, partnerId });
  await sql`insert into portal_access.partners(id,name,status) values(${partnerId},'Synthetic Contact Partner','active')`;
  await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref) values(${randomUUID()},${partnerId},${user.id},'active',ARRAY['view_content'],'synthetic-verification-evidence')`;
  const query = { partnerId, permissionRevision: 'p1:m1' };
  const command = {
    ...query,
    expectedUserId: user.id,
    expectedRevision: '0',
    contact: { email: 'partner@example.test', phone: '0812345678' },
  };
  const read = (extra = {}, customCookie = cookie) =>
    http(
      new Request(
        origin + '/api/v1/partner/account/contacts?' + new URLSearchParams({ ...query, ...extra }),
        { headers: { cookie: customCookie } },
      ),
    );
  const save = (input: unknown = command, extra: Record<string, string> = {}) =>
    http(
      new Request(origin + '/api/v1/partner/account/contacts', {
        method: 'PUT',
        headers: { cookie, origin, 'content-type': 'application/json', ...extra },
        body: JSON.stringify(input),
      }),
    );
  return { user, partnerId, query, command, read, save, cookie };
}
describe('native self-service account contacts', () => {
  it('persists, normalizes, reads and clears unverified contacts without changing identity', async () => {
    const s = await fixture();
    expect(ContactSnapshot.parse(await (await s.read()).json()).contact).toEqual({
      email: null,
      phone: null,
    });
    const response = await s.save({
      ...s.command,
      contact: { email: ' partner@example.test ', phone: '+66 (81) 234-5678' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const saved = ContactSnapshot.parse(await response.json());
    expect(saved).toMatchObject({
      userId: s.user.id,
      revision: '1',
      verification: 'unverified',
      contact: { email: 'partner@example.test', phone: '+66812345678' },
    });
    expect(await (await s.read()).json()).toEqual(saved);
    const cleared = await s.save({
      ...s.command,
      expectedRevision: '1',
      contact: { email: null, phone: null },
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      revision: '2',
      contact: { email: null, phone: null },
    });
    const [user] =
      await sql`select email,email_verified from portal_identity.users where id=${s.user.id}`;
    expect(user).toEqual({ email: s.user.email, email_verified: false });
    const [member] =
      await sql`select verified_contact_ref from portal_access.memberships where user_id=${s.user.id}`;
    expect(member.verified_contact_ref).toBe('synthetic-verification-evidence');
  });
  it('isolates actors and rejects anonymous, foreign, stale and suspended scopes', async () => {
    const a = await fixture(),
      b = await fixture();
    expect((await a.save()).status).toBe(200);
    expect((await b.read()).status).toBe(200);
    expect(await (await b.read()).json()).toMatchObject({
      revision: '0',
      contact: { email: null, phone: null },
    });
    expect((await a.read({}, '')).status).toBe(401);
    expect((await a.read({}, b.cookie)).status).toBe(403);
    expect((await a.save(a.command, { cookie: b.cookie })).status).toBe(403);
    expect((await a.read({ permissionRevision: 'p1:m2' })).status).toBe(409);
    expect((await a.save({ ...a.command, permissionRevision: 'p1:m2' })).status).toBe(409);
    await sql`update portal_access.memberships set status='suspended' where user_id=${a.user.id}`;
    expect((await a.read()).status).toBe(403);
    expect((await a.save()).status).toBe(403);
  });
  it('rejects cross-origin, malformed, oversized and caller-supplied authority fields', async () => {
    const s = await fixture();
    expect((await s.save(s.command, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await s.save(s.command, { origin: '' })).status).toBe(403);
    expect((await s.save({ ...s.command, userId: s.user.id })).status).toBe(400);
    expect((await s.save({ ...s.command, contact: { email: 'bad', phone: 'abc' } })).status).toBe(
      400,
    );
    expect((await s.save({ ...s.command, verification: 'verified' })).status).toBe(400);
    expect((await s.save({ ...s.command, extra: 'a'.repeat(9000) })).status).toBe(413);
    expect((await s.read({ unknown: 'x' })).status).toBe(400);
    expect(await (await s.read()).json()).toMatchObject({ revision: '0' });
  });
  it('refuses a stale form after another tab signs into a different member of the same partner', async () => {
    const a = await fixture(),
      b = await fixture();
    await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref)
      values(${randomUUID()},${a.partnerId},${b.user.id},'active',ARRAY['view_content'],'synthetic-contact')`;
    try {
      expect((await a.save(a.command, { cookie: b.cookie })).status).toBe(409);
      expect(
        await sql`select user_id from portal_access.account_contacts where partner_id=${a.partnerId}`,
      ).toHaveLength(0);
    } finally {
      await sql`delete from portal_access.account_contacts where partner_id=${a.partnerId} and user_id=${b.user.id}`;
      await sql`delete from portal_access.memberships where partner_id=${a.partnerId} and user_id=${b.user.id}`;
    }
  });
  it('serializes competing creates and updates with a single winner, preserving the saved value', async () => {
    const s = await fixture();
    const first = await Promise.all([
      s.save(),
      s.save({ ...s.command, contact: { email: 'second@example.test', phone: null } }),
    ]);
    expect(first.map((r) => r.status).sort()).toEqual([200, 409]);
    const before = await (await s.read()).json();
    expect((await s.save()).status).toBe(409);
    expect(await (await s.read()).json()).toEqual(before);
    const next = await Promise.all([
      s.save({ ...s.command, expectedRevision: '1' }),
      s.save({ ...s.command, expectedRevision: '1', contact: { email: null, phone: null } }),
    ]);
    expect(next.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await (await s.read()).json()).toMatchObject({ revision: '2' });
  });
});
