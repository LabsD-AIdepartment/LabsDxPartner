import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { toNextJsHandler } from 'better-auth/next-js';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import { createIdentity } from '@/server/modules/identity/auth';
import {
  readIdentityConfig,
  identityBindingDigest,
} from '@/server/modules/identity/provider-config';
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { createIdentityMethods } from '@/server/modules/identity/methods';
import { transactionIdentity } from '@/server/modules/identity/transaction-auth';

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
let resolve: ReturnType<typeof principalResolver>;
let service: ReturnType<typeof createIdentityMethods>;
beforeAll(async () => {
  sql = await connectTestDatabase();
  auth = createIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  resolve = principalResolver(auth, async () => {
    const [binding] =
      await sql`select namespace_digest from portal_identity.binding where id = 'current'`;
    if (binding?.namespace_digest !== identityBindingDigest(config))
      throw new Error('Isolated namespace mismatch');
  });
  service = createIdentityMethods(sql, resolve, transactionIdentity(config));
});
afterAll(async () => {
  if (sql) await sql.end();
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
      origin: config.BETTER_AUTH_URL,
    }),
  };
}
async function person(providers = ['google', 'line']) {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { name: 'Synthetic methods', email: `${randomUUID()}@identity.invalid`, emailVerified: false },
    { method: 'admin' },
  );
  for (const provider of providers)
    await context.internalAdapter.createAccount({
      id: randomUUID(),
      userId: user.id,
      providerId: provider,
      accountId: randomUUID(),
      accessToken: 'synthetic-token-not-for-output',
    });
  return { id: user.id, ...(await session(user.id)) };
}
async function command(user: { headers: Headers }, provider = 'google') {
  const list = await service.list(user.headers);
  const selected = list.methods.find((method) => method.provider === provider);
  if (!selected) throw new Error('Missing synthetic method');
  return { accountId: selected.id, expectedRevision: list.revision, idempotencyKey: randomUUID() };
}

