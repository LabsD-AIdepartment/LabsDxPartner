import { z } from 'zod';
import { FacebookConnection, createFacebookAdapter } from './adapter';
import { FacebookReadError, type FacebookReadDependencies } from './graph';

const Profile = FacebookConnection.extend({
  acquisitionOwner: z.literal('portal-direct'),
  tokenEnv: z.string().regex(/^LABSD_FB_[A-Z0-9_]+_TOKEN$/),
  appSecretEnv: z
    .string()
    .regex(/^LABSD_FB_[A-Z0-9_]+_APP_SECRET$/)
    .optional(),
});
export type FacebookProfile = z.infer<typeof Profile>;
/** Metadata and secret REFERENCES only. Does not copy, refresh, grant or enable any account. */
export function readFacebookProfiles(env: Record<string, string | undefined>): FacebookProfile[] {
  if (env.LABSD_FACEBOOK_READ_ENABLED !== '1') return [];
  return parseFacebookProfiles(env.LABSD_FACEBOOK_PROFILES);
}
/** Operator metadata validation also works while source reads are disabled. Never resolves secrets. */
export function parseFacebookProfiles(raw: string | undefined): FacebookProfile[] {
  if (!raw || raw.length > 64_000)
    throw new Error('Facebook profile configuration is missing or too large');
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('Invalid Facebook profile configuration');
  }
  const parsed = z.array(Profile).min(1).max(100).safeParse(input);
  if (!parsed.success) throw new Error('Invalid Facebook profile configuration');
  const profiles = parsed.data;
  if (
    new Set(profiles.map((p) => p.id)).size !== profiles.length ||
    new Set(profiles.map((p) => JSON.stringify([p.namespace, p.accountId]))).size !==
      profiles.length
  )
    throw new Error('Duplicate Facebook account configuration');
  return profiles;
}
/** Acquisition owner must provide account quota coordination before installing in native runtime. */
export function configuredFacebookAdapter(
  env: Record<string, string | undefined>,
  controls: Required<Pick<FacebookReadDependencies, 'beforeRequest' | 'recordUsage'>> &
    Pick<FacebookReadDependencies, 'fetch' | 'now'>,
) {
  const profiles = readFacebookProfiles(env);
  if (!profiles.length) return null;
  const available = profiles.filter(
    (p) => !!env[p.tokenEnv] && (!p.appSecretEnv || !!env[p.appSecretEnv]),
  );
  if (!available.length) return null;
  return createFacebookAdapter(
    available.map(({ id, namespace, accountId, currency, timezone }) => ({
      id,
      namespace,
      accountId,
      currency,
      timezone,
    })),
    {
      ...controls,
      credential: async (id, signal) => {
        signal.throwIfAborted();
        const p = available.find((p) => p.id === id);
        if (!p || !env[p.tokenEnv] || (p.appSecretEnv && !env[p.appSecretEnv]))
          throw new FacebookReadError('access');
        return {
          token: env[p.tokenEnv]!,
          appSecret: p.appSecretEnv ? env[p.appSecretEnv] : undefined,
        };
      },
    },
  );
}
