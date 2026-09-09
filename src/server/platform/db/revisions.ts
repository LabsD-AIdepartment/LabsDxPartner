import type { TransactionSql } from 'postgres';
import { ChangeGroups, type ChangeGroup, Changes } from '@/contracts/changes';
import type { PartnerScope } from '@/server/modules/partners/access';

/** Call only within the owner's successful data transaction, never from a read route. */
export async function advanceRevisions(
  tx: TransactionSql,
  partnerId: string,
  groups: readonly ChangeGroup[],
) {
  if (!groups.length || groups.some((group) => !ChangeGroups.includes(group)))
    throw new Error('Invalid revision groups');
  const delta = Object.fromEntries(
    ChangeGroups.map((group) => [group, groups.includes(group) ? 1 : 0]),
  );
  await tx`insert into portal_meta.partner_changes(partner_id,earnings,settlements,metrics,notices)
    values(${partnerId},${delta.earnings},${delta.settlements},${delta.metrics},${delta.notices})
    on conflict(partner_id) do update set
      earnings=portal_meta.partner_changes.earnings+excluded.earnings,
      settlements=portal_meta.partner_changes.settlements+excluded.settlements,
      metrics=portal_meta.partner_changes.metrics+excluded.metrics,
      notices=portal_meta.partner_changes.notices+excluded.notices,
      published_at=clock_timestamp()`;
}

/** One indexed metadata lookup; zero revisions mean no committed change, not zero money. */
export async function readRevisions(tx: TransactionSql, scope: PartnerScope) {
  const [row] =
    await tx`select earnings::text,settlements::text,metrics::text,notices::text,published_at
    from portal_meta.partner_changes where partner_id=${scope.partnerId}`;
  return Changes.parse({
    partnerId: scope.partnerId,
    permissionRevision: scope.permissionRevision,
    earningsRevision: row?.earnings ?? '0',
    settlementsRevision: row?.settlements ?? '0',
    metricsRevision: row?.metrics ?? '0',
    noticesRevision: row?.notices ?? '0',
    publishedAt: row ? new Date(row.published_at).toISOString() : '1970-01-01T00:00:00.000Z',
    sources: [],
  });
}
