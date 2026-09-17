import { z } from 'zod';
import { Id, Instant, Money } from './common';
import { BalanceScope, BalanceSnapshot } from './withdrawal';

// W01-B: typed, versioned readiness PREREQUISITES for an on-demand withdrawal request.
// This layer models facts and policy prerequisites only. It is NOT a tax calculator, a
// balance engine (W01-A owns that) or a request/bank service. It performs no arithmetic on
// money beyond reading a sign from a W01-A snapshot: it never invents a default payer, tax
// rate/VAT treatment, release maturity/return delay, fee, minimum, transfer SLA or payout
// provider. Unknown inputs stay explicitly unknown.
//
// Round-2 boundary correction (W01-B-F01): SOURCE-entitlement readiness and AGGREGATE
// request readiness are two separate concerns with two separate pure functions. A single
// earning being estimated/confirmed-pending/unknown must never block withdrawal of already
// released money that the trusted aggregate balance snapshot reports. The aggregate gate
// consumes the W01-A BalanceSnapshot plus approved configuration — never an arbitrary
// single entitlement.
// See docs/implementation/withdrawal-readiness.md and withdrawal-payment-plan.md §3/§12.

// The CALLER declares whether an authoritative approval exists. This module never infers
// 'approved' from mere structural validity — a parseable input is not proof of approval.
export const FactStatus = z.enum(['approved', 'unknown']);
export type FactStatusValue = z.infer<typeof FactStatus>;

// Every approved fact must carry the version it binds to, an evidence reference and the
// exact scope it was approved for. A missing version/evidence/scope makes the input
// structurally invalid (parse throws): an approved claim without a version or evidence is
// rejected outright, never accepted as a "complete but unqualified" fact.
const approvedShape = {
  status: z.literal('approved'),
  scope: BalanceScope,
  version: Id,
  evidenceRef: Id,
} as const;
const UnknownFact = z.strictObject({ status: z.literal('unknown') });

// Approved paying entity for the partner (the payer is also part of BalanceScope; this
// fact asserts that binding is authoritatively approved and versioned).
export const PayerFact = z.discriminatedUnion('status', [
  z.strictObject({ ...approvedShape }),
  UnknownFact,
]);
export type PayerFactValue = z.infer<typeof PayerFact>;

// Approved contractual rule that governs WHEN entitlement releases. Referenced by version
// only — no maturity window/return delay is computed or assumed here.
export const ReleaseRuleFact = z.discriminatedUnion('status', [
  z.strictObject({ ...approvedShape }),
  UnknownFact,
]);
export type ReleaseRuleFactValue = z.infer<typeof ReleaseRuleFact>;

// A caller-declared, policy-sourced outcome — NOT a rate or amount. 'none' is an explicit,
// versioned+evidenced "no withholding for this scope" (a real zero-policy decision) and is
// deliberately distinct from the `unknown` arm below (absence of any known policy).
export const DeclaredWithholding = z.enum(['applies', 'none']);
export type DeclaredWithholdingValue = z.infer<typeof DeclaredWithholding>;
export const TaxPolicyFact = z.discriminatedUnion('status', [
  z.strictObject({ ...approvedShape, declaredWithholding: DeclaredWithholding }),
  UnknownFact,
]);
export type TaxPolicyFactValue = z.infer<typeof TaxPolicyFact>;

// Approved, verified beneficiary destination binding (versioned). No account number is
// modelled or invented here.
export const BeneficiaryFact = z.discriminatedUnion('status', [
  z.strictObject({ ...approvedShape }),
  UnknownFact,
]);
export type BeneficiaryFactValue = z.infer<typeof BeneficiaryFact>;

// ---- Per-source entitlement readiness (W01-B-F01: distinct from the aggregate gate) ----

