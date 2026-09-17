import type { Sql, TransactionSql } from 'postgres';
import { parseShopVideoProfiles } from './video-config';
import { createShopVideoOwnerClient } from './owner-client';
import { createShopVideoStore } from './video-store';
import { runShopVideoTick } from './video-worker';

/** Native worker composition. No provider token or refresh function exists on the portal side. */
export function createConfiguredShopVideoWorker(
  sql: Sql,
  env: Record<string, string | undefined>,
  assertBinding: (tx: TransactionSql) => Promise<void>,
  fetcher?: typeof fetch,
) {
  if (
    env.LABSD_MARKETING_ENABLED !== '1' ||
    env.LABSD_TIKTOK_VIDEO_ENABLED !== '1' ||
    env.LABSD_TIKTOK_VIDEO_SYNC_ENABLED !== '1'
  )
    return null;
  const profiles = parseShopVideoProfiles(env.LABSD_TIKTOK_VIDEO_PROFILES);
  const owner = createShopVideoOwnerClient(
    profiles,
    env.LABSD_TIKTOK_OWNER_ORIGIN ?? '',
    env.LABSD_TIKTOK_OWNER_SERVICE_TOKEN ?? '',
    fetcher,
  );
  const connections = profiles.map(({ connectionId, namespace, shopId, currency, timezone }) => ({
    connectionId,
    namespace,
    shopId,
    currency,
    timezone,
  }));
  const store = createShopVideoStore(sql, connections, assertBinding);
  return {
    owner,
    run(signal: AbortSignal) {
      return runShopVideoTick(
        store,
        { page: owner.page },
        { connectionIds: connections.map((c) => c.connectionId) },
        signal,
      );
    },
  };
}
