import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import {
  createCredentialIdentity,
  readCredentialConfig,
} from '@/server/modules/identity/credential-auth';
import { credentialSessionHandler } from '@/server/modules/identity/credential-session';
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { createPasswordService } from '@/server/modules/identity/passwords';

const config = readCredentialConfig({
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-password-tests-only-32-characters',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
const oldPassword = 'Synthetic old password!',
  newPassword = 'Synthetic new password!';
let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let handle: ReturnType<typeof credentialSessionHandler>;
let service: ReturnType<typeof createPasswordService>;
let admin: { id: string; username: string; headers: Headers };
const cookie = (r: Response) =>
  new Headers({
    cookie: r.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
  });
async function login(username: string, password = oldPassword, origin = config.BETTER_AUTH_URL) {
  return handle(
    new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  );
}
async function user() {
  const ctx = await auth.$context,
    username = 'pw_' + randomUUID().replaceAll('-', '').slice(0, 20);
  const u = await ctx.internalAdapter.createUser(
    {
      name: 'Synthetic account',
      username,
      email: randomUUID() + '@identity.invalid',
      emailVerified: false,
    },
    { method: 'admin' },
  );
  await ctx.internalAdapter.createAccount({
    userId: u.id,
    accountId: u.id,
    providerId: 'credential',
    password: await ctx.password.hash(oldPassword),
  });
  const response = await login(username);
  expect(response.status).toBe(200);
  return { id: u.id, username, headers: cookie(response) };
}
async function target() {
  const u = await user(),
    partnerId = randomUUID();
  await sql`insert into portal_access.partners(id,name,status) values(${partnerId},'Synthetic agreed partner','active')`;
  await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref) values(${randomUUID()},${partnerId},${u.id},'active',ARRAY['view_earnings'],'verified-contact')`;
  return {
    ...u,
    command: {
      partnerId,
      userId: u.id,
      expectedRevision: '1',
      verifiedContactRef: 'verified-contact',
      verificationEvidenceRef: 'support-verification:test',
      idempotencyKey: randomUUID(),
    },
  };
}
async function issue(t: Awaited<ReturnType<typeof target>>) {
  const r = await service.issue(admin.headers, t.command);
  if (!r.token) throw new Error('Expected new synthetic token');
  return { ...r, token: r.token };
}
const reset = (token: string) => ({
  token,
  password: newPassword,
  passwordConfirmation: newPassword,
});
beforeAll(async () => {
  sql = await connectTestDatabase();
  const [residue] =
    await sql`select to_regprocedure('portal_identity.password_test_failure()') as function`;
  if (residue.function)
    throw new Error('Interrupted password audit failure test; inspect residue before rerunning');
  await sql`delete from portal_identity.rate_limits`;
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  handle = credentialSessionHandler(sql, config, auth);
  service = createPasswordService(
    sql,
    config,
    principalResolver(auth, async () => {}),
  );
  admin = await user();
  await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values(${admin.id},ARRAY['manage_partners'],true,'synthetic-password-test')`;
});
beforeEach(async () => {
  await sql`delete from portal_identity.rate_limits`;
});
afterAll(async () => {
  if (sql) {
    await sql`delete from portal_identity.rate_limits`;
    await sql.end();
  }
});

