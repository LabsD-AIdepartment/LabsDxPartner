import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import { createIdentity } from '@/server/modules/identity/auth';
import {
  identityBindingDigest,
  readIdentityConfig,
} from '@/server/modules/identity/provider-config';
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { createPartnerAccess } from '@/server/modules/partners/access';

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
let probe: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createIdentity>;
let service: ReturnType<typeof createPartnerAccess>;
let resolveSession: ReturnType<typeof principalResolver>;
let admin: Awaited<ReturnType<typeof person>>;
beforeAll(async () => {
  sql = await connectTestDatabase();
  probe = await connectTestDatabase();
  const digest = identityBindingDigest(config);
  await sql`insert into portal_identity.binding(id,namespace_digest) values ('current',${digest}) on conflict(id) do nothing`;
  const [binding] =
    await sql`select namespace_digest from portal_identity.binding where id = 'current'`;
  if (binding?.namespace_digest !== digest) throw new Error('Test namespace is not bound');
  auth = createIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  resolveSession = principalResolver(auth, async () => {
    const [current] =
      await sql`select namespace_digest from portal_identity.binding where id = 'current'`;
    if (current?.namespace_digest !== digest) throw new Error('Test namespace mismatch');
  });
  service = createPartnerAccess(sql, resolveSession);
  admin = await person();
  await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref)
    values (${admin.id},ARRAY['manage_partners'],true,'synthetic-test-provision')`;
});
afterAll(async () => {
  // The disposable project-owned database retains synthetic audited records.
  // Do not disable an append-only trigger merely to make test cleanup convenient.
  if (sql) await sql.end();
  if (probe) await probe.end();
});
async function session(userId: string) {
  const context = await auth.$context;
  const row = await context.internalAdapter.createSession(userId);
  if (!row) throw new Error('Synthetic session creation failed');
  const signature = createHmac('sha256', config.BETTER_AUTH_SECRET)
    .update(row.token)
    .digest('base64');
  return {
    sessionId: row.id,
    headers: new Headers({
      cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(row.token + '.' + signature)}`,
    }),
  };
}
async function person() {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { name: 'Synthetic partner', email: `${randomUUID()}@identity.invalid`, emailVerified: false },
    { method: 'admin' },
  );
  return { id: user.id, ...(await session(user.id)) };
}
async function partner() {
  const id = randomUUID();
  await sql`insert into portal_access.partners(id,name,status) values (${id},'Synthetic partner','active')`;
  return id;
}
const expires = () => new Date(Date.now() + 3_600_000).toISOString();
async function invite(partnerId: string) {
  const result = await service.issueInvite(admin.headers, {
    partnerId,
    expiresAt: expires(),
    idempotencyKey: randomUUID(),
  });
  if (!result.token) throw new Error('Expected new synthetic invitation');
  return { ...result, token: result.token };
}
async function pending() {
  const user = await person(),
    partnerId = await partner(),
    issued = await invite(partnerId);
  const claim = await service.claimInvite(user.headers, {
    token: issued.token,
    idempotencyKey: randomUUID(),
  });
  return { user, partnerId, issued, claim };
}
async function activate(value: Awaited<ReturnType<typeof pending>>) {
  const changed = await service.changeMembership(admin.headers, {
    partnerId: value.partnerId,
    userId: value.user.id,
    expectedRevision: '1',
    status: 'active',
    verifiedContactRef: 'synthetic-known-contact',
    capabilities: ['view_earnings', 'view_content', 'view_statements'],
    idempotencyKey: randomUUID(),
  });
  value.user = { id: value.user.id, ...(await session(value.user.id)) };
  return changed;
}
const read = async (_tx: unknown, scope: { partnerId: string }) => scope.partnerId;

