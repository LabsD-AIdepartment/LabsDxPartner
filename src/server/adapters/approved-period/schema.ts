import { z } from 'zod';
import { Instant, Minor, Period } from '@/contracts/common';
import { Rate, RoundingRule } from '@/contracts/earnings';
import { PermissionRevision } from '@/contracts/access';

// Offline parser safety bounds, not measured capacity or the interactive export limit.
export const INTAKE_LIMITS = { bytes: 16 * 1024 * 1024, rows: 50_000 } as const;
// Source owners supply scoped aliases. This grammar is not a PII detector.
const Ref = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const Entitlement = z.strictObject({
  authority: Ref,
  account: Ref,
  reference: Ref,
  line: Ref.nullable(),
  right: Ref,
});
export type EntitlementValue = z.infer<typeof Entitlement>;
export const entitlementKey = (v: EntitlementValue) =>
  JSON.stringify([v.authority, v.account, v.reference, v.line, v.right]);

const Controls = z.strictObject({
  rows: z.number().int().min(0).max(INTAKE_LIMITS.rows),
  included: z.number().int().min(0).max(INTAKE_LIMITS.rows),
  excluded: z.number().int().min(0).max(INTAKE_LIMITS.rows),
  unresolved: z.number().int().min(0).max(INTAKE_LIMITS.rows),
  eligibleBaseMinor: Minor,
  amountMinor: Minor,
});
const Source = z.strictObject({
  id: Ref,
  account: Ref,
  authority: Ref,
  canonicalAccount: Ref,
  revision: Ref,
  asOf: Instant,
  controls: Controls,
});
const Attribution = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('partner-only') }),
  z.strictObject({ kind: z.literal('content'), contentId: Ref, evidenceRef: Ref }),
]);
const Earning = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('commission'),
    groupRef: Ref,
    sku: Ref,
    channel: Ref,
    baseMinor: Minor,
    ratePpm: Rate,
    amountMinor: Minor,
  }),
  z.strictObject({ kind: z.literal('fixed-fee'), approvalRef: Ref, amountMinor: Minor }),
  z.strictObject({ kind: z.literal('bonus'), approvalRef: Ref, amountMinor: Minor }),
  z.strictObject({
    kind: z.literal('adjustment'),
    approvalRef: Ref,
    amountMinor: Minor,
    originalLineRef: Ref,
    reasonRef: Ref,
    correction: z
      .strictObject({
        originalGenerationId: z.uuid(),
        originalEntitlement: Entitlement,
        revisionSequence: PermissionRevision,
        revisedAmountMinor: Minor,
      })
      .optional(),
  }),
]);
const RowBase = {
  entitlement: Entitlement,
  sourceId: Ref,
  sourceAccount: Ref,
  sourceRevision: Ref,
  earnedAt: Instant,
  evidenceRef: Ref,
};
export const IntakeRow = z.discriminatedUnion('disposition', [
  z.strictObject({
    ...RowBase,
    disposition: z.literal('included'),
    agreementVersion: Ref,
    attribution: Attribution,
    earning: Earning,
  }),
  z.strictObject({
    ...RowBase,
    disposition: z.literal('excluded'),
    reasonRef: Ref,
    approvalRef: Ref,
  }),
  z.strictObject({ ...RowBase, disposition: z.literal('unresolved'), reasonRef: Ref }),
]);
export type IntakeRowValue = z.infer<typeof IntakeRow>;
export type IncludedRow = Extract<IntakeRowValue, { disposition: 'included' }>;
export const ApprovedPeriodFile = z.strictObject({
  schema: z.literal('approved-period/1'),
  mode: z.literal('complete-snapshot'),
  partnerId: Ref,
  period: Period,
  currency: z.literal('THB'),
  sources: z.array(Source).min(1).max(100),
  rows: z.array(IntakeRow).max(INTAKE_LIMITS.rows),
});

// This context is loaded independently by a server-owned approval repository.
// NEVER deserialize it from the same request/file as ApprovedPeriodFile.
export const ApprovalContext = z.strictObject({
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  approvalRef: Ref,
  partnerId: Ref,
  period: Period,
  currency: z.literal('THB'),
  sources: z.array(Source).min(1).max(100),
  groups: z
    .array(
      z.strictObject({
        id: Ref,
        right: Ref,
        agreementVersion: Ref,
        agreementEvidenceRef: Ref,
        policyRef: Ref,
        effective: Period,
        calculationWindow: Period,
        rounding: RoundingRule,
        ratePpm: Rate,
        skus: z.array(Ref).min(1).max(1000),
        channels: z.array(Ref).min(1).max(100),
        rows: z.number().int().min(1).max(INTAKE_LIMITS.rows),
        baseMinor: Minor,
        amountMinor: Minor,
      }),
    )
    .max(INTAKE_LIMITS.rows),
  amounts: z
    .array(
      z.strictObject({
        entitlement: Entitlement,
        agreementVersion: Ref,
        earnedAt: Instant,
        evidenceRef: Ref,
        earning: z.discriminatedUnion('kind', [
          Earning.options[1],
          Earning.options[2],
          Earning.options[3],
        ]),
      }),
    )
    .max(INTAKE_LIMITS.rows),
  exclusions: z
    .array(z.strictObject({ entitlement: Entitlement, reasonRef: Ref, approvalRef: Ref }))
    .max(INTAKE_LIMITS.rows),
  attributions: z
    .array(z.strictObject({ entitlement: Entitlement, contentId: Ref, evidenceRef: Ref }))
    .max(INTAKE_LIMITS.rows),
});
export type ApprovalContextValue = z.infer<typeof ApprovalContext>;
