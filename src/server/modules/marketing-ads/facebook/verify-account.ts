import type { Sql } from 'postgres';
import { z } from 'zod';
import { readFacebookProfiles } from './config';
import { createFacebookQuota } from './quota';
import {
  createFacebookGraph,
  FACEBOOK_VERSION,
  FacebookReadError,
  type FacebookReadDependencies,
} from './graph';
import { VerifiedAccount } from '@/contracts/marketing-connections';
const Account = z.object({
  id: z.string(),
  account_id: z.string(),
  currency: z.string(),
  timezone_name: z.string(),
});
/** Only an exact configured act_ metadata GET. Caller checks current staff + account grant before/after. */
export function createFacebookAccountVerifier(
  sql: Sql,
  env: Record<string, string | undefined>,
  assertBinding: () => Promise<void>,
  transport: Pick<FacebookReadDependencies, 'fetch' | 'now'> = {},
) {
  // Pausing an existing account must remain possible when optional source config is broken.
  const profiles = (() => {
    try {
      return readFacebookProfiles(env).filter(
        (p) => !!env[p.tokenEnv] && (!p.appSecretEnv || !!env[p.appSecretEnv]),
      );
    } catch {
      return [];
    }
  })();
  return {
    configured(id: string) {
      return profiles.find((p) => p.id === id);
    },
    async verify(id: string, signal: AbortSignal) {
      const profile = profiles.find((p) => p.id === id);
      if (!profile) throw new FacebookReadError('access');
      const graph = createFacebookGraph({
        ...createFacebookQuota(sql, [profile], assertBinding, true),
        ...transport,
        credential: async () => ({
          token: env[profile.tokenEnv] ?? '',
          appSecret: profile.appSecretEnv ? env[profile.appSecretEnv] : undefined,
        }),
      });
      const result = Account.safeParse(
        await graph(
          id,
          'act_' + profile.accountId,
          { fields: 'id,account_id,currency,timezone_name' },
          signal,
        ),
      );
      if (!result.success) throw new FacebookReadError('invalid-source');
      const a = result.data;
      if (
        a.id !== 'act_' + profile.accountId ||
        a.account_id !== profile.accountId ||
        a.currency !== profile.currency ||
        a.timezone_name !== profile.timezone
      )
        throw new FacebookReadError('invalid-source');
      return VerifiedAccount.parse({
        accountId: a.account_id,
        currency: a.currency,
        timezone: a.timezone_name,
        apiVersion: FACEBOOK_VERSION,
        checkedAt: new Date((transport.now ?? Date.now)()).toISOString(),
      });
    },
  };
}
