import type { Sql } from 'postgres';
import { configuredFacebookAdapter, readFacebookProfiles } from './facebook/config';
import { createFacebookQuota } from './facebook/quota';
import { createMarketingProviderRegistry } from './provider';
import type { FacebookReadDependencies } from './facebook/graph';

/** Pure server composition. No connection creation, access grants or configuration values in output. */
export function createConfiguredMarketingProviders(
  sql: Sql,
  env: Record<string, string | undefined>,
  assertBinding: () => Promise<void>,
  transport: Pick<FacebookReadDependencies, 'fetch' | 'now'> = {},
) {
  const profiles = readFacebookProfiles(env);
  const adapter = configuredFacebookAdapter(env, {
    ...createFacebookQuota(sql, profiles, assertBinding),
    ...transport,
  });
  return {
    providers: createMarketingProviderRegistry(adapter ? [adapter] : []),
    profiles: profiles.filter((p) => adapter?.supportsConnection?.(p.id)),
  };
}
