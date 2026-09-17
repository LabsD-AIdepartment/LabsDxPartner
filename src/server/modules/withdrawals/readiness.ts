import { type BalanceScopeValue, type BalanceSnapshotValue } from '@/contracts/withdrawal';
import {
  type BalanceReadinessValue,
  type BlockingReasonValue,
  type DispositionValue,
  EntitlementReadinessInput,
  type EntitlementReadinessInputValue,
  type EntitlementReadinessValue,
  type PayerFactValue,
  ReadinessInputs,
  type ReadinessInputsValue,
  type ReleaseReasonValue,
  WithdrawalReadinessResult,
  type WithdrawalReadinessResultValue,
} from '@/contracts/withdrawal-readiness';

// Pure readiness evaluation. No I/O, no policy defaults, no balance arithmetic (W01-A owns
// the balance engine). It reads caller-supplied authoritative facts and a trusted W01-A
// balance snapshot and reports deterministic dispositions and blocking reasons.
//
// W01-B-F01 boundary: two independent pure functions.
//  - evaluateEntitlementReadiness: is THIS source entitlement released? It never determines
//    whether other released money can be withdrawn and never proves a positive balance.
//  - evaluateWithdrawalReadiness: may the partner REQUEST a withdrawal? It consumes the
//    trusted aggregate balance snapshot plus approved configuration and never requires an
//    arbitrary single entitlement. A new estimated/confirmed-pending/unknown source can
//    never make already released money disappear.
// See docs/implementation/withdrawal-readiness.md.

function scopeEq(a: BalanceScopeValue, b: BalanceScopeValue): boolean {
  return a.partnerId === b.partnerId && a.payerId === b.payerId && a.currency === b.currency;
}

// ---- Per-source entitlement readiness -------------------------------------------------

export function evaluateEntitlementReadiness(
  input: EntitlementReadinessInputValue,
): EntitlementReadinessValue {
  const { context, source } = EntitlementReadinessInput.parse(input);

  // An unobserved source cannot be judged. Its stage is genuinely unknown.
  if (source.status === 'unknown')
    return { state: 'unknown', stage: null, reasons: ['source_unknown'] };

  // Without a trusted current source revision we cannot assert freshness, so we cannot
  // release — but the source's claimed stage is a known fact and is reported honestly.
  if (context.expectedSourceRevision === null)
    return { state: 'unknown', stage: source.stage, reasons: ['source_current_revision_unknown'] };

  // From here the source is a known claim bound to a resolved current revision. Any of the
  // following keeps it un-released with an explicit, deterministically ordered reason; a
  // stale revision alone is enough to reject the binding.
  const reasons: ReleaseReasonValue[] = [];
  if (source.sourceRevision !== context.expectedSourceRevision) reasons.push('source_revision_stale');
  if (!scopeEq(source.scope, context.scope)) reasons.push('source_scope_mismatch');
  if (source.amount.currency !== context.scope.currency) reasons.push('source_currency_mismatch');
  if (source.stage === 'estimated') reasons.push('not_released_estimated');
  else if (source.stage === 'confirmed_pending') reasons.push('not_released_confirmed_pending');

  return {
    state: reasons.length === 0 ? 'released' : 'not_released',
    stage: source.stage,
    reasons,
  };
}

// ---- Aggregate request readiness ------------------------------------------------------

// An approved fact is shaped identically for payer / release-rule / beneficiary (the tax
// fact adds `declaredWithholding`, which is irrelevant to scope/version consistency).
type ApprovedFact = Extract<PayerFactValue, { status: 'approved' }>;
type NamedFact = { status: 'unknown' } | ApprovedFact;

// Stable, bounded detail strings that never embed identifiers (W01-B-F04): valid but very
// long partner/payer/version Ids must not overflow the result schema's 300-char limits.
const DISPOSITION_DETAIL = {
  scope_mismatch: 'approved scope does not match the current context scope',
  version_mismatch: 'approved version does not match the expected current version',
  expected_version_unknown: 'no trusted current version is configured to bind this approval to',
} as const;

// Approved facts must match the current scope AND the caller's expected version. When the
// expected version is unresolved (null) an approved fact cannot be bound; a scope mismatch
// or a version other than the currently-bound one blocks. Nothing silently qualifies.
function disposeFact(
  fact: NamedFact,
  expectedScope: BalanceScopeValue,
  expectedVersion: string | null,
): DispositionValue {
  if (fact.status === 'unknown') return { state: 'unknown' };
  if (expectedVersion === null)
    return { state: 'blocked', code: 'expected_version_unknown', detail: DISPOSITION_DETAIL.expected_version_unknown };
  if (!scopeEq(fact.scope, expectedScope))
    return { state: 'blocked', code: 'scope_mismatch', detail: DISPOSITION_DETAIL.scope_mismatch };
  if (fact.version !== expectedVersion)
    return { state: 'blocked', code: 'version_mismatch', detail: DISPOSITION_DETAIL.version_mismatch };
  return { state: 'satisfied' };
}

