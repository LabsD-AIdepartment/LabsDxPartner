import { z } from 'zod';
import { Id, Money, Instant, Period, page } from './common';
import { EarningsLine } from './earnings';
export const Settlement = z
  .strictObject({
    id: Id,
    reference: Id,
    recordedAt: Instant,
    cash: Money,
    withholding: Money,
    other: Money,
    obligationSettled: Money,
    evidenceRef: Id,
  })
  .refine(
    (s) =>
      BigInt(s.cash.minor) + BigInt(s.withholding.minor) + BigInt(s.other.minor) ===
      BigInt(s.obligationSettled.minor),
    'Settlement components must equal the obligation settled',
  );
export const Statement = z
  .strictObject({
    id: Id,
    version: Id,
    period: Period,
    publishedAt: Instant,
    settlementAsOf: Instant,
    status: z.enum(['pending', 'part-paid', 'paid', 'credit']),
    opening: Money,
    newEarnings: Money,
    adjustments: Money,
    settled: Money,
    closing: Money,
  })
  .refine(
    (s) =>
      BigInt(s.opening.minor) +
        BigInt(s.newEarnings.minor) +
        BigInt(s.adjustments.minor) -
        BigInt(s.settled.minor) ===
      BigInt(s.closing.minor),
    'Statement bridge does not reconcile',
  );
export const DocumentRef = z.strictObject({
  id: Id,
  statementId: Id,
  name: z.string().min(1),
  kind: z.enum(['statement', 'payment-evidence', 'agreement']),
});
export const StatementList = page(Statement);
export const StatementDetail = z.strictObject({
  statement: Statement,
  lines: page(EarningsLine),
  settlements: page(Settlement),
  documents: z.array(DocumentRef),
});
export const DownloadResponse = z.strictObject({
  downloadUrl: z.url().refine((v) => v.startsWith('https://')),
  expiresAt: Instant,
});
export const ExportRequest = z.strictObject({ statementId: Id, version: Id });