describe('verified recovery and native credential sessions', () => {
  it('times out a body that never completes and cancels the stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = await handle(
      new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
        method: 'POST',
        headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(408);
    expect(cancelled).toBe(true);
  });

  it('reads a bounded body before waiting for the account writer lock', async () => {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(981705,2)`;
      const response = await handle(
        new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
          method: 'POST',
          headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
          body: 'x'.repeat(8193),
        }),
      );
      expect(response.status).toBe(413);
    });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const pending = handle(
      new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
        method: 'POST',
        headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    try {
      await new Promise((r) => setTimeout(r, 20));
      const [row] = await sql`select pg_try_advisory_xact_lock(981705,2) as acquired`;
      expect(row.acquired).toBe(true);
    } finally {
      controller.enqueue(new TextEncoder().encode('{}'));
      controller.close();
    }
    expect((await pending).status).toBe(400);
  });

  it('issue/inspect are non-mutating to credentials; single-use reset revokes all old sessions with secret-free audit', async () => {
    const t = await target(),
      issued = await issue(t);
    expect(await service.inspect(issued.token)).toMatchObject({ username: t.username });
    expect(await auth.api.getSession({ headers: t.headers })).not.toBeNull();
    expect(await service.issue(admin.headers, t.command)).toMatchObject({
      id: issued.id,
      token: null,
    });
    const other = cookie(await login(t.username));
    expect(await service.reset(reset(issued.token))).toEqual({ status: 'requires-login' });
    expect(await auth.api.getSession({ headers: t.headers })).toBeNull();
    expect(await auth.api.getSession({ headers: other })).toBeNull();
    expect((await login(t.username)).status).toBe(401);
    expect((await login(t.username, newPassword)).status).toBe(200);
    await expect(service.reset(reset(issued.token))).rejects.toMatchObject({
      code: 'invalid_reset',
    });
    const rows =
      await sql`select details,result from portal_identity.method_audit where target_id=${t.id}`;
    const text = JSON.stringify(rows);
    for (const secret of [oldPassword, newPassword, issued.token])
      expect(text).not.toContain(secret);
    expect(rows).toHaveLength(2);
  });
  it('requires fresh authorized staff and the exact verified active account; excludes staff recovery', async () => {
    const t = await target();
    await expect(service.issue(t.headers, t.command)).rejects.toMatchObject({ code: 'forbidden' });
    for (const wrong of [
      { verifiedContactRef: 'different-contact' },
      { expectedRevision: '2' },
      { userId: admin.id },
    ]) {
      await expect(service.issue(admin.headers, { ...t.command, ...wrong })).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values(${t.id},ARRAY['manage_partners'],false,'synthetic-staff-target')`;
    await expect(service.issue(admin.headers, t.command)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const staleAdmin = await user();
    await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values(${staleAdmin.id},ARRAY['manage_partners'],true,'synthetic-stale-staff')`;
    await sql`update portal_identity.sessions set created_at=now()-interval '6 minutes' where user_id=${staleAdmin.id}`;
    await expect(service.issue(staleAdmin.headers, t.command)).rejects.toMatchObject({
      code: 'fresh_auth_required',
    });
  });
  it('reissue replaces previous link; idempotency key cannot change target or verification', async () => {
    const t = await target(),
      first = await issue(t);
    await expect(
      service.issue(admin.headers, { ...t.command, verificationEvidenceRef: 'changed-proof' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const next = await service.issue(admin.headers, { ...t.command, idempotencyKey: randomUUID() });
    await expect(service.inspect(first.token)).rejects.toMatchObject({ code: 'invalid_reset' });
    expect(next.token).toBeTruthy();
    expect(await auth.api.getSession({ headers: t.headers })).not.toBeNull();
  });
  it.each(['expiry', 'member-revision', 'contact', 'partner', 'issuer'] as const)(
    'invalidates reset after %s changes',
    async (kind) => {
      const t = await target(),
        issued = await issue(t);
      if (kind === 'expiry')
        await sql`update portal_identity.password_resets set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${issued.id}`;
      if (kind === 'member-revision')
        await sql`update portal_access.memberships set permission_revision=2 where user_id=${t.id}`;
      if (kind === 'contact')
        await sql`update portal_access.memberships set verified_contact_ref='another-contact' where user_id=${t.id}`;
      if (kind === 'partner')
        await sql`update portal_access.partners set status='suspended' where id=${t.command.partnerId}`;
      if (kind === 'issuer')
        await sql`update portal_access.staff_grants set revision=revision+1 where user_id=${admin.id}`;
      await expect(service.reset(reset(issued.token))).rejects.toMatchObject({
        code: 'invalid_reset',
      });
      expect((await login(t.username)).status).toBe(200);
    },
  );
  it('current password is required; success invalidates pending reset links and all sessions', async () => {
    const t = await target(),
      issued = await issue(t);
    const command = {
      currentPassword: 'incorrect password',
      password: newPassword,
      passwordConfirmation: newPassword,
      idempotencyKey: randomUUID(),
    };
    await expect(service.change(t.headers, command)).rejects.toMatchObject({
      code: 'invalid_password',
    });
    await expect(
      service.reset({ ...reset(issued.token), passwordConfirmation: 'mismatch password' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await service.inspect(issued.token)).toMatchObject({ username: t.username });
    expect(await service.change(t.headers, { ...command, currentPassword: oldPassword })).toEqual({
      status: 'requires-login',
    });
    expect(await auth.api.getSession({ headers: t.headers })).toBeNull();
    await expect(service.inspect(issued.token)).rejects.toMatchObject({ code: 'invalid_reset' });
    expect((await login(t.username, newPassword)).status).toBe(200);
  });
  it('final audit failure rolls back password, consumption and session revocation', async () => {
    const t = await target(),
      issued = await issue(t);
    await sql.unsafe(
      `CREATE FUNCTION portal_identity.password_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_id='${t.id}' AND NEW.action='reset-password' THEN RAISE EXCEPTION 'synthetic-final-audit-failure'; END IF; RETURN NEW; END; $$`,
    );
    await sql`CREATE TRIGGER password_test_failure BEFORE INSERT ON portal_identity.method_audit FOR EACH ROW EXECUTE FUNCTION portal_identity.password_test_failure()`;
    try {
      await expect(service.reset(reset(issued.token))).rejects.toThrow(
        'synthetic-final-audit-failure',
      );
      expect(await service.inspect(issued.token)).toMatchObject({ username: t.username });
      expect(await auth.api.getSession({ headers: t.headers })).not.toBeNull();
      expect((await login(t.username)).status).toBe(200);
      expect((await login(t.username, newPassword)).status).toBe(401);
    } finally {
      await sql`DROP TRIGGER password_test_failure ON portal_identity.method_audit`;
      await sql`DROP FUNCTION portal_identity.password_test_failure()`;
    }
  });
  it('concurrent redemptions produce one password change and one audit', async () => {
    const t = await target(),
      issued = await issue(t);
    const results = await Promise.allSettled([
      service.reset(reset(issued.token)),
      service.reset(reset(issued.token)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await sql`select id from portal_identity.method_audit where target_id=${t.id} AND action='reset-password'`,
    ).toHaveLength(1);
  });
  it.each(['reset-first', 'login-first'] as const)(
    'serializes in-flight old-password login and reset: %s',
    async (order) => {
      const t = await target(),
        issued = await issue(t);
      let first!: Promise<unknown>, second!: Promise<unknown>;
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(981705,2)`;
        first = order === 'reset-first' ? service.reset(reset(issued.token)) : login(t.username);
        // Observe the actual blocked writer on the second pool connection before queuing its competitor.
        let waiting = false;
        for (let n = 0; n < 100; n++) {
          const [row] =
            await tx`select EXISTS(select 1 from pg_locks where locktype='advisory' AND classid=981705 AND objid=2 AND NOT granted) as waiting`;
          if (row.waiting) {
            waiting = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(waiting).toBe(true);
        second = order === 'reset-first' ? login(t.username) : service.reset(reset(issued.token));
      });
      const outcomes = await Promise.all([first, second]);
      const response = outcomes[order === 'reset-first' ? 1 : 0] as Response;
      expect(response.status).toBe(order === 'reset-first' ? 401 : 200);
      expect(await auth.api.getSession({ headers: cookie(response) })).toBeNull();
      expect(await sql`select id from portal_identity.sessions where user_id=${t.id}`).toHaveLength(
        0,
      );
      expect((await login(t.username, newPassword)).status).toBe(200);
    },
  );
  it('transactional login retains origin, closed signup and attempt limit protections', async () => {
    const t = await target();
    expect((await login(t.username, oldPassword, 'https://foreign.example.test')).status).toBe(403);
    expect(
      (
        await handle(
          new Request(config.BETTER_AUTH_URL + '/api/auth/sign-up/email', { method: 'POST' }),
        )
      ).status,
    ).toBe(404);
    const statuses = [];
    for (let n = 0; n < 12; n++)
      statuses.push((await login(t.username, 'invalid-password')).status);
    expect(statuses).toContain(429);
    expect(await auth.api.getSession({ headers: t.headers })).not.toBeNull();
  });
});
