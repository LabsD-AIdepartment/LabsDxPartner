import { z } from 'zod';
import { Id, Instant, Money, Count, Period, Freshness, page } from './common';
import { AgreementVersion } from './earnings';
import { Statement } from './statements';
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
export const OpsCapability = z.enum([
  'manage_partners',
  'review_imports',
  'publish_statements',
  'record_payments',
]);
export const StaffPartner = z.strictObject({
  id: Id,
  name: z.string().min(1),
  membership: z.enum(['pending', 'active', 'suspended']),
  verifiedContactRef: Id.nullable(),
  agreementVersion: Id.nullable(),
  contentRefs: z.array(Id).max(100),
  skuRefs: z.array(Id).max(100),
});
export const PeriodReview = z.strictObject({
  id: Id,
  partnerId: Id,
  partnerName: z.string().min(1),
  period: Period,
  generation: Id,
  status: z.enum(['draft', 'needs-review', 'reconciled', 'published']),
  confirmed: Money,
  excludedCount: Count,
  unresolvedCount: Count,
  evidenceRef: Id,
  statement: Statement.nullable(),
});
export const OpsSnapshot = Freshness.extend({
  actorId: Id,
  permissionRevision: Id,
  revision: Id,
  capabilities: z.array(OpsCapability),
  partners: page(StaffPartner),
  imports: ImportList,
  periods: page(PeriodReview),
  agreements: z.array(AgreementVersion).max(100),
});
export const OpsCommand = z.discriminatedUnion('action', [
  InviteRequest.extend({ action: z.literal('invite') }),
  z.strictObject({
    action: z.literal('membership'),
    partnerId: Id,
    status: z.enum(['active', 'suspended']),
    verifiedContactRef: Id,
    idempotencyKey: Id,
  }),
  z.strictObject({
    action: z.literal('terms'),
    partnerId: Id,
    agreementVersion: Id,
    contentRefs: z.array(Id).max(100),
    skuRefs: z.array(Id).max(100),
    idempotencyKey: Id,
  }),
  ImportRequest.extend({ action: z.literal('import') }),
  PublishRequest.extend({
    action: z.literal('publish'),
    periodId: Id,
    partnerId: Id,
    evidenceRef: Id,
  }),
  PaymentRequest.extend({ action: z.literal('payment'), partnerId: Id, paidAt: Instant }),
]);
export const OpsActionResult = OperationResult.extend({
  actorId: Id,
  targetId: Id,
  message: z.string().min(1),
});
