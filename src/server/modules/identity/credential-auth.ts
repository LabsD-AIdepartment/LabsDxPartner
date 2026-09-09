import { createHash } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { username } from 'better-auth/plugins/username';
import { z } from 'zod';
import {
  CredentialLogin,
  Username,
  normalizeUsername,
  passwordPolicy,
} from '@/contracts/credentials';
import { safeReturnTo } from '@/shared/routing/partner-paths';
import { baseIdentityConfigSchema, IdentityConfigurationError } from './provider-config';
import { FRESH_SESSION_SECONDS } from './policy';

export type CredentialConfig = z.infer<typeof baseIdentityConfigSchema>;
export function readCredentialConfig(env: Record<string, string | undefined>): CredentialConfig {
  const result = baseIdentityConfigSchema.safeParse(env);
  if (!result.success)
    throw new IdentityConfigurationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  return result.data;
}
export const CREDENTIAL_BINDING_ID = 'credentials-v1';
export const credentialBindingDigest = (config: CredentialConfig) =>
  createHash('sha256')
    .update(JSON.stringify([CREDENTIAL_BINDING_ID, config.BETTER_AUTH_URL]))
    .digest('hex');

const allowed = new Map([
  ['/sign-in/username', 'POST'],
  ['/get-session', 'GET'],
  ['/sign-out', 'POST'],
]);

/** Same maintained engine, configured for D-025. No public account creation or recovery bypass. */
export function credentialOptions(
  config: CredentialConfig,
  database: NonNullable<BetterAuthOptions['database']>,
) {
  return {
    appName: 'Labs D x Partner',
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    database,
    telemetry: { enabled: false },
    logger: { disabled: true },
    trustedOrigins: [config.BETTER_AUTH_URL],
    socialProviders: {},
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: passwordPolicy.minLength,
      maxPasswordLength: passwordPolicy.maxLength,
    },
    plugins: [
      username({
        displayUsername: false,
        immutableUsername: true,
        usernameNormalization: normalizeUsername,
        usernameValidator: (value) => Username.safeParse(value).success,
        validationOrder: { username: 'post-normalization' },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!allowed.has(ctx.path)) throw new APIError('NOT_FOUND', { message: 'Not found' });
        // The username plugin does not enforce Origin for cookie-less login by itself.
        // These are browser-only mutations; server-side credential setup has its own service.
        if (
          allowed.get(ctx.path) === 'POST' &&
          ctx.headers?.get('origin') !== config.BETTER_AUTH_URL
        )
          throw new APIError('FORBIDDEN', { message: 'Invalid request origin' });
        if (ctx.path === '/sign-in/username') {
          const body = CredentialLogin.safeParse(ctx.body);
          if (!body.success) throw new APIError('BAD_REQUEST', { message: 'Invalid credentials' });
          const destination = body.data.callbackURL;
          if (destination !== undefined && safeReturnTo(destination) !== destination)
            throw new APIError('FORBIDDEN', { message: 'Invalid return destination' });
          ctx.body = body.data;
        }
      }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: FRESH_SESSION_SECONDS,
      cookieCache: { enabled: false },
    },
    account: { accountLinking: { enabled: false } },
    advanced: {
      useSecureCookies: true,
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: 'labsd-partner',
      trustedProxyHeaders: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: true },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: { '/sign-in/username': { window: 60, max: 10 } },
    },
  } satisfies BetterAuthOptions;
}
export const createCredentialIdentity = (
  config: CredentialConfig,
  database: NonNullable<BetterAuthOptions['database']>,
) => betterAuth(credentialOptions(config, database));

/** Allowlist also rejects routes before the library parses tokens, passwords or provider callbacks. */
export function credentialHandler(auth: ReturnType<typeof createCredentialIdentity>) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const path = url.pathname.startsWith('/api/auth/')
      ? url.pathname.slice('/api/auth'.length)
      : '';
    if (allowed.get(path) !== request.method)
      return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
    return auth.handler(request);
  };
}
