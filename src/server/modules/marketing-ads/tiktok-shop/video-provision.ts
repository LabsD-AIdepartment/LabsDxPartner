import type { Sql, TransactionSql } from 'postgres';
import { createConnectionProvisioner } from '../provision';
import { parseShopVideoProfiles, type VideoProfile } from './video-config';

/** Trusted operator metadata only: creates disabled, unverified shop records, never source access. */
export function createShopVideoProvisioner(
  sql: Sql,
  profiles: readonly VideoProfile[],
  assertBinding: (tx: TransactionSql) => Promise<string>,
) {
  return createConnectionProvisioner(
    sql,
    parseShopVideoProfiles(JSON.stringify(profiles)).map((p) => {
      return {
        id: p.connectionId,
        namespace: p.namespace,
        accountId: p.shopId,
        currency: p.currency,
        timezone: p.timezone,
        acquisitionOwner: p.acquisitionOwner,
        platform: 'tiktok' as const,
        capability: 'tiktok.shop_video' as const,
        configuration: p,
      };
    }),
    assertBinding,
  );
}
