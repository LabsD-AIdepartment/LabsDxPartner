import { z } from 'zod';
import { Id, Instant, Money, Count, page } from './common';
export const InviteRequest = z.strictObject({
  partnerId: Id,
  expiresAt: Instant,
  idempotencyKey: Id,
});
export const ImportRequest = z.strictObject({ source: Id, evidenceRef: Id, idempotencyKey: Id });
export const PublishRequest = z.strictObject({ generation: Id, idempotencyKey: Id });
export const PaymentRequest = z.strictObject({
  statementId: Id,
  reference: Id,
  cash: Money,
  withholding: Money,
  other: Money,
  evidenceRef: Id,
  idempotencyKey: Id,
});
export const OperationResult = z.strictObject({
  id: Id,
  status: z.enum(['pending', 'complete', 'rejected']),
  requestId: Id,
});
export const ImportRun = z.strictObject({
  id: Id,
  source: Id,
  status: z.enum(['running', 'reconciled', 'failed', 'needs-review']),
  startedAt: Instant,
  publishedAt: Instant.nullable(),
  acceptedCount: Count,
  excludedCount: Count,
  reasons: z.array(z.string()),
});
export const ImportList = page(ImportRun);