// Earning release stage for a specific source entitlement. Only 'released' is released
// entitlement; 'estimated' (platform-reported conversions) and 'confirmed_pending'
// (confirmed but not yet eligible) are explicitly NOT released and stay distinct.
export const ReleaseStage = z.enum(['estimated', 'confirmed_pending', 'released']);
export type ReleaseStageValue = z.infer<typeof ReleaseStage>;

// A source entitlement is either a known claim (with its own source revision) or an
// explicit unknown (W01-B-F03): callers must not fabricate a stage/revision to describe an
// entitlement that has not been observed yet.
export const KnownSourceEntitlement = z.strictObject({
  status: z.literal('known'),
  scope: BalanceScope,
  stage: ReleaseStage,
  sourceRevision: Id,
  amount: Money,
});
export type KnownSourceEntitlementValue = z.infer<typeof KnownSourceEntitlement>;
export const SourceEntitlement = z.discriminatedUnion('status', [
  KnownSourceEntitlement,
  UnknownFact,
]);
export type SourceEntitlementValue = z.infer<typeof SourceEntitlement>;

// The current source context a per-entitlement evaluation binds to. `expectedSourceRevision`
// is nullable: when the trusted current source revision is not yet resolved the result is
// `unknown`, never a fabricated release decision (W01-B-F03).
export const SourceContext = z.strictObject({
  scope: BalanceScope,
  expectedSourceRevision: Id.nullable(),
});
export type SourceContextValue = z.infer<typeof SourceContext>;

export const EntitlementReadinessInput = z.strictObject({
  context: SourceContext,
  source: SourceEntitlement,
});
export type EntitlementReadinessInputValue = z.infer<typeof EntitlementReadinessInput>;

// Why a source entitlement is not released / cannot be judged. `source_unknown` and
// `source_current_revision_unknown` accompany an `unknown` state; the remainder accompany a
// `not_released` state.
export const ReleaseReason = z.enum([
  'source_unknown',
  'source_current_revision_unknown',
  'source_revision_stale',
  'source_scope_mismatch',
  'source_currency_mismatch',
  'not_released_estimated',
  'not_released_confirmed_pending',
]);
export type ReleaseReasonValue = z.infer<typeof ReleaseReason>;

// Per-entitlement result. This NEVER asserts whether other released money can be withdrawn
// and NEVER proves a positive aggregate balance — that is the aggregate gate's job.
export const EntitlementState = z.enum(['released', 'not_released', 'unknown']);
export type EntitlementStateValue = z.infer<typeof EntitlementState>;
export const EntitlementReadiness = z.strictObject({
  state: EntitlementState,
  // The stage claimed by the source, or null when the source itself is unknown.
  stage: ReleaseStage.nullable(),
  reasons: z.array(ReleaseReason).max(10),
});
export type EntitlementReadinessValue = z.infer<typeof EntitlementReadiness>;

// ---- Aggregate request readiness (facts + policy + trusted balance snapshot) ----

// The authoritative current context the caller binds this evaluation to. Approved facts
// must match this scope AND these expected versions. Each expected version is NULLABLE: a
// null value means the trusted current version is not yet resolved (W01-B-F03), so an
// otherwise-approved fact cannot be bound and is blocked with `expected_version_unknown`
// rather than requiring a fabricated Id.
export const ExpectedVersions = z.strictObject({
  payer: Id.nullable(),
  releaseRule: Id.nullable(),
  taxPolicy: Id.nullable(),
  beneficiary: Id.nullable(),
});
export type ExpectedVersionsValue = z.infer<typeof ExpectedVersions>;
export const ExpectedContext = z.strictObject({
  scope: BalanceScope,
  asOf: Instant,
  expectedVersions: ExpectedVersions,
  // The caller-owned current balance revision the trusted snapshot must match. Nullable so
  // an unresolved current revision is representable (W01-B-F02/F03).
  expectedBalanceRevision: Id.nullable(),
});
export type ExpectedContextValue = z.infer<typeof ExpectedContext>;