describe('A02 transactional native unlink; synthetic setup is not provider OAuth acceptance', () => {
  it('projects only owned configured methods, without subjects, credentials or contact email', async () => {
    const user = await person(['google', 'line', 'credential', 'unsupported']);
    await person();
    const list = await service.list(user.headers);
    expect(list.methods.map((m) => m.provider).sort()).toEqual(['google', 'line']);
    expect(list.methods.every((m) => m.canUnlink)).toBe(true);
    expect(Object.keys(list.methods[0]).sort()).toEqual(['canUnlink', 'id', 'provider']);
    expect(JSON.stringify(list)).not.toContain('synthetic-token');
    expect(JSON.stringify(list)).not.toContain('@identity.invalid');
  });
  it('uses the maintained native API, revokes every owner session, and appends exact audit', async () => {
    const user = await person(),
      other = await person(),
      second = await session(user.id);
    const input = await command(user);
    const result = await service.unlink(user.headers, input);
    expect(result).toMatchObject({
      status: 'requires-reauth',
      accountId: input.accountId,
      replayed: false,
    });
    expect(await auth.api.getSession({ headers: user.headers })).toBeNull();
    expect(await auth.api.getSession({ headers: second.headers })).toBeNull();
    expect((await auth.api.getSession({ headers: other.headers }))?.user.id).toBe(other.id);
    const rows =
      await sql`select id,provider_id from portal_identity.accounts where user_id = ${user.id}`;
    expect(rows.map((row) => row.provider_id)).toEqual(['line']);
    const [audit] =
      await sql`select * from portal_identity.method_audit where id = ${result.requestId}`;
    expect(audit.actor_id).toBe(user.id);
    expect(audit.target_id).toBe(input.accountId);
    expect(audit.details.sessionsRevoked).toBe(2);
    expect(audit.details.before).toHaveLength(2);
    expect(audit.details.after).toHaveLength(1);
    expect(audit.details.afterRevision).toBe(result.revision);
    expect(JSON.stringify(audit)).not.toContain('synthetic-token');
  });
  it('does not count password, unsupported or empty-subject rows as a remaining usable method', async () => {
    const user = await person(['google', 'credential', 'unsupported']);
    // The malformed subject is globally unique, so clean only this synthetic
    // fixture's residue from a killed prior run in the validated disposable DB.
    await sql`delete from portal_identity.accounts a using portal_identity.users u
      where a.user_id = u.id AND a.provider_id = 'line' AND a.account_id = ''
      AND u.name = 'Synthetic methods' AND u.email like '%@identity.invalid'`;
    const malformedId = randomUUID();
    await sql`insert into portal_identity.accounts(id,user_id,provider_id,account_id) values (${malformedId},${user.id},'line','')`;
    try {
      const list = await service.list(user.headers);
      expect(list.methods).toHaveLength(1);
      expect(list.methods[0].canUnlink).toBe(false);
      await expect(service.unlink(user.headers, await command(user))).rejects.toMatchObject({
        code: 'last_method',
      });
      expect((await auth.api.getSession({ headers: user.headers }))?.user.id).toBe(user.id);
    } finally {
      await sql`delete from portal_identity.accounts where id = ${malformedId} AND user_id = ${user.id}`;
    }
  });
  it('rejects a missing or foreign exact account id without deleting either owner method', async () => {
    const user = await person(),
      other = await person();
    const own = await command(user),
      foreign = await command(other);
    for (const accountId of [foreign.accountId, randomUUID()])
      await expect(service.unlink(user.headers, { ...own, accountId })).rejects.toMatchObject({
        code: 'not_found',
      });
    expect((await service.list(user.headers)).methods).toHaveLength(2);
    expect((await service.list(other.headers)).methods).toHaveLength(2);
  });
  it('refuses a stale displayed method set after another method is linked', async () => {
    const user = await person(),
      input = await command(user);
    const context = await auth.$context;
    await context.internalAdapter.createAccount({
      userId: user.id,
      providerId: 'apple',
      accountId: randomUUID(),
    });
    await expect(service.unlink(user.headers, input)).rejects.toMatchObject({ code: 'conflict' });
    expect((await service.list(user.headers)).methods).toHaveLength(3);
  });
  it('requires fresh auth and rejects future-dated sessions even if the library considers them fresh', async () => {
    for (const seconds of [-301, 60]) {
      const user = await person(),
        input = await command(user);
      await sql`update portal_identity.sessions set created_at = clock_timestamp() + ${seconds} * interval '1 second' where id = ${user.sessionId}`;
      await expect(service.unlink(user.headers, input)).rejects.toMatchObject({
        code: 'fresh_auth_required',
      });
    }
  });
  it('rejects missing, forged, expired and revoked sessions', async () => {
    const user = await person(),
      input = await command(user);
    const context = await auth.$context;
    for (const headers of [
      new Headers(),
      new Headers({ cookie: `${context.authCookies.sessionToken.name}=forged` }),
    ])
      await expect(service.unlink(headers, input)).rejects.toMatchObject({
        code: 'unauthenticated',
      });
    await sql`update portal_identity.sessions set expires_at = clock_timestamp() - interval '1 second' where id = ${user.sessionId}`;
    await expect(service.unlink(user.headers, input)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const renewed = await session(user.id);
    await sql`delete from portal_identity.sessions where id = ${renewed.sessionId}`;
    await expect(service.unlink(renewed.headers, input)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
  it('rechecks a session revoked between maintained proof resolution and acquiring the writer lock', async () => {
    const user = await person(),
      input = await command(user);
    const racing = createIdentityMethods(
      sql,
      async (headers) => {
        const proof = await resolve(headers);
        await sql`delete from portal_identity.sessions where id = ${user.sessionId}`;
        return proof;
      },
      transactionIdentity(config),
    );
    await expect(racing.unlink(user.headers, input)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(
      (await sql`select id from portal_identity.accounts where user_id = ${user.id}`).length,
    ).toBe(2);
  });
  it('serializes two concurrent unlinks and never removes the final method', async () => {
    const user = await person(),
      second = await session(user.id);
    const google = await command(user, 'google'),
      line = await command(user, 'line');
    // Ensure both maintained proofs resolve before either transaction starts.
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((done) => {
      release = done;
    });
    const racing = createIdentityMethods(
      sql,
      async (headers) => {
        const proof = await resolve(headers);
        if (++arrived === 2) release();
        await barrier;
        return proof;
      },
      transactionIdentity(config),
    );
    const attempts = await Promise.allSettled([
      racing.unlink(user.headers, google),
      racing.unlink(second.headers, line),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('unauthenticated');
    const renewed = await session(user.id),
      list = await service.list(renewed.headers);
    expect(list.methods).toHaveLength(1);
    await expect(
      service.unlink(renewed.headers, {
        accountId: list.methods[0].id,
        expectedRevision: list.revision,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'last_method' });
    expect(
      (await sql`select id from portal_identity.method_audit where actor_id = ${user.id}`).length,
    ).toBe(1);
  });
  it('returns a historical idempotent receipt only after fresh reauthentication and rejects key reuse', async () => {
    const user = await person(),
      input = await command(user),
      first = await service.unlink(user.headers, input);
    await expect(service.unlink(user.headers, input)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const renewed = await session(user.id);
    expect(await service.unlink(renewed.headers, input)).toEqual({ ...first, replayed: true });
    await expect(
      service.unlink(renewed.headers, { ...input, accountId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await auth.api.getSession({ headers: renewed.headers }))?.user.id).toBe(user.id);
  });
  it('rolls back the native deletion when a downstream database operation fails', async () => {
    const user = await person(),
      input = await command(user);
    const failing = createIdentityMethods(sql, resolve, (tx) => {
      const native = transactionIdentity(config)(tx);
      const unlink = native.api.unlinkAccount;
      return {
        ...native,
        api: {
          ...native.api,
          unlinkAccount: new Proxy(unlink, {
            async apply(target, receiver, args) {
              const result = await Reflect.apply(target, receiver, args);
              expect(
                (await tx`select id from portal_identity.accounts where id = ${input.accountId}`)
                  .length,
              ).toBe(0);
              // A real DB error after deletion, inside the same transaction; no file/schema mutation.
              await tx`select 1 / 0`;
              return result;
            },
          }),
        },
      };
    });
    await expect(failing.unlink(user.headers, input)).rejects.toMatchObject({ code: '22012' });
    expect((await service.list(user.headers)).methods).toHaveLength(2);
    expect(
      (await sql`select id from portal_identity.method_audit where actor_id = ${user.id}`).length,
    ).toBe(0);
  });
  it('keeps audit immutable and avoids exposing unguarded native mutation routes', async () => {
    const user = await person(),
      result = await service.unlink(user.headers, await command(user));
    await expect(
      sql`update portal_identity.method_audit set details = '{}' where id = ${result.requestId}`,
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      sql`delete from portal_identity.method_audit where id = ${result.requestId}`,
    ).rejects.toMatchObject({ code: 'P0001' });
    const renewed = await session(user.id),
      handler = toNextJsHandler(auth);
    for (const path of ['/unlink-account', '/link-social']) {
      const response = await handler.POST(
        new Request(config.BETTER_AUTH_URL + '/api/auth' + path, {
          method: 'POST',
          headers: { ...Object.fromEntries(renewed.headers), 'content-type': 'application/json' },
          body: JSON.stringify({ accountId: result.accountId, provider: 'line' }),
        }),
      );
      expect(response.status).toBe(404);
    }
  });
  it('rejects malformed commands including client-supplied user authority', async () => {
    const user = await person(),
      input = await command(user);
    for (const invalid of [
      { ...input, userId: user.id },
      { ...input, expectedRevision: '' },
      { accountId: input.accountId },
    ])
      expect(() => service.unlink(user.headers, invalid)).toThrow('invalid_input');
  });
});
