import { createHash } from 'node:crypto';
import { z } from 'zod';

const required = z.string().trim().min(1);
const origin = required
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.hostname === 'localhost'
      )
        throw new Error();
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Registered HTTPS origin required' });
    }
  })
  .transform((value) => new URL(value).origin);

const configSchema = z.object({
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: required.min(32),
  DATABASE_URL: required.refine((value) => {
    try {
      return ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }),
  GOOGLE_CLIENT_ID: required,
  GOOGLE_CLIENT_SECRET: required,
  LINE_CLIENT_ID: required,
  LINE_CLIENT_SECRET: required,
  APPLE_CLIENT_ID: required,
  APPLE_TEAM_ID: required,
  APPLE_CLIENT_SECRET: required,
});
export type IdentityConfig = z.infer<typeof configSchema>;
export type ProviderId = 'google' | 'line' | 'apple';

/** A safe error lists field names only: never retain a Zod input/error or secret value. */
export class IdentityConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super('Identity configuration is incomplete or invalid');
  }
}
export function readIdentityConfig(env: Record<string, string | undefined>): IdentityConfig {
  const result = configSchema.safeParse(env);
  if (!result.success)
    throw new IdentityConfigurationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  return result.data;
}
export function providerNamespace(config: IdentityConfig, provider: ProviderId): string {
  const namespace =
    provider === 'google'
      ? ['https://accounts.google.com', config.GOOGLE_CLIENT_ID]
      : provider === 'line'
        ? ['https://access.line.me', config.LINE_CLIENT_ID]
        : ['https://appleid.apple.com', config.APPLE_TEAM_ID, config.APPLE_CLIENT_ID];
  return JSON.stringify([provider, ...namespace]);
}
/** The DB binding must be provisioned explicitly; changing OAuth clients cannot silently reuse subjects. */
export function identityBindingDigest(config: IdentityConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        ['google', 'line', 'apple'].map((id) => providerNamespace(config, id as ProviderId)),
      ),
    )
    .digest('hex');
}