// The aggregate withdrawable balance is supplied as the W01-A BalanceSnapshot (W01-B-F02),
// carrying scope/revision/state and exact amounts. This module does NOT recompute it; it
// only checks scope + revision freshness and reads the sign of the exact available minor.
export const ReadinessInputs = z.strictObject({
  context: ExpectedContext,
  payer: PayerFact,
  releaseRule: ReleaseRuleFact,
  taxPolicy: TaxPolicyFact,
  beneficiary: BeneficiaryFact,
  balance: BalanceSnapshot,
});
export type ReadinessInputsValue = z.infer<typeof ReadinessInputs>;

// ---- Result contracts (deterministic dispositions, never a bare boolean) ----

// Why an approved fact failed to qualify. `unknown` is a separate disposition state, not a
// block reason; a missing version/evidence would have been rejected at parse time.
// `expected_version_unknown` covers an approved fact with no trusted current version to bind
// to. Detail strings are stable and bounded and never embed identifiers (W01-B-F04).
export const DispositionCode = z.enum([
  'scope_mismatch',
  'version_mismatch',
  'expected_version_unknown',
]);
export type DispositionCodeValue = z.infer<typeof DispositionCode>;
export const Disposition = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('satisfied') }),
  z.strictObject({ state: z.literal('unknown') }),
  z.strictObject({
    state: z.literal('blocked'),
    code: DispositionCode,
    detail: z.string().min(1).max(300),
  }),
]);
export type DispositionValue = z.infer<typeof Disposition>;

// Balance readiness derived from the W01-A snapshot. `unavailable` preserves the snapshot's
// own reasons as a structured field (never collapsed to a fabricated zero). `blocked` codes
// keep scope-mismatch / stale-revision / unresolved-revision / not-positive DISTINCT so an
// unknown or stale balance never masquerades as a known zero (W01-B-F02).
export const BalanceReadinessCode = z.enum([
  'balance_scope_mismatch',
  'balance_expected_revision_unknown',
  'balance_revision_stale',
  'balance_not_positive',
]);
export type BalanceReadinessCodeValue = z.infer<typeof BalanceReadinessCode>;
export const BalanceReadiness = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('satisfied') }),
  z.strictObject({
    state: z.literal('unavailable'),
    // Mirrors BalanceSnapshot.reasons (same bound); structured, not concatenated.
    reasons: z.array(z.string().min(1).max(300)).min(1).max(30),
  }),
  z.strictObject({
    state: z.literal('blocked'),
    code: BalanceReadinessCode,
    detail: z.string().min(1).max(300),
  }),
]);
export type BalanceReadinessValue = z.infer<typeof BalanceReadiness>;

export const PrerequisiteKey = z.enum([
  'payer',
  'releaseRule',
  'taxPolicy',
  'beneficiary',
  'balance',
]);
export type PrerequisiteKeyValue = z.infer<typeof PrerequisiteKey>;
export const BlockingReason = z.strictObject({
  prerequisite: PrerequisiteKey,
  code: z.string().min(1).max(60),
  detail: z.string().min(1).max(300),
});
export type BlockingReasonValue = z.infer<typeof BlockingReason>;

// Aggregate result. There is deliberately NO source/releaseReadiness field here: per-source
// readiness is reported by evaluateEntitlementReadiness and cannot gate the aggregate.
export const WithdrawalReadinessResult = z.strictObject({
  context: ExpectedContext,
  prerequisites: z.strictObject({
    payer: Disposition,
    releaseRule: Disposition,
    taxPolicy: Disposition,
    beneficiary: Disposition,
  }),
  balance: BalanceReadiness,
  // 'ready' iff all four prerequisites satisfied AND the trusted balance is satisfied
  // (scope+revision current and available strictly positive) — i.e. blockingReasons empty.
  requestGate: z.enum(['ready', 'blocked']),
  blockingReasons: z.array(BlockingReason).max(20),
});
export type WithdrawalReadinessResultValue = z.infer<typeof WithdrawalReadinessResult>;
