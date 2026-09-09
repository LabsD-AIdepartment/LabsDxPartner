// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { toNextJsHandler } from 'better-auth/next-js';
import { createIdentity, identityOptions } from '@/server/modules/identity/auth';
import {
  identityBindingDigest,
  providerNamespace,
  readIdentityConfig,
} from '@/server/modules/identity/provider-config';
import { authOnlyEmail, isAuthOnlyEmail, mapProfile } from '@/server/modules/identity/profile-map';

const inputs = {
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-test-secret-32-characters-only',
  DATABASE_URL: 'postgresql://127.0.0.1/isolated_test_only',
  GOOGLE_CLIENT_ID: 'test-google',
  GOOGLE_CLIENT_SECRET: 'test-only',
  LINE_CLIENT_ID: 'test-line',
  LINE_CLIENT_SECRET: 'test-only',
  APPLE_CLIENT_ID: 'test-apple',
  APPLE_TEAM_ID: 'test-team',
  APPLE_CLIENT_SECRET: 'test-only',
};
function setup() {
  const config = readIdentityConfig(inputs);
  const memory = { user: [], session: [], account: [], verification: [], rateLimit: [] };
  const auth = createIdentity(config, memoryAdapter(memory));
  const handler = toNextJsHandler(auth);
  return { config, auth, handler, memory };
}
function request(path: string, body?: object, cookie?: string) {
  return new Request(inputs.BETTER_AUTH_URL + '/api/auth' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      origin: inputs.BETTER_AUTH_URL,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('identity configuration and profile isolation', () => {
  it('fails closed with safe field names; rejects inferred or non-HTTPS origins', () => {
    expect(() => readIdentityConfig({ BETTER_AUTH_SECRET: 'never-echo-this' })).toThrow(
      'Identity configuration is incomplete or invalid',
    );
    for (const url of [
      'http://localhost:4187',
      'https://a.test/api/auth',
      'https://a.test?x=1',
      'https://user:pass@a.test',
    ]) {
      expect(() => readIdentityConfig({ ...inputs, BETTER_AUTH_URL: url })).toThrow();
    }
  });
  it('namespaces subjects, refuses malformed subjects and keeps LINE email auth-only', () => {
    const config = readIdentityConfig(inputs);
    const ns = providerNamespace(config, 'line');
    const value = mapProfile(
      ns,
      { sub: 'person-1', email: 'untrusted@example.test', email_verified: true },
      'line',
    );
    expect(value).toMatchObject({ emailVerified: false, name: 'Partner' });
    expect(isAuthOnlyEmail(value.email)).toBe(true);
    expect(value.email).toBe(authOnlyEmail(ns, 'person-1'));
    expect(value.email).not.toBe(authOnlyEmail(providerNamespace(config, 'apple'), 'person-1'));
    expect(value.email).not.toBe(authOnlyEmail(ns, 'person-2'));
    for (const sub of [null, undefined, '', ' x', 'x\u0000y'])
      expect(() => authOnlyEmail(ns, sub)).toThrow();
    expect(identityBindingDigest(config)).not.toBe(
      identityBindingDigest({ ...config, LINE_CLIENT_ID: 'other-channel' }),
    );
    expect(identityBindingDigest(config)).toBe(
      identityBindingDigest({ ...config, LINE_CLIENT_SECRET: 'rotated-secret' }),
    );
  });
  it('Apple relay/missing-email and Google email changes do not change provider subject', () => {
    const apple = mapProfile(
      'apple-namespace',
      { sub: 'stable', email: 'relay@privaterelay.appleid.com', email_verified: 'true', name: '' },
      'apple',
    );
    expect(apple).toMatchObject({
      email: 'relay@privaterelay.appleid.com',
      emailVerified: true,
      name: 'Partner',
    });
    expect(mapProfile('apple-namespace', { sub: 'stable' }, 'apple').emailVerified).toBe(false);
    expect(
      mapProfile(
        'google-namespace',
        { sub: 'stable', email: 'new@example.test', email_verified: true },
        'google',
      ),
    ).not.toHaveProperty('id');
  });
  it('pins database state, no cookie cache/implicit linking/password/native tokens', () => {
    const options = identityOptions(readIdentityConfig(inputs), memoryAdapter({}));
    expect(options.session.cookieCache.enabled).toBe(false);
    expect(options.account).toMatchObject({
      storeStateStrategy: 'database',
      skipStateCookieCheck: false,
      encryptOAuthTokens: true,
      accountLinking: {
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
      },
    });
    expect(options.emailAndPassword.enabled).toBe(false);
    for (const provider of Object.values(options.socialProviders))
      expect(provider.disableIdTokenSignIn).toBe(true);
  });
});

describe('maintained Next adapter with synthetic memory persistence (not real-provider acceptance)', () => {
  it('the application route stays unavailable with identity flag off', async () => {
    vi.stubEnv('LABSD_IDENTITY_ENABLED', '0');
    const route = await import('../../app/api/auth/[...all]/route');
    const response = await route.GET(request('/get-session'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(await response.json()).toEqual({ code: 'IDENTITY_UNAVAILABLE', retryable: true });
  });
  it('LINE authorization uses only openid/profile, S256 and a secure browser-bound state cookie', async () => {
    const { handler, memory } = setup();
    const response = await handler.POST(
      request('/sign-in/social', { provider: 'line', callbackURL: '/access/pending' }),
    );
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url);
    expect(url.origin).toBe('https://access.line.me');
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['openid', 'profile']);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.searchParams.get('redirect_uri')).toBe(
      inputs.BETTER_AUTH_URL + '/api/auth/callback/line',
    );
    const cookie = response.headers.getSetCookie().join(';');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(memory.verification).toHaveLength(1);
    expect(memory.session).toHaveLength(0);
  });
  it('Apple POST bounces through native callback and requires matching cookie; consumed state rejects replay', async () => {
    const { handler, memory } = setup();
    const start = await handler.POST(
      request('/sign-in/social', { provider: 'apple', callbackURL: '/access/pending' }),
    );
    const url = new URL((await start.json()).url);
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    const state = url.searchParams.get('state')!;
    const cookie = start.headers
      .getSetCookie()
      .map((row) => row.split(';')[0])
      .join('; ');
    const post = await handler.POST(
      new Request(inputs.BETTER_AUTH_URL + '/api/auth/callback/apple', {
        method: 'POST',
        headers: {
          origin: 'https://appleid.apple.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ state, error: 'access_denied' }),
      }),
    );
    expect(post.status).toBe(302);
    const target = post.headers.get('location')!;
    expect(new URL(target).origin).toBe(inputs.BETTER_AUTH_URL);
    const foreign = await handler.GET(new Request(target));
    expect(foreign.headers.get('location')).toContain('error=state_mismatch');
    expect(memory.verification).toHaveLength(1);
    const cancellation = await handler.GET(new Request(target, { headers: { cookie } }));
    expect(cancellation.headers.get('location')).toContain('error=access_denied');
    expect(memory.verification).toHaveLength(0);
    expect(memory.session).toHaveLength(0);
    const replay = await handler.GET(new Request(target, { headers: { cookie } }));
    expect(replay.headers.get('location')).toContain('error=state_mismatch');
  });
  it('rejects direct ID tokens, external return destinations and unready account actions', async () => {
    const { handler } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No external calls allowed by this test');
      }),
    );
    for (const provider of ['google', 'line', 'apple']) {
      const response = await handler.POST(
        request('/sign-in/social', { provider, idToken: { token: 'invalid-test-token' } }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    for (const callbackURL of [
      'https://evil.example.test',
      'https://appleid.apple.com',
      '/api/auth/get-session',
      '//evil.example.test',
      '/content/%2fsecret',
    ]) {
      const external = await handler.POST(
        request('/sign-in/social', { provider: 'line', callbackURL }),
      );
      expect(external.status).toBe(403);
    }
    expect((await handler.POST(request('/link-social', { provider: 'line' }))).status).toBe(404);
    expect((await handler.POST(request('/unlink-account', { providerId: 'line' }))).status).toBe(
      404,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