const BALANCE_DETAIL = {
  balance_scope_mismatch: 'balance snapshot scope does not match the current context scope',
  balance_expected_revision_unknown: 'no trusted current balance revision is configured',
  balance_revision_stale: 'balance snapshot revision does not match the expected current revision',
  balance_not_positive: 'available balance is zero or negative for the current scope',
} as const;

// Balance readiness from the W01-A snapshot. An unavailable snapshot preserves its own
// reasons (never treated as zero). For a known snapshot the checks run in order so an
// out-of-scope, unresolved-revision or stale balance is reported DISTINCTLY and can never
// collapse into "not positive". Only a current, in-scope, strictly positive balance
// satisfies. This module reads the sign of the already-derived exact minor; it does not
// recompute the W01-A balance formula.
function disposeBalance(
  snapshot: BalanceSnapshotValue,
  expectedScope: BalanceScopeValue,
  expectedBalanceRevision: string | null,
): BalanceReadinessValue {
  if (snapshot.state === 'unavailable')
    return { state: 'unavailable', reasons: snapshot.reasons };
  if (!scopeEq(snapshot.scope, expectedScope))
    return { state: 'blocked', code: 'balance_scope_mismatch', detail: BALANCE_DETAIL.balance_scope_mismatch };
  if (expectedBalanceRevision === null)
    return {
      state: 'blocked',
      code: 'balance_expected_revision_unknown',
      detail: BALANCE_DETAIL.balance_expected_revision_unknown,
    };
  if (snapshot.revision !== expectedBalanceRevision)
    return { state: 'blocked', code: 'balance_revision_stale', detail: BALANCE_DETAIL.balance_revision_stale };
  if (BigInt(snapshot.available.minor) <= 0n)
    return { state: 'blocked', code: 'balance_not_positive', detail: BALANCE_DETAIL.balance_not_positive };
  return { state: 'satisfied' };
}

export function evaluateWithdrawalReadiness(
  input: ReadinessInputsValue,
): WithdrawalReadinessResultValue {
  const inputs = ReadinessInputs.parse(input);
  const scope = inputs.context.scope;
  const ev = inputs.context.expectedVersions;

  const prerequisites = {
    payer: disposeFact(inputs.payer, scope, ev.payer),
    releaseRule: disposeFact(inputs.releaseRule, scope, ev.releaseRule),
    taxPolicy: disposeFact(inputs.taxPolicy, scope, ev.taxPolicy),
    beneficiary: disposeFact(inputs.beneficiary, scope, ev.beneficiary),
  };
  const balance = disposeBalance(inputs.balance, scope, inputs.context.expectedBalanceRevision);

  // Blocking reasons in a fixed order: each prerequisite, then balance. Every non-satisfied
  // part contributes a concrete code + detail so callers see WHAT is missing and WHY — not
  // just a boolean.
  const blockingReasons: BlockingReasonValue[] = [];
  for (const key of ['payer', 'releaseRule', 'taxPolicy', 'beneficiary'] as const) {
    const disposition = prerequisites[key];
    if (disposition.state === 'unknown')
      blockingReasons.push({
        prerequisite: key,
        code: 'unknown',
        detail: 'approval is unknown for the current scope',
      });
    else if (disposition.state === 'blocked')
      blockingReasons.push({ prerequisite: key, code: disposition.code, detail: disposition.detail });
  }

  // The trusted balance is necessary but not sufficient: its absence/staleness/non-positive
  // sign blocks, but its positive presence alone never establishes readiness (the fact
  // checks above must also pass).
  if (balance.state === 'unavailable')
    blockingReasons.push({
      prerequisite: 'balance',
      code: 'balance_unavailable',
      detail: 'balance is unavailable for the current scope',
    });
  else if (balance.state === 'blocked')
    blockingReasons.push({ prerequisite: 'balance', code: balance.code, detail: balance.detail });

  return WithdrawalReadinessResult.parse({
    context: inputs.context,
    prerequisites,
    balance,
    requestGate: blockingReasons.length === 0 ? 'ready' : 'blocked',
    blockingReasons,
  });
}
