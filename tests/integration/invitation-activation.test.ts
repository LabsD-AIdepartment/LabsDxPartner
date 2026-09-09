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
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { createPartnerAccess } from '@/server/modules/partners/access';
import { createInvitationActivation } from '@/server/modules/partners/activation';

const config = readCredentialConfig({
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-invitation-secret-only-32-characters',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let access: ReturnType<typeof createPartnerAccess>;
let activation: ReturnType<typeof createInvitationActivation>;
let admin: { id: string; headers: Headers };
const password = 'Synthetic invitation password!';
const username = () => 'invite_' + randomUUID().replaceAll('-', '').slice(0, 17);
const expires = () => new Date(Date.now() + 3600_000).toISOString();
const cookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
async function login(name: string) {
  const r = await credentialHandler(auth)(
    new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password }),
    }),
  );
  expect(r.status).toBe(200);
  return new Headers({ cookie: cookie(r) });
}
async function partner() {
  const id = randomUUID();
  await sql`insert into portal_access.partners(id,name,status) values(${id},'Synthetic agreed partner','active')`;
  return id;
}
async function invite(partnerId?: string) {
  partnerId ??= await partner();
  const request = {
    partnerId,
    recipientName: 'ผู้รับคำเชิญทดสอบ',
    verifiedContactRef: 'verified-test-contact',
    capabilities: ['view_earnings', 'view_content'],
    expiresAt: expires(),
    idempotencyKey: randomUUID(),
  };
  const result = await access.issueActivationInvite(admin.headers, request);
  if (!result.token) throw new Error('Expected fresh test token');
  return { ...result, token: result.token, request };
}
const input = (token: string, name = username()) => ({
  token,
  username: name,
  password,
  passwordConfirmation: password,
});
beforeAll(async () => {
  sql = await connectTestDatabase();
  const [residue] =
    await sql`select to_regprocedure('portal_access.activation_test_failure()') as function`;
  if (residue.function)
    throw new Error(
      'Interrupted isolated failure test left its trigger function; inspect and remove the test residue before rerunning',
    );
  await sql`delete from portal_identity.rate_limits`;
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  const resolve = principalResolver(auth, async () => {});
  access = createPartnerAccess(sql, resolve);
  activation = createInvitationActivation(sql, config, resolve);
  const ctx = await auth.$context;
  const name = username();
  const user = await ctx.internalAdapter.createUser(
    {
      name: 'Synthetic staff',
      username: name,
      email: randomUUID() + '@identity.invalid',
      emailVerified: false,
    },
    { method: 'admin' },
  );
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: await ctx.password.hash(password),
  });
  admin = { id: user.id, headers: await login(name) };
  await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values(${user.id},ARRAY['manage_partners'],true,'synthetic-activation-test')`;
});
afterAll(async () => {
  if (sql) {
    await sql`delete from portal_identity.rate_limits`;
    await sql.end();
  }
});

describe('preapproved invitation activation with real credential and membership storage', () => {
  it('inspection is non-consuming; setup commits exact rights and then native login sees only its partner', async () => {
    const issued = await invite(),
      command = input(issued.token);
    expect(await activation.inspect(issued.token)).toMatchObject({
      partnerName: 'Synthetic agreed partner',
      recipientName: 'ผู้รับคำเชิญทดสอบ',
    });
    await activation.inspect(issued.token);
    expect(
      (await sql`select claimed_at from portal_access.invites where id=${issued.id}`)[0].claimed_at,
    ).toBeNull();
    const result = await activation.register(command);
    expect(result).toMatchObject({ partnerId: issued.partnerId, status: 'active' });
    const headers = await login(command.username);
    expect((await access.session(headers)).memberships.map((v) => v.partnerId)).toEqual([
      issued.partnerId,
    ]);
    expect(
      await access.withPartner(headers, issued.partnerId, 'view_earnings', async () => true),
    ).toBe(true);
    await expect(
      access.withPartner(headers, await partner(), 'view_earnings', async () => true),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const [audit] =
      await sql`select details,result from portal_access.audit where action='activate-invitation' AND target_id=${result.membershipId}`;
    expect(JSON.stringify(audit)).not.toContain(password);
    expect(JSON.stringify(audit)).not.toContain(issued.token);
    expect(audit.details.capabilities).toEqual(['view_content', 'view_earnings']);
    await expect(activation.register(command)).rejects.toMatchObject({ code: 'invalid_invite' });
  });
  it('rejects invalid input and a taken username without consuming the invitation', async () => {
    const first = await invite(),
      firstInput = input(first.token);
    await activation.register(firstInput);
    const next = await invite();
    await expect(
      activation.register({ ...input(next.token), passwordConfirmation: 'different-password' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      activation.register({ ...input(next.token), partnerId: first.partnerId }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      activation.register(input(next.token, firstInput.username.toUpperCase())),
    ).rejects.toMatchObject({ code: 'username_unavailable' });
    expect(
      (await sql`select claimed_at from portal_access.invites where id=${next.id}`)[0].claimed_at,
    ).toBeNull();
    expect((await activation.register(input(next.token))).status).toBe('active');
  });
  it('has one outcome for concurrent redemption', async () => {
    const issued = await invite();
    const commands = [input(issued.token), input(issued.token)];
    const outcomes = await Promise.allSettled(commands.map((c) => activation.register(c)));
    expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await sql`select id from portal_access.memberships where partner_id=${issued.partnerId}`)
        .length,
    ).toBe(1);
    expect(
      (
        await sql`select id from portal_identity.users where username in ${sql(commands.map((c) => c.username))}`
      ).length,
    ).toBe(1);
  });
  it('refuses revoked, expired, suspended and legacy links; old pending claim cannot consume new invitations', async () => {
    const revoked = await invite();
    await access.revokeInvite(admin.headers, {
      partnerId: revoked.partnerId,
      inviteId: revoked.id,
      idempotencyKey: randomUUID(),
    });
    await expect(activation.register(input(revoked.token))).rejects.toMatchObject({
      code: 'invalid_invite',
    });
    const expired = await invite();
    await sql`update portal_access.invites set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where id=${expired.id}`;
    await expect(activation.inspect(expired.token)).rejects.toMatchObject({
      code: 'invalid_invite',
    });
    const suspended = await invite();
    await sql`update portal_access.partners set status='suspended' where id=${suspended.partnerId}`;
    await expect(activation.register(input(suspended.token))).rejects.toMatchObject({
      code: 'invalid_invite',
    });
    const legacy = await access.issueInvite(admin.headers, {
      partnerId: await partner(),
      expiresAt: expires(),
      idempotencyKey: randomUUID(),
    });
    await expect(activation.register(input(legacy.token!))).rejects.toMatchObject({
      code: 'invalid_invite',
    });
    const fresh = await invite();
    await expect(
      access.claimInvite(admin.headers, { token: fresh.token, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'invalid_invite' });
    expect((await activation.register(input(fresh.token))).status).toBe('active');
  });
  it('existing users accept via a fresh session; never merge or silently reactivate memberships', async () => {
    const first = await invite(),
      command = input(first.token),
      created = await activation.register(command);
    const headers = await login(command.username),
      second = await invite();
    await expect(activation.accept(new Headers(), { token: second.token })).rejects.toMatchObject({
      code: 'fresh_auth_required',
    });
    expect((await activation.accept(headers, { token: second.token })).userId).toBe(created.userId);
    const duplicate = await invite(first.partnerId);
    await expect(activation.accept(headers, { token: duplicate.token })).rejects.toMatchObject({
      code: 'membership_exists',
    });
    await sql`update portal_access.memberships set status='suspended' where id=${created.membershipId}`;
    await expect(activation.accept(headers, { token: duplicate.token })).rejects.toMatchObject({
      code: 'membership_exists',
    });
    expect(
      (await sql`select status from portal_access.memberships where id=${created.membershipId}`)[0]
        .status,
    ).toBe('suspended');
    await sql`update portal_identity.sessions set created_at=clock_timestamp()-interval '1 hour' where user_id=${created.userId}`;
    const third = await invite();
    await expect(activation.accept(headers, { token: third.token })).rejects.toMatchObject({
      code: 'fresh_auth_required',
    });
  });
  it('requires staff to issue and does not return the bearer again on replay', async () => {
    const issued = await invite();
    await expect(access.issueActivationInvite(new Headers(), issued.request)).rejects.toMatchObject(
      { code: 'unauthenticated' },
    );
    expect(await access.issueActivationInvite(admin.headers, issued.request)).toMatchObject({
      id: issued.id,
      token: null,
      replayed: true,
    });
    await expect(
      access.issueActivationInvite(admin.headers, { ...issued.request, recipientName: 'changed' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const command = input(issued.token);
    await activation.register(command);
    await expect(
      access.issueActivationInvite(await login(command.username), {
        ...issued.request,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('reissuing for the same verified recipient invalidates the older unused link', async () => {
    const old = await invite();
    const replacement = await invite(old.partnerId);
    await expect(activation.inspect(old.token)).rejects.toMatchObject({ code: 'invalid_invite' });
    expect((await activation.register(input(replacement.token))).status).toBe('active');
    const [audit] =
      await sql`select details from portal_access.audit where action='activation-invite' AND target_id=${replacement.id}`;
    expect(audit.details.replacedInviteIds).toContain(old.id);
  });
  it('rolls back credential, user, membership and token consumption if the final audit insert fails', async () => {
    const issued = await invite(),
      command = input(issued.token);
    // Failure injection is confined to this isolated database and partner, with cleanup in finally.
    await sql.unsafe(
      `CREATE FUNCTION portal_access.activation_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='activate-invitation' AND NEW.partner_id='${issued.partnerId}' THEN RAISE EXCEPTION 'synthetic final audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await sql`CREATE TRIGGER activation_test_failure BEFORE INSERT ON portal_access.audit FOR EACH ROW EXECUTE FUNCTION portal_access.activation_test_failure()`;
    try {
      await expect(activation.register(command)).rejects.toThrow();
      expect(
        (await sql`select id from portal_identity.users where username=${command.username}`).length,
      ).toBe(0);
      expect(
        (await sql`select id from portal_access.memberships where partner_id=${issued.partnerId}`)
          .length,
      ).toBe(0);
      expect(
        (await sql`select claimed_at from portal_access.invites where id=${issued.id}`)[0]
          .claimed_at,
      ).toBeNull();
    } finally {
      await sql`DROP TRIGGER activation_test_failure ON portal_access.audit`;
      await sql`DROP FUNCTION portal_access.activation_test_failure()`;
    }
    expect((await activation.register(command)).status).toBe('active');
  });
});
