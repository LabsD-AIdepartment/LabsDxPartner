import { createPartnerSessionHttp } from '@/server/http/partner-session';
import { createPartnerAccess } from '@/server/modules/partners/access';
import { PARTNER_COOKIE } from '@/server/modules/access/partner-session';
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
import { createAccessHttp } from '@/server/http/access';
const config = readCredentialConfig({
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-access-http-secret-only-32-characters',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
const password = 'Synthetic HTTP password!';
let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let native: ReturnType<typeof credentialSessionHandler>;
let handle: ReturnType<typeof createAccessHttp>;
let staff: Headers;
let binding = true;
const cookies = (r: Response) =>
  new Headers({
    cookie: r.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
  });
async function login(username: string, pass = password) {
  return native(
    new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: pass }),
    }),
  );
}
function request(action: string, input: unknown, headers = new Headers()) {
  const h = new Headers(headers);
  h.set('origin', config.BETTER_AUTH_URL);
  h.set('content-type', 'application/json');
  return new Request(config.BETTER_AUTH_URL + '/api/access/' + action, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(input),
  });
}
async function issue() {
  const partnerId = randomUUID();
  await sql`insert into portal_access.partners(id,name,status) values(${partnerId},'Synthetic HTTP partner','active')`;
  const response = await handle(
    request(
      'invitations/issue',
      {
        partnerId,
        recipientName: 'คุณทดสอบ',
        verifiedContactRef: 'contact-http',
        capabilities: ['view_earnings'],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        idempotencyKey: randomUUID(),
      },
      staff,
    ),
  );
  expect(response.status).toBe(200);
  return { partnerId, ...((await response.json()) as { id: string; token: string }) };
}
beforeAll(async () => {
  sql = await connectTestDatabase();
  await sql`delete from portal_identity.rate_limits`;
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  native = credentialSessionHandler(sql, config, auth);
  const assertBinding = async () => {
    if (!binding) throw new Error('private-binding-details');
  };
  handle = createAccessHttp(sql, config, principalResolver(auth, assertBinding), assertBinding);
  const context = await auth.$context,
    username = 'http_' + randomUUID().slice(0, 8);
  const user = await context.internalAdapter.createUser(
    {
      name: 'Synthetic HTTP staff',
      username,
      email: randomUUID() + '@identity.invalid',
      emailVerified: false,
    },
    { method: 'admin' },
  );
  await context.internalAdapter.createAccount({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: await context.password.hash(password),
  });
  await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values(${user.id},ARRAY['manage_partners'],true,'synthetic-http')`;
  const response = await login(username);
  expect(response.status).toBe(200);
  staff = cookies(response);
});
beforeEach(async () => {
  binding = true;
  await sql`delete from portal_identity.rate_limits`;
});
afterAll(async () => {
  if (sql) {
    await sql`delete from portal_identity.rate_limits`;
    await sql.end();
  }
});
describe('access HTTP on native credentials and actual isolated PostgreSQL', () => {
  it('authenticated attempts stay scoped to the verified user when unrelated cookies change', async () => {
    const statuses: number[] = [];
    for (let n = 0; n < 10; n++) {
      const headers = new Headers(staff);
      headers.set('cookie', headers.get('cookie') + '; ignored=' + n);
      statuses.push((await handle(request('passwords/change', {}, headers))).status);
    }
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(400));
    expect(statuses.slice(8)).toEqual([429, 429]);
  });

  it('rotating untrusted cookies cannot bypass the global route budget', async () => {
    const responses: number[] = [];
    for (let n = 0; n < 61; n++) {
      responses.push(
        (await handle(request('passwords/reset', {}, new Headers({ cookie: 'untrusted=' + n }))))
          .status,
      );
    }
    expect(responses.slice(0, 60)).toEqual(Array(60).fill(400));
    expect(responses[60]).toBe(429);
  });
  it('concurrent rejected requests consume the same atomic bearer budget', async () => {
    const token = 'q'.repeat(43);
    const statuses = await Promise.all(
      Array.from(
        { length: 12 },
        async () =>
          (
            await handle(
              request('passwords/reset', { token, password, passwordConfirmation: password }),
            )
          ).status,
      ),
    );
    expect(statuses.filter((status) => status === 400)).toHaveLength(8);
    expect(statuses.filter((status) => status === 429)).toHaveLength(4);
  });

  it('staff invite -> non-consuming inspect -> register -> native login -> scoped session -> reset -> old session denial', async () => {
    const invite = await issue();
    const context = await handle(request('invitations/inspect', { token: invite.token }));
    expect(context.status).toBe(200);
    expect(context.headers.get('cache-control')).toBe('private, no-store');
    expect(context.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await context.json()).toMatchObject({ recipientName: 'คุณทดสอบ' });
    const username = 'star_' + randomUUID().slice(0, 8);
    const activated = await handle(
      request('invitations/register', {
        token: invite.token,
        username,
        password,
        passwordConfirmation: password,
      }),
    );
    expect(activated.status).toBe(200);
    const account = await activated.json();
    expect(activated.headers.get('set-cookie')).toBeNull();
    const signedIn = await login(username);
    expect(signedIn.status).toBe(200);
    const headers = cookies(signedIn);
    const session = await handle(request('session', {}, headers));
    expect(session.status).toBe(200);
    expect(
      (await session.json()).memberships.map((m: { partnerId: string }) => m.partnerId),
    ).toEqual([invite.partnerId]);
    const issuedReset = await handle(
      request(
        'passwords/issue',
        {
          partnerId: invite.partnerId,
          userId: account.userId,
          expectedRevision: '1',
          verifiedContactRef: 'contact-http',
          verificationEvidenceRef: 'support-http:verified',
          idempotencyKey: randomUUID(),
        },
        staff,
      ),
    );
    expect(issuedReset.status).toBe(200);
    const reset = await issuedReset.json();
    const changed = await handle(
      request('passwords/reset', {
        token: reset.token,
        password: password + ' new',
        passwordConfirmation: password + ' new',
      }),
    );
    expect(changed.status).toBe(200);
    expect((await handle(request('session', {}, headers))).status).toBe(401);
    expect((await login(username)).status).toBe(401);
    expect((await login(username, password + ' new')).status).toBe(200);
    expect(
      (
        await handle(
          request('passwords/reset', {
            token: reset.token,
            password: password + ' new',
            passwordConfirmation: password + ' new',
          }),
        )
      ).status,
    ).toBe(400);
  });
  it('rejects untrusted origin, media type, unknown/prototype route and method before services', async () => {
    const input = request('invitations/inspect', { token: 'a'.repeat(43) });
    input.headers.set('origin', 'https://evil.example');
    expect((await handle(input)).status).toBe(403);
    const wrongType = request('invitations/inspect', {});
    wrongType.headers.set('content-type', 'text/plain');
    expect((await handle(wrongType)).status).toBe(415);
    expect((await handle(request('__proto__', {}))).status).toBe(404);
    expect(
      (await handle(new Request(config.BETTER_AUTH_URL + '/api/access/invitations/register')))
        .status,
    ).toBe(404);
    expect((await handle(request('sign-up', {}))).status).toBe(404);
  });
  it('binding denial is generic and does not issue or consume an invitation', async () => {
    const invite = await issue();
    binding = false;
    const response = await handle(
      request('invitations/register', {
        token: invite.token,
        username: 'blocked-user',
        password,
        passwordConfirmation: password,
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private-binding-details');
    expect(
      (await sql`select claimed_at from portal_access.invites where id=${invite.id}`)[0].claimed_at,
    ).toBeNull();
  });
  it('bounds body, rejects malformed JSON and refuses anonymous staff commands', async () => {
    const big = new Request(config.BETTER_AUTH_URL + '/api/access/invitations/inspect', {
      method: 'POST',
      headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
      body: 'x'.repeat(8193),
    });
    expect((await handle(big)).status).toBe(413);
    const malformed = new Request(config.BETTER_AUTH_URL + '/api/access/invitations/inspect', {
      method: 'POST',
      headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
      body: '{',
    });
    expect((await handle(malformed)).status).toBe(400);
    const invite = await issue();
    expect(
      (
        await handle(
          request('invitations/revoke', {
            partnerId: invite.partnerId,
            inviteId: invite.id,
            idempotencyKey: randomUUID(),
          }),
        )
      ).status,
    ).toBe(401);
  });
  it('failed bearer mutations consume persisted attempts and counters never store the token', async () => {
    const token = 'z'.repeat(43),
      statuses = [];
    for (let n = 0; n < 10; n++)
      statuses.push(
        (
          await handle(
            request('passwords/reset', { token, password, passwordConfirmation: password }),
          )
        ).status,
      );
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(400));
    expect(statuses[8]).toBe(429);
    const response = await handle(
      request('passwords/reset', { token, password, passwordConfirmation: password }),
    );
    expect(response.headers.get('retry-after')).toBe('60');
    const counters =
      await sql`select key,count from portal_identity.rate_limits where key LIKE 'access:%'`;
    expect(JSON.stringify(counters)).not.toContain(token);
    expect(counters.some((r) => r.count > 8)).toBe(true);
    const another = createAccessHttp(
      sql,
      config,
      principalResolver(auth, async () => {}),
      async () => {},
    );
    expect(
      (
        await another(
          request('passwords/reset', { token, password, passwordConfirmation: password }),
        )
      ).status,
    ).toBe(429);
  });
});

// Application session path uses the same native signed session and fresh membership authority.
describe('partner application session', () => {
  it('selects only owned partners, ignores another user preference, rechecks revocation and expires selection on logout', async () => {
    const invite = await issue();
    const username = 'app_' + randomUUID().slice(0, 8);
    const registered = await handle(
      request('invitations/register', {
        token: invite.token,
        username,
        password,
        passwordConfirmation: password,
      }),
    );
    expect(registered.status).toBe(200);
    const account = await registered.json();
    const signedIn = await login(username);
    expect(signedIn.status).toBe(200);
    const headers = cookies(signedIn);
    const partners = createPartnerAccess(
      sql,
      principalResolver(auth, async () => {}),
    );
    const sessionHttp = createPartnerSessionHttp(partners, config.BETTER_AUTH_URL);
    const url = config.BETTER_AUTH_URL + '/api/partner/session';
    const get = () => sessionHttp(new Request(url, { headers }));
    const post = (partnerId: string, origin = config.BETTER_AUTH_URL) =>
      sessionHttp(
        new Request(url, {
          method: 'POST',
          headers: { cookie: headers.get('cookie')!, origin, 'content-type': 'application/json' },
          body: JSON.stringify({ partnerId }),
        }),
      );
    const first = await get();
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect(await first.json()).toMatchObject({
      userId: account.userId,
      activePartnerId: invite.partnerId,
      access: 'active',
    });
    const other = await issue();
    expect((await post(other.partnerId)).status).toBe(403);
    expect((await post(invite.partnerId, 'https://foreign.example')).status).toBe(403);
    const accepted = await handle(request('invitations/accept', { token: other.token }, headers));
    expect(accepted.status).toBe(200);
    const switched = await post(other.partnerId);
    expect(switched.status).toBe(200);
    expect(await switched.json()).toMatchObject({
      activePartnerId: other.partnerId,
      userId: account.userId,
    });
    const selection = switched.headers.getSetCookie()[0];
    expect(selection).toContain('Secure; HttpOnly; SameSite=Lax');
    headers.set('cookie', headers.get('cookie') + '; ' + selection.split(';')[0]);
    expect(await (await get()).json()).toMatchObject({ activePartnerId: other.partnerId });
    const foreign = new Headers(staff);
    foreign.set('cookie', foreign.get('cookie') + '; ' + selection.split(';')[0]);
    expect(await (await sessionHttp(new Request(url, { headers: foreign }))).json()).toMatchObject({
      activePartnerId: null,
    });
    const member = (
      await sql`select permission_revision::text as revision from portal_access.memberships where user_id=${account.userId} and partner_id=${other.partnerId}`
    )[0];
    await partners.changeMembership(staff, {
      partnerId: other.partnerId,
      userId: account.userId,
      expectedRevision: member.revision,
      status: 'suspended',
      verifiedContactRef: 'contact-http',
      capabilities: ['view_earnings'],
      idempotencyKey: randomUUID(),
    });
    // Suspension revokes native sessions; selection cannot retain access.
    expect((await get()).status).toBe(401);
    const fresh = cookies(await login(username));
    const signout = await native(
      new Request(config.BETTER_AUTH_URL + '/api/auth/sign-out', {
        method: 'POST',
        headers: {
          cookie: fresh.get('cookie')!,
          origin: config.BETTER_AUTH_URL,
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(signout.status).toBe(200);
    expect(
      signout.headers
        .getSetCookie()
        .some((v) => v.startsWith(PARTNER_COOKIE + '=;') && v.includes('Max-Age=0')),
    ).toBe(true);
    expect((await sessionHttp(new Request(url, { headers: fresh }))).status).toBe(401);
  });
});
