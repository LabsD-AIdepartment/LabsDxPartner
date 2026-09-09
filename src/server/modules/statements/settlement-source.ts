import { z } from 'zod';
import { Id, Instant, Minor } from '@/contracts/common';
import { EvidenceRef } from '@/contracts/access';
const Amount = Minor.refine((v) => BigInt(v) >= 0n);
const SourceKey = z.strictObject({
  authority: EvidenceRef,
  account: EvidenceRef,
  reference: EvidenceRef,
});
const Allocation = z
  .strictObject({
    statementId: z.uuid(),
    cashMinor: Amount,
    withholdingMinor: Amount,
    otherMinor: Amount,
    otherReasonRef: EvidenceRef.nullable(),
  })
  .refine((v) => BigInt(v.cashMinor) + BigInt(v.withholdingMinor) + BigInt(v.otherMinor) > 0n)
  .refine((v) => BigInt(v.otherMinor) === 0n || v.otherReasonRef !== null);
const base = { source: SourceKey, partnerId: Id, evidenceRef: EvidenceRef, occurredAt: Instant };
export const SourceSettlement = z.discriminatedUnion('kind', [
  z
    .strictObject({
      ...base,
      kind: z.literal('payment'),
      cashMinor: Amount,
      withholdingMinor: Amount,
      otherMinor: Amount,
      allocations: z.array(Allocation).min(1).max(100),
    })
    .refine((v) => new Set(v.allocations.map((a) => a.statementId)).size === v.allocations.length)
    .refine((v) =>
      (['cashMinor', 'withholdingMinor', 'otherMinor'] as const).every(
        (k) => v.allocations.reduce((sum, a) => sum + BigInt(a[k]), 0n) === BigInt(v[k]),
      ),
    ),
  z.strictObject({
    ...base,
    kind: z.literal('reversal'),
    original: SourceKey,
    reasonRef: EvidenceRef,
  }),
]);
export type SourceSettlementValue = z.infer<typeof SourceSettlement>;
/** Server adapter for already approved finance records. Browser commands cannot supply amounts. */
export interface SourceSettlementRepository {
  load(id: string): Promise<unknown>;
}
