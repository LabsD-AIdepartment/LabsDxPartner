import { z } from 'zod';
import { Id, Money, Instant, Period, Count, envelope, page } from './common';
export const RoundingRule = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('per-line'),
    tieBreak: z.literal('half-away-from-zero'),
    allocation: z.literal('none'),
  }),
  z.strictObject({
    mode: z.literal('per-period'),
    tieBreak: z.literal('half-away-from-zero'),
    allocation: z.literal('largest-remainder-stable-id'),
  }),
]);
export const Rate = z.number().int().min(0).max(1000000);
export const AgreementVersion = z.strictObject({
  id: Id,
  partnerId: Id,
  effective: Period,
  calculationPeriod: z.enum(['day', 'month', 'statement']),
  roundingRule: RoundingRule,
  evidenceRef: Id,
});
export const EarningsLine = z
  .strictObject({
    id: Id,
    sourceRef: Id,
    sourceRevision: Id,
    agreementVersion: Id,
    earnedAt: Instant,
    contentId: Id.nullable(),
    kind: z.enum(['commission', 'fixed-fee', 'bonus', 'adjustment']),
    eligibleBase: Money.nullable(),
    ratePpm: Rate.nullable(),
    amount: Money,
    status: z.enum(['estimated', 'confirmed', 'adjustment']),
    reason: z.string().min(1).nullable(),
    evidenceRef: Id,
    originalLineId: Id.nullable(),
    attribution: z.enum(['content', 'partner-only']),
  })
  .superRefine((v, ctx) => {
    const problem = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (v.kind === 'commission' && (v.eligibleBase === null || v.ratePpm === null))
      problem('Commission needs eligible base and rate');
    if (['fixed-fee', 'bonus'].includes(v.kind) && (v.eligibleBase !== null || v.ratePpm !== null))
      problem('Fixed amounts cannot invent sales');
    if (v.kind === 'adjustment' && (!v.originalLineId || !v.reason || v.status !== 'adjustment'))
      problem('Adjustment needs original line, reason and status');
    if (v.kind !== 'adjustment' && v.status === 'adjustment')
      problem('Adjustment status requires adjustment kind');
    if ((v.attribution === 'partner-only') !== (v.contentId === null))
      problem('Attribution grain must match content mapping');
  });
export type EarningsLineValue = z.infer<typeof EarningsLine>;
export const EarningsResponse = envelope(
  page(EarningsLine).extend({ excludedCount: Count, unassignedAmount: Money }),
);
