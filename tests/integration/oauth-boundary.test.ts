import { ensureTestIdentityBinding } from '../helpers/identity-binding';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  providerNamespace,
} from '@/server/modules/identity/provider-config';
import { createOAuthBoundary } from '@/server/modules/identity/oauth-boundary';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { transactionIdentity } from '@/server/modules/identity/transaction-auth';
import { createIdentityMethods } from '@/server/modules/identity/methods';
import { revokeIdentitySessions } from '@/server/modules/identity/revocation';
import { mapProfile } from '@/server/modules/identity/profile-map';

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
let auth: ReturnType<typeof createIdentity>, setup: ReturnType<typeof createIdentity>;
let methods: ReturnType<typeof createIdentityMethods>;
let handler: ReturnType<typeof toNextJsHandler>;
type Profile = { sub: string; email?: string; pause?: () => Promise<void> };
const profiles = new Map<string, Profile>();
beforeAll(async () => {
  sql = await connectTestDatabase();
  await ensureTestIdentityBinding(sql, identityBindingDigest(config));
  const factory = drizzleAdapter(drizzle(sql), {
    provider: 'pg',
    schema: authSchema,
    transaction: true,
  });
  setup = createIdentity(config, factory);
  const flows = createOAuthBoundary(sql, config.BETTER_AUTH_URL);
  auth = createIdentity(config, flows.database(factory), flows.hooks);
  const assertBinding = async () => {
    const [row] =
      await sql`select namespace_digest from portal_identity.binding where id = 'current'`;
    if (row?.namespace_digest !== identityBindingDigest(config))
      throw new Error('Isolated namespace mismatch');
  };
  methods = createIdentityMethods(
    sql,
    principalResolver(auth, assertBinding),
    transactionIdentity(config),
  );
  handler = toNextJsHandler((request) =>
    handleIdentityRequest(request, () => ({
      assertBinding,
      handle: (req) => flows.handle(req, auth.handler),
    })),
  );
});
beforeEach(async () => {
  // The project restores spies before EACH test. Install at the same lifetime.
  // Any accidental provider network call must fail locally, not use fake credentials.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected provider network in synthetic integration test');
    }),
  );
  // Only the external provider-result boundary is synthetic. Native state/cookie,
  // callback, profile mapping and adapter/transaction behavior really execute.
  // These tests explicitly do NOT prove provider tokens/crypto or A01 OAuth acceptance.
  const context = await auth.$context;
  for (const name of ['google', 'line', 'apple'] as const) {
    const provider = context.socialProviders.find((entry) => entry.id === name)!;
    vi.spyOn(provider, 'validateAuthorizationCode').mockImplementation(async ({ code }) => ({
      accessToken: code,
      scopes: ['openid', 'profile'],
    }));
    vi.spyOn(provider, 'getUserInfo').mockImplementation(async ({ accessToken }) => {
      const profile = profiles.get(accessToken ?? '');
      if (!profile) return null;
      await profile.pause?.();
      const raw = {
        sub: profile.sub,
        name: 'Synthetic callback',
        email: profile.email,
        email_verified: true,
      };
      return { user: mapProfile(providerNamespace(config, name), raw, name), data: raw };
    });
  }
});
beforeEach(async () => {
  // Reset only ephemeral limiter state in the validated disposable test database.
  // Production rate settings remain enabled; the dedicated test below exercises 429.
  await sql`delete from portal_identity.rate_limits`;
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (sql) {
    // Do not leave the deliberate429 scenario active for the next test file/run.
    await sql`delete from portal_identity.rate_limits`;
    await sql.end();
  }
});
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
async function session(userId: string) {
  const context = await setup.$context,
    row = await context.internalAdapter.createSession(userId);
  if (!row) throw new Error('Synthetic setup session failed');
  const signature = createHmac('sha256', config.BETTER_AUTH_SECRET)
    .update(row.token)
    .digest('base64');
  return {
    sessionId: row.id,
    cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(row.token + '.' + signature)}`,
  };
}
async function person() {
  const ctx = await setup.$context;
  const user = await ctx.internalAdapter.createUser(
    {
      name: 'Synthetic callback owner',
      email: `${randomUUID()}@identity.invalid`,
      emailVerified: false,
    },
    { method: 'admin' },
  );
  const sub = randomUUID();
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    providerId: 'google',
    accountId: sub,
  });
  return { id: user.id, sub, ...(await session(user.id)) };
}
async function start(
  provider = 'line',
  owner?: { cookie: string },
  extra: Record<string, unknown> = {},
) {
  const response = await handler.POST(
    new Request(
      config.BETTER_AUTH_URL + '/api/auth/' + (owner ? 'link-social' : 'sign-in/social'),
      {
        method: 'POST',
        headers: {
          origin: config.BETTER_AUTH_URL,
          'content-type': 'application/json',
          ...(owner ? { cookie: owner.cookie } : {}),
        },
        body: JSON.stringify({ provider, callbackURL: '/access/pending', ...extra }),
      },
    ),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  const state = new URL(body.url).searchParams.get('state')!;
  const [row] =
    await sql`select value from portal_identity.verifications where identifier = ${state}`;
  const stored = JSON.parse(row.value);
  return {
    state,
    cookie: [owner?.cookie, cookies(response)].filter(Boolean).join('; '),
    intentId: stored.serverContext.labsdIntent as string,
  };
}
async function callback(
  flow: Awaited<ReturnType<typeof start>>,
  profile: Profile,
  provider = 'line',
  cookie = flow.cookie,
) {
  const code = randomUUID();
  profiles.set(code, profile);
  return handler.GET(
    new Request(
      config.BETTER_AUTH_URL +
        '/api/auth/callback/' +
        provider +
        '?' +
        new URLSearchParams({ state: flow.state, code }),
      { headers: { cookie } },
    ),
  );
}
const success = (response: Response) => {
  const target = new URL(response.headers.get('location') ?? '/', config.BETTER_AUTH_URL);
  return (
    response.status === 302 &&
    target.pathname === '/access/pending' &&
    !target.searchParams.has('error')
  );
};
async function unlinkGoogle(owner: Awaited<ReturnType<typeof person>>) {
  const headers = new Headers({ cookie: owner.cookie, origin: config.BETTER_AUTH_URL });
  const list = await methods.list(headers);
  return methods.unlink(headers, {
    accountId: list.methods.find((m) => m.provider === 'google')!.id,
    expectedRevision: list.revision,
    idempotencyKey: randomUUID(),
  });
}

describe('A02 native callback boundary with synthetic external provider results', () => {
  it('links missing-email LINE after fresh existing proof; audits it once without changing contact metadata', async () => {
    const owner = await person(),
      flow = await start('line', owner),
      subject = randomUUID();
    const response = await callback(flow, { sub: subject });
    expect(success(response)).toBe(true);
    const [account] =
      await sql`select user_id from portal_identity.accounts where provider_id='line' AND account_id=${subject}`;
    expect(account?.user_id).toBe(owner.id);
    const [audit] =
      await sql`select actor_id,action,details from portal_identity.method_audit where id=${flow.intentId}`;
    expect(audit).toMatchObject({ actor_id: owner.id, action: 'link' });
    expect(JSON.stringify(audit)).not.toContain(subject);
    const [user] = await sql`select email_verified from portal_identity.users where id=${owner.id}`;
    expect(user.email_verified).toBe(false);
    expect(success(await callback(flow, { sub: subject }))).toBe(false);
  });
  it('creates an unprivileged user and session through the native signup transaction', async () => {
    const flow = await start(),
      sub = randomUUID(),
      response = await callback(flow, { sub });
    expect(success(response)).toBe(true);
    const signed = await auth.api.getSession({
      headers: new Headers({ cookie: cookies(response) }),
    });
    expect(signed?.user.id).toBeTruthy();
    expect(
      (await sql`select id from portal_access.memberships where user_id=${signed!.user.id}`).length,
    ).toBe(0);
    expect(
      (
        await sql`select consumed_at from portal_identity.oauth_intents where id=${flow.intentId}`
      )[0].consumed_at,
    ).not.toBeNull();
  });
  it('signs in an existing provider-bound owner without using equal email as proof', async () => {
    const owner = await person(),
      flow = await start('google'),
      response = await callback(flow, { sub: owner.sub }, 'google');
    expect(success(response)).toBe(true);
    expect(
      (await auth.api.getSession({ headers: new Headers({ cookie: cookies(response) }) }))?.user.id,
    ).toBe(owner.id);
    const email = `${randomUUID()}@example.test`;
    await sql`update portal_identity.users set email=${email},email_verified=true where id=${owner.id}`;
    const conflict = await callback(await start('apple'), { sub: randomUUID(), email }, 'apple');
    expect(success(conflict)).toBe(false);
    expect(
      (await sql`select id from portal_identity.accounts where user_id=${owner.id}`).length,
    ).toBe(1);
  });
  it('rejects a provider subject already owned by another user', async () => {
    const first = await person(),
      second = await person();
    const response = await callback(await start('google', first), { sub: second.sub }, 'google');
    expect(success(response)).toBe(false);
    expect(
      (
        await sql`select user_id from portal_identity.accounts where provider_id='google' AND account_id=${second.sub}`
      )[0].user_id,
    ).toBe(second.id);
    expect(
      (await sql`select id from portal_identity.method_audit where actor_id=${first.id}`).length,
    ).toBe(0);
  });
  it('refuses unauthenticated, stale and future-dated link initiation', async () => {
    const owner = await person();
    for (const offset of [null, -301, 60]) {
      if (offset !== null)
        await sql`update portal_identity.sessions set created_at=clock_timestamp()+${offset}*interval '1 second' where id=${owner.sessionId}`;
      const response = await handler.POST(
        new Request(config.BETTER_AUTH_URL + '/api/auth/link-social', {
          method: 'POST',
          headers: {
            origin: config.BETTER_AUTH_URL,
            'content-type': 'application/json',
            ...(offset !== null ? { cookie: owner.cookie } : {}),
          },
          body: JSON.stringify({ provider: 'line', callbackURL: '/access/pending' }),
        }),
      );
      expect(response.status).not.toBe(200);
    }
  });
  it('does not trust additionalData as server context and rejects an expired intent', async () => {
    const owner = await person(),
      forged = randomUUID();
    const flow = await start('line', owner, {
      additionalData: { serverContext: { labsdIntent: forged }, labsdIntent: forged },
    });
    expect(flow.intentId).not.toBe(forged);
    await sql`update portal_identity.oauth_intents set expires_at=clock_timestamp()-interval '1 second' where id=${flow.intentId}`;
    expect(success(await callback(flow, { sub: randomUUID() }))).toBe(false);
    expect(
      (await sql`select id from portal_identity.accounts where user_id=${owner.id}`).length,
    ).toBe(1);
  });
  it('requires the same live existing session on return, including a switched browser account', async () => {
    const owner = await person(),
      other = await person(),
      flow = await start('line', owner);
    const cookie = flow.cookie.replace(owner.cookie, other.cookie);
    expect(success(await callback(flow, { sub: randomUUID() }, 'line', cookie))).toBe(false);
    const revoked = await start('line', owner);
    await sql`delete from portal_identity.sessions where id=${owner.sessionId}`;
    expect(success(await callback(revoked, { sub: randomUUID() }))).toBe(false);
  });
  it('does not hold a DB transaction while provider response is pending; unlink fences the returning login', async () => {
    const owner = await person(),
      ctx = await setup.$context;
    await ctx.internalAdapter.createAccount({
      userId: owner.id,
      providerId: 'line',
      accountId: randomUUID(),
    });
    const flow = await start('google');
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const result = callback(
      flow,
      {
        sub: owner.sub,
        pause: async () => {
          entered();
          await gate;
        },
      },
      'google',
    );
    await waiting;
    try {
      expect(
        (
          await sql`select pid from pg_stat_activity where datname=current_database() AND state='idle in transaction'`
        ).length,
      ).toBe(0);
      await unlinkGoogle(owner);
    } finally {
      release();
    }
    expect(success(await result)).toBe(false);
    expect(
      (await sql`select id from portal_identity.sessions where user_id=${owner.id}`).length,
    ).toBe(0);
    expect(
      (
        await sql`select id from portal_identity.accounts where provider_id='google' AND account_id=${owner.sub}`
      ).length,
    ).toBe(0);
  });
  it('fences an old login to a remaining method after membership-style session revocation', async () => {
    const owner = await person(),
      flow = await start('google');
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(981705,2)`;
      await revokeIdentitySessions(tx, owner.id);
    });
    expect(success(await callback(flow, { sub: owner.sub }, 'google'))).toBe(false);
    const renewed = await callback(await start('google'), { sub: owner.sub }, 'google');
    expect(success(renewed)).toBe(true);
  });
  it('does not invalidate another user when one user is revoked', async () => {
    const owner = await person(),
      other = await person(),
      flow = await start('google');
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(981705,2)`;
      await revokeIdentitySessions(tx, other.id);
    });
    expect(success(await callback(flow, { sub: owner.sub }, 'google'))).toBe(true);
  });
  it('preserves the native Apple form POST redirect before the browser-bound GET callback', async () => {
    const flow = await start('apple'),
      code = randomUUID(),
      sub = randomUUID();
    profiles.set(code, { sub });
    const response = await handler.POST(
      new Request(config.BETTER_AUTH_URL + '/api/auth/callback/apple', {
        method: 'POST',
        headers: {
          origin: 'https://appleid.apple.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ state: flow.state, code }).toString(),
      }),
    );
    expect(response.status).toBe(302);
    const redirect = new URL(response.headers.get('location')!);
    expect(redirect.pathname).toBe('/api/auth/callback/apple');
    expect(redirect.searchParams.get('state')).toBe(flow.state);
    expect(
      (
        await sql`select consumed_at from portal_identity.oauth_intents where id=${flow.intentId}`
      )[0].consumed_at,
    ).toBeNull();
    const completed = await handler.GET(
      new Request(redirect, { headers: { cookie: flow.cookie } }),
    );
    expect(success(completed)).toBe(true);
    expect(
      (await auth.api.getSession({ headers: new Headers({ cookie: cookies(completed) }) }))?.user
        .id,
    ).toBeTruthy();
    expect(completed.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('rolls back a real account link if the final immutable audit cannot commit', async () => {
    const owner = await person(),
      flow = await start('line', owner),
      sub = randomUUID();
    // Deliberate persisted synthetic collision at the final insert, after native linking.
    // Retain the audit fixture: never disable append-only history to clean it up.
    await sql`insert into portal_identity.method_audit(id,actor_id,action,target_id,idempotency_key,request_hash,result,details)
      values (${flow.intentId},${owner.id},'link','synthetic-audit-collision',${randomUUID()},${'0'.repeat(64)},'{}'::jsonb,'{}'::jsonb)`;
    const response = await callback(flow, { sub });
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({ code: 'IDENTITY_UNAVAILABLE', retryable: true });
    expect(
      (
        await sql`select id from portal_identity.accounts where provider_id='line' AND account_id=${sub}`
      ).length,
    ).toBe(0);
    expect(
      (
        await sql`select consumed_at from portal_identity.oauth_intents where id=${flow.intentId}`
      )[0].consumed_at,
    ).toBeNull();
    expect(
      (await sql`select id from portal_identity.sessions where id=${owner.sessionId}`).length,
    ).toBe(1);
  });
  it('commits one identity and session for concurrent callbacks sharing one native state', async () => {
    const flow = await start(),
      sub = randomUUID();
    const responses = await Promise.all([callback(flow, { sub }), callback(flow, { sub })]);
    expect(responses.filter(success)).toHaveLength(1);
    const accounts =
      await sql`select user_id from portal_identity.accounts where provider_id='line' AND account_id=${sub}`;
    expect(accounts).toHaveLength(1);
    expect(
      (await sql`select id from portal_identity.sessions where user_id=${accounts[0].user_id}`)
        .length,
    ).toBe(1);
  });
  it('enforces native browser state binding and guarded initiation rate limits', async () => {
    const flow = await start();
    expect(success(await callback(flow, { sub: randomUUID() }, 'line', ''))).toBe(false);
    let last: Response | undefined;
    for (let i = 0; i < 11; i++)
      last = await handler.POST(
        new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/social', {
          method: 'POST',
          headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'line', callbackURL: '/access/pending' }),
        }),
      );
    expect(last?.status).toBe(429);
    expect(last?.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
