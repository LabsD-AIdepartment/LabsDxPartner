import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { safeReturnTo } from '@/shared/routing/partner-paths';
import { mapProfile } from './profile-map';
import { providerNamespace, type IdentityConfig } from './provider-config';
import { FRESH_SESSION_SECONDS } from './policy';

/** Construction is injectable for adapter tests; production runtime supplies only the Postgres adapter. */
export function identityOptions(
  config: IdentityConfig,
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/social' && ctx.path !== '/link-social') return;
        for (const field of ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'] as const) {
          const value: unknown = ctx.body?.[field];
          if (
            value !== undefined &&
            value !== '/access/pending' &&
            value !== '/login' &&
            (typeof value !== 'string' || safeReturnTo(value) !== value)
          ) {
            throw new APIError('FORBIDDEN', { message: 'Invalid return destination' });
          }
        }
        if (ctx.body) ctx.body.callbackURL ??= '/access/pending';
      }),
    },
    trustedOrigins: [config.BETTER_AUTH_URL, 'https://appleid.apple.com'],
    emailAndPassword: { enabled: false },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        disableIdTokenSignIn: true,
        mapProfileToUser: (profile) =>
          mapProfile(providerNamespace(config, 'google'), profile, 'google'),
      },
      line: {
        clientId: config.LINE_CLIENT_ID,
        clientSecret: config.LINE_CLIENT_SECRET,
        disableIdTokenSignIn: true,
        disableDefaultScope: true,
        scope: ['openid', 'profile'],
        mapProfileToUser: (profile) =>
          mapProfile(providerNamespace(config, 'line'), profile, 'line'),
      },
      apple: {
        clientId: config.APPLE_CLIENT_ID,
        clientSecret: config.APPLE_CLIENT_SECRET,
        disableIdTokenSignIn: true,
        mapProfileToUser: (profile) =>
          mapProfile(providerNamespace(config, 'apple'), profile, 'apple'),
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: FRESH_SESSION_SECONDS,
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      skipStateCookieCheck: false,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        trustedProviders: [],
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    },
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
      customRules: { '/sign-in/social': { window: 60, max: 10 } },
    },
    // A02 must enforce fresh identity proofs and atomic last-method protection before enabling these.
    disabledPaths: [
      '/link-social',
      '/unlink-account',
      '/get-access-token',
      '/refresh-token',
      '/update-user',
      '/update-session',
      '/delete-user',
      '/change-email',
      '/sign-up/email',
      '/sign-in/email',
      '/request-password-reset',
      '/reset-password',
      '/change-password',
      '/set-password',
      '/send-verification-email',
    ],
  } satisfies BetterAuthOptions;
}
export function createIdentity(
  config: IdentityConfig,
  database: NonNullable<BetterAuthOptions['database']>,
) {
  return betterAuth(identityOptions(config, database));
}