describe('A02 real database authorization; synthetic session setup is not external OAuth acceptance', () => {
  it('rejects unsigned/missing sessions and sessions revoked after identity resolution', async () => {
    await expect(service.session(new Headers())).rejects.toMatchObject({ code: 'unauthenticated' });
    const user = await person();
    const context = await auth.$context;
    await expect(
      service.session(new Headers({ cookie: `${context.authCookies.sessionToken.name}=forged` })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const race = createPartnerAccess(sql, async (headers) => {
      const proof = await resolveSession(headers);
      await sql`delete from portal_identity.sessions where id = ${user.sessionId}`;
      return proof;
    });
    await expect(race.session(user.headers)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('stores only an invitation hash; replay cannot reveal or create another token', async () => {
    const partnerId = await partner(),
      command = { partnerId, expiresAt: expires(), idempotencyKey: randomUUID() };
    const first = await service.issueInvite(admin.headers, command);
    expect(first.token?.length).toBe(43);
    const replay = await service.issueInvite(admin.headers, command);
    expect(replay).toEqual({ id: first.id, partnerId, token: null, replayed: true });
    const rows =
      await sql`select i.token_hash,a.result from portal_access.invites i join portal_access.audit a on a.target_id = i.id where i.id = ${first.id}`;
    expect(rows.length).toBe(1);
    expect(rows[0].token_hash.length).toBe(64);
    expect(JSON.stringify(rows).includes(first.token!)).toBe(false);
    await expect(
      service.issueInvite(admin.headers, {
        ...command,
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('audit JSON round-trips on a plain pool as well as the Drizzle-configured pool', async () => {
    const direct = createPartnerAccess(probe, resolveSession),
      partnerId = await partner();
    const command = { partnerId, expiresAt: expires(), idempotencyKey: randomUUID() };
    const first = await direct.issueInvite(admin.headers, command),
      replay = await direct.issueInvite(admin.headers, command);
    expect(replay).toMatchObject({ id: first.id, replayed: true, token: null });
    const [row] =
      await probe`select result,details from portal_access.audit where target_id = ${first.id}`;
    expect(row.result).toEqual({ id: first.id, partnerId });
    expect(row.details).toEqual({ expiresAt: command.expiresAt });
  });
  it('claim creates pending with no capabilities or financial access', async () => {
    const value = await pending();
    expect(await service.session(value.user.headers)).toMatchObject({
      access: 'pending',
      activePartnerId: null,
      memberships: [],
    });
    await expect(
      service.withPartner(value.user.headers, value.partnerId, 'view_earnings', read),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const [member] =
      await sql`select status,capabilities,verified_contact_ref from portal_access.memberships where id = ${value.claim.membershipId}`;
    expect(member).toEqual({ status: 'pending', capabilities: [], verified_contact_ref: null });
  });
  it('one token consumed concurrently by two accounts creates at most one pending member', async () => {
    const partnerId = await partner(),
      issued = await invite(partnerId),
      users = await Promise.all([person(), person()]);
    const results = await Promise.allSettled(
      users.map((user) =>
        service.claimInvite(user.headers, { token: issued.token, idempotencyKey: randomUUID() }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rows =
      await sql`select status from portal_access.memberships where partner_id = ${partnerId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });
  it('same actor/request replay is idempotent; a new key cannot consume the token twice', async () => {
    const partnerId = await partner(),
      issued = await invite(partnerId),
      user = await person();
    const command = { token: issued.token, idempotencyKey: randomUUID() };
    const first = await service.claimInvite(user.headers, command),
      second = await service.claimInvite(user.headers, command);
    expect(second).toEqual({ ...first, replayed: true });
    await expect(
      service.claimInvite(user.headers, { ...command, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'invalid_invite' });
  });
  it('expired and revoked invitations cannot be consumed', async () => {
    const partnerId = await partner(),
      user = await person(),
      expired = await invite(partnerId),
      revoked = await invite(partnerId);
    await sql`update portal_access.invites set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = ${expired.id}`;
    await service.revokeInvite(admin.headers, {
      partnerId,
      inviteId: revoked.id,
      idempotencyKey: randomUUID(),
    });
    for (const token of [expired.token, revoked.token])
      await expect(
        service.claimInvite(user.headers, { token, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ code: 'invalid_invite' });
  });
  it.each(['active', 'suspended'] as const)(
    'a %s member cannot use a fresh invite to reset their membership',
    async (status) => {
      const value = await pending();
      await activate(value);
      if (status === 'suspended') {
        await service.changeMembership(admin.headers, {
          partnerId: value.partnerId,
          userId: value.user.id,
          expectedRevision: '2',
          status,
          verifiedContactRef: 'synthetic-suspend',
          capabilities: [],
          idempotencyKey: randomUUID(),
        });
        value.user = { id: value.user.id, ...(await session(value.user.id)) };
      }
      const issued = await invite(value.partnerId);
      await expect(
        service.claimInvite(value.user.headers, {
          token: issued.token,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'conflict' });
      const [row] = await sql`select claimed_at from portal_access.invites where id = ${issued.id}`;
      expect(row.claimed_at).toBeNull(); // Claim and membership conflict roll back together.
      const [member] =
        await sql`select status from portal_access.memberships where id = ${value.claim.membershipId}`;
      expect(member.status).toBe(status);
    },
  );
  it('staff requires a current explicit grant and fresh session, never user metadata', async () => {
    const user = await person(),
      partnerId = await partner();
    const command = { partnerId, expiresAt: expires(), idempotencyKey: randomUUID() };
    await expect(service.issueInvite(user.headers, command)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values (${user.id},ARRAY['manage_partners'],true,'synthetic-grant')`;
    await sql`update portal_identity.sessions set created_at = now() - interval '6 minutes' where id = ${user.sessionId}`;
    await expect(service.issueInvite(user.headers, command)).rejects.toMatchObject({
      code: 'fresh_auth_required',
    });
    const fresh = await session(user.id);
    await sql`update portal_access.staff_grants set active = false,revision = revision + 1 where user_id = ${user.id}`;
    await expect(service.issueInvite(fresh.headers, command)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
  it('activates only the exact pending user after verification and invalidates all their old sessions', async () => {
    const value = await pending(),
      secondSession = await session(value.user.id),
      oldHeaders = value.user.headers;
    const another = await person(),
      anotherInvite = await invite(value.partnerId);
    await service.claimInvite(another.headers, {
      token: anotherInvite.token,
      idempotencyKey: randomUUID(),
    });
    const change = await activate(value);
    expect(change.revision).toBe('2');
    const [event] =
      await sql`select details from portal_access.audit where target_id = ${value.claim.membershipId} AND action = 'membership'`;
    expect(event.details).toMatchObject({
      userId: value.user.id,
      sessionsRevoked: 2,
      previous: { status: 'pending', capabilities: [], verified_contact_ref: null, revision: '1' },
      current: { status: 'active', verified_contact_ref: 'synthetic-known-contact', revision: '2' },
    });
    for (const headers of [oldHeaders, secondSession.headers])
      await expect(service.session(headers)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await service.session(another.headers)).toMatchObject({ access: 'pending' });
    expect(
      await service.withPartner(value.user.headers, value.partnerId, 'view_earnings', read),
    ).toBe(value.partnerId);
    await expect(
      service.withPartner(value.user.headers, value.partnerId, 'view_ad_spend', read),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects client-selected foreign partners and direct object scope before calling a reader', async () => {
    const a = await pending(),
      b = await pending();
    await activate(a);
    await activate(b);
    let reached = false;
    await expect(
      service.withPartner(a.user.headers, b.partnerId, 'view_statements', async () => {
        reached = true;
        return 'foreign';
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(reached).toBe(false);
    await expect(service.session(a.user.headers, b.partnerId)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect((await service.session(a.user.headers, a.partnerId)).activePartnerId).toBe(a.partnerId);
  });
  it('rejects ambiguous old membership bodies, missing proof and staff capabilities in partner grants', async () => {
    const value = await pending();
    const command = {
      partnerId: value.partnerId,
      userId: value.user.id,
      expectedRevision: '1',
      status: 'active',
      verifiedContactRef: 'synthetic-contact',
      capabilities: ['view_earnings'],
      idempotencyKey: randomUUID(),
    };
    const { userId: _user, ...ambiguous } = command;
    for (const input of [
      ambiguous,
      { ...command, verifiedContactRef: '' },
      { ...command, expectedRevision: 'not-a-number' },
      { ...command, expectedRevision: '9999999999999999999' },
      { ...command, capabilities: ['manage_partners'] },
    ])
      await expect(service.changeMembership(admin.headers, input)).rejects.toMatchObject({
        code: 'invalid_input',
      });
    await expect(service.changeMembership(value.user.headers, command)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
  it('concurrent membership revisions do not overwrite each other and replay does not increment twice', async () => {
    const value = await pending();
    const command = {
      partnerId: value.partnerId,
      userId: value.user.id,
      expectedRevision: '1',
      status: 'active',
      verifiedContactRef: 'synthetic-contact',
      capabilities: ['view_earnings'],
      idempotencyKey: randomUUID(),
    };
    const commands = [command, { ...command, idempotencyKey: randomUUID() }];
    const results = await Promise.allSettled(
      commands.map((input) => service.changeMembership(admin.headers, input)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const [row] =
      await sql`select permission_revision::text as revision from portal_access.memberships where id = ${value.claim.membershipId}`;
    expect(row.revision).toBe('2');
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    expect((await service.changeMembership(admin.headers, commands[winner])).replayed).toBe(true);
  });
  it('a read holds authorization until its transaction ends, then suspension blocks old and new sessions', async () => {
    const value = await pending();
    await activate(value);
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>((resolve) => {
        release = resolve;
      }),
      ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
    const reading = service.withPartner(
      value.user.headers,
      value.partnerId,
      'view_earnings',
      async (_tx, scope) => {
        entered();
        await hold;
        return scope.partnerId;
      },
    );
    await ready;
    let finished = false;
    const suspending = service
      .changeMembership(admin.headers, {
        partnerId: value.partnerId,
        userId: value.user.id,
        expectedRevision: '2',
        status: 'suspended',
        verifiedContactRef: 'synthetic-suspension',
        capabilities: ['view_earnings'],
        idempotencyKey: randomUUID(),
      })
      .then((result) => {
        finished = true;
        return result;
      });
    try {
      await expect
        .poll(
          async () => {
            const [row] =
              await probe`select count(*)::int as waiting from pg_stat_activity where datname = current_database() AND wait_event_type = 'Lock'`;
            return row.waiting;
          },
          { timeout: 3000 },
        )
        .toBeGreaterThan(0);
      expect(finished).toBe(false);
    } finally {
      release();
    }
    expect(await reading).toBe(value.partnerId);
    expect((await suspending).revision).toBe('3');
    await expect(service.session(value.user.headers)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const newSession = await session(value.user.id);
    expect(await service.session(newSession.headers)).toMatchObject({
      access: 'suspended',
      memberships: [],
    });
    await expect(
      service.withPartner(newSession.headers, value.partnerId, 'view_earnings', read),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('partner-wide suspension denies membership immediately and current revision changes scope', async () => {
    const value = await pending();
    await activate(value);
    const first = await service.withPartner(
      value.user.headers,
      value.partnerId,
      'view_earnings',
      async (_tx, scope) => scope.permissionRevision,
    );
    await sql`update portal_access.partners set revision = revision + 1 where id = ${value.partnerId}`;
    const next = await service.withPartner(
      value.user.headers,
      value.partnerId,
      'view_earnings',
      async (_tx, scope) => scope.permissionRevision,
    );
    expect(next).not.toBe(first);
    await sql`update portal_access.partners set status = 'suspended',revision = revision + 1 where id = ${value.partnerId}`;
    await expect(
      service.withPartner(value.user.headers, value.partnerId, 'view_earnings', read),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('audit is append-only and database constraints reject active grants without contact verification', async () => {
    const value = await pending();
    await expect(
      sql`update portal_access.memberships set status = 'active',capabilities=ARRAY['view_earnings'] where id=${value.claim.membershipId}`,
    ).rejects.toMatchObject({ code: '23514' });
    const [event] =
      await sql`select id from portal_access.audit where target_id = ${value.claim.membershipId}`;
    await expect(
      sql`update portal_access.audit set action = 'changed' where id = ${event.id}`,
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(sql`delete from portal_access.audit where id = ${event.id}`).rejects.toMatchObject(
      { code: 'P0001' },
    );
  });
  it('suspension may clear all capabilities; activation cannot', async () => {
    const value = await pending();
    const command = {
      partnerId: value.partnerId,
      userId: value.user.id,
      expectedRevision: '1',
      status: 'active',
      capabilities: [],
      verifiedContactRef: 'synthetic-clear',
      idempotencyKey: randomUUID(),
    };
    await expect(service.changeMembership(admin.headers, command)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await service.changeMembership(admin.headers, { ...command, status: 'suspended' });
    const [row] =
      await sql`select status,capabilities from portal_access.memberships where id = ${value.claim.membershipId}`;
    expect(row).toEqual({ status: 'suspended', capabilities: [] });
  });
});
