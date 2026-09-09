import { z } from 'zod';
import { Id, Instant, Money, Count, Period, page } from './common';
import { PermissionRevision } from './access';
import { StaffAccessSession } from './staff-access';
export const FinanceQuery = z
  .strictObject({
    expectedRevision: PermissionRevision,
    partnerId: Id.optional(),
    q: z.string().max(160).default(''),
    scopeId: Id.optional(),
    cursor: z.string().max(1000).optional(),
    lineCursor: z.string().max(1000).optional(),
    generationId: z.uuid().optional(),
  })
  .refine((q) =>
    q.scopeId
      ? !q.cursor && !!q.partnerId && (!q.lineCursor || !!q.generationId)
      : !q.lineCursor && !q.generationId,
  );
export const FinancePeriod = z.strictObject({
  id: Id,
  partnerId: Id,
  partnerName: z.string(),
  partnerActive: z.boolean(),
  period: Period,
  generationId: z.uuid().nullable(),
  approvalId: z.uuid().nullable(),
  reviewId: Id.nullable(),
  state: z.enum(['waiting', 'ready', 'blocked', 'published']),
  amount: Money.nullable(),
  eligibleBase: Money.nullable(),
  includedCount: Count.nullable(),
  excludedCount: Count.nullable(),
  issues: z.array(z.string().max(500)).max(30),
  dataThrough: Instant.nullable(),
  statementId: z.uuid().nullable(),
  scheduledAt: Instant.nullable(),
  settled: Money.nullable(),
  closing: Money.nullable(),
});
export const FinanceLine = z.strictObject({
  id: z.uuid(),
  reference: Id,
  sourceId: Id,
  evidenceRef: Id,
  earnedAt: Instant,
  kind: z.enum(['commission', 'fixed-fee', 'bonus', 'adjustment', 'excluded']),
  amount: Money.nullable(),
  base: Money.nullable(),
  ratePpm: Count.nullable(),
  agreementVersion: Id.nullable(),
  contentId: Id.nullable(),
  reasonRef: Id.nullable(),
});
export const FinanceSnapshot = z.strictObject({
  session: StaffAccessSession,
  q: z.string().max(160),
  partnerId: Id.nullable(),
  scopeId: Id.nullable(),
  periods: page(FinancePeriod),
  lines: page(FinanceLine).nullable(),
  asOf: Instant,
});
export const FinancePublish = z.strictObject({
  expectedStaffRevision: PermissionRevision,
  partnerId: Id,
  generationId: z.uuid(),
  approvalId: z.uuid(),
  scheduledAt: Instant,
  idempotencyKey: Id,
});
export const FinancePublished = z.strictObject({
  id: z.uuid(),
  version: z.uuid(),
  replayed: z.boolean(),
});
export type FinancePeriodValue = z.infer<typeof FinancePeriod>;
