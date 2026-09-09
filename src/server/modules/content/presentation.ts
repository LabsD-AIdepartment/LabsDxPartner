import type { TransactionSql } from 'postgres';
import type { PartnerScope } from '@/server/modules/partners/access';
import { PresentationResponse } from '@/contracts/catalogue';

/** Kept transaction-scoped so future Overview composition can share its snapshot. */
export async function readPresentation(tx: TransactionSql, scope: PartnerScope) {
  const [row] = await tx`select c.revision::text,c.published_at,c.profile
    from portal_content.catalogues c where c.partner_id=${scope.partnerId}`;
  return PresentationResponse.parse({
    partnerId: scope.partnerId,
    permissionRevision: scope.permissionRevision,
    revision: row?.revision ?? '0',
    publishedAt: row ? new Date(row.published_at).toISOString() : null,
    profile: row?.profile ?? null,
  });
}
