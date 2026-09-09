import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import {
  entitlementKey,
  type EntitlementValue,
  type IncludedRow,
} from '@/server/adapters/approved-period/schema';
import { AccessFailure } from '@/server/modules/partners/access';
export const earningLineRef = (generationId: string, entitlement: EntitlementValue) =>
  createHash('sha256')
    .update(JSON.stringify([generationId, entitlementKey(entitlement)]))
    .digest('hex');
export type CorrectionLink = {
  entitlement_key: string;
  original_generation_id: string;
  original_entitlement_key: string;
  revision_sequence: string;
  prior_sequence: string;
  prior_amount_minor: string;
  revised_amount_minor: string;
};
/** Batch history read: no per-row database round trips, no untrusted history injected by a caller. */
export async function resolveCorrections(
  tx: TransactionSql,
  partnerId: string,
  scopeId: string,
  periodFrom: string,
  rows: IncludedRow[],
): Promise<CorrectionLink[]> {
  const corrections = rows.filter((r) => r.earning.kind === 'adjustment' && r.earning.correction);
  if (!corrections.length) return [];
  const roots = corrections.map((row, index) => {
    if (row.earning.kind !== 'adjustment' || !row.earning.correction)
      throw new Error('Expected correction');
    return {
      index,
      generation: row.earning.correction.originalGenerationId,
      key: entitlementKey(row.earning.correction.originalEntitlement),
    };
  });
  if (new Set(roots.map((r) => JSON.stringify([r.generation, r.key]))).size !== roots.length)
    throw new AccessFailure('conflict');
  const history =
    await tx`select j.index,r.amount_minor::text as original_amount,r.content_id,r.payload,s.period_to,
      coalesce(last.revision_sequence,0)::text as prior_sequence,
      coalesce(last.revised_amount_minor,r.amount_minor)::text as prior_amount,
      exists(select 1 from portal_imports.correction_links pending join portal_imports.scopes p on p.current_generation=pending.generation_id
        where pending.original_generation_id=j.generation and pending.original_entitlement_key=j.key
        and p.id<>${scopeId} and p.closed_statement_ref is null) as pending
    from jsonb_to_recordset(${JSON.stringify(roots)}::text::jsonb) as j(index int,generation uuid,key text)
    left join portal_imports.earning_rows r on r.generation_id=j.generation and r.entitlement_key=j.key
    left join portal_statements.statements s on s.generation_id=r.generation_id and s.partner_id=${partnerId}
    left join lateral(select l.revision_sequence,l.revised_amount_minor from portal_imports.correction_links l
      join portal_statements.statements issued on issued.generation_id=l.generation_id and issued.partner_id=${partnerId}
      where l.original_generation_id=j.generation and l.original_entitlement_key=j.key order by l.revision_sequence desc limit 1) last on true`;
  return history.map((h) => {
    const row = corrections[h.index];
    if (row.earning.kind !== 'adjustment' || !row.earning.correction)
      throw new Error('Expected correction');
    const c = row.earning.correction;
    const content = row.attribution.kind === 'content' ? row.attribution.contentId : null;
    if (
      !h.period_to ||
      new Date(h.period_to).getTime() > Date.parse(periodFrom) ||
      h.original_amount === null ||
      h.payload.disposition !== 'included' ||
      h.payload.earning.kind === 'adjustment' ||
      h.pending ||
      h.payload.agreementVersion !== row.agreementVersion ||
      h.content_id !== content ||
      c.originalEntitlement.authority !== row.entitlement.authority ||
      c.originalEntitlement.account !== row.entitlement.account ||
      earningLineRef(c.originalGenerationId, c.originalEntitlement) !==
        row.earning.originalLineRef ||
      BigInt(c.revisionSequence) <= BigInt(h.prior_sequence) ||
      BigInt(c.revisedAmountMinor) - BigInt(h.prior_amount) !== BigInt(row.earning.amountMinor)
    )
      throw new AccessFailure('conflict');
    return {
      entitlement_key: entitlementKey(row.entitlement),
      original_generation_id: c.originalGenerationId,
      original_entitlement_key: entitlementKey(c.originalEntitlement),
      revision_sequence: c.revisionSequence,
      prior_sequence: h.prior_sequence,
      prior_amount_minor: h.prior_amount,
      revised_amount_minor: c.revisedAmountMinor,
    };
  });
}
export async function persistCorrectionLinks(
  tx: TransactionSql,
  generation: string,
  links: CorrectionLink[],
) {
  for (let start = 0; start < links.length; start += 500)
    await tx`insert into portal_imports.correction_links
    select ${generation}::uuid,l.* from jsonb_to_recordset(${JSON.stringify(links.slice(start, start + 500))}::text::jsonb)
    as l(entitlement_key text,original_generation_id uuid,original_entitlement_key text,revision_sequence bigint,
      prior_sequence bigint,prior_amount_minor numeric,revised_amount_minor numeric)`;
}
/** Must run while holding the same partner lock used by import/publication. */
export async function assertCorrectionHistoryCurrent(
  tx: TransactionSql,
  partnerId: string,
  generation: string,
) {
  const [stale] = await tx`select 1 from portal_imports.correction_links incoming
    join portal_imports.earning_rows original on original.generation_id=incoming.original_generation_id and original.entitlement_key=incoming.original_entitlement_key
    left join lateral(select l.revision_sequence,l.revised_amount_minor from portal_imports.correction_links l
      join portal_statements.statements s on s.generation_id=l.generation_id and s.partner_id=${partnerId}
      where l.original_generation_id=incoming.original_generation_id and l.original_entitlement_key=incoming.original_entitlement_key
      order by l.revision_sequence desc limit 1) last on true
    where incoming.generation_id=${generation} and (incoming.prior_sequence<>coalesce(last.revision_sequence,0)
      or incoming.prior_amount_minor<>coalesce(last.revised_amount_minor,original.amount_minor)) limit 1`;
  if (stale) throw new AccessFailure('conflict');
}
