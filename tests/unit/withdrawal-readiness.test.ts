import { describe, expect, it } from 'vitest';
import {
  evaluateEntitlementReadiness,
  evaluateWithdrawalReadiness,
} from '@/server/modules/withdrawals/readiness';
import {
  PayerFact,
  ReadinessInputs,
  SourceEntitlement,
  TaxPolicyFact,
  WithdrawalReadinessResult,
} from '@/contracts/withdrawal-readiness';
import {
  allUnknownNoDefaults,
  approvedGoldenReady,
  approvedLargeBalanceReady,
  approvedOneSatangReady,
  approvedZeroWithholdingReady,
  balanceDeficitCase,
  balanceExpectedRevisionUnknownCase,
  balanceScopeMismatchCase,
  balanceStaleRevisionCase,
  balanceUnavailableCase,
  balanceZeroCase,
  entitlementConfirmedPending,
  entitlementEstimated,
  entitlementReleased,
  entitlementScopeMismatch,
  entitlementStaleRevision,
  entitlementUnknownSource,
  entitlementUnresolvedRevision,
  longIdScopeMismatch,
  longIdVersionMismatch,
  multiBlocked,
  payerExpectedVersionUnknown,
  scopeMismatchBeneficiary,
  synthetic,
  unknownBeneficiary,
  unknownPayer,
  unknownReleaseRule,
  unknownTax,
  versionMismatchPayer,
} from '../fixtures/withdrawal-readiness';

// =====================================================================================
// Per-source entitlement readiness (W01-B-F01: separate from the aggregate gate)
// =====================================================================================

describe('per-source entitlement readiness', () => {
  it('reports a released entitlement bound to the current source revision', () => {
    expect(evaluateEntitlementReadiness(entitlementReleased)).toEqual({
      state: 'released',
      stage: 'released',
      reasons: [],
    });
  });

  it('does not treat estimated conversions as released entitlement', () => {
    expect(evaluateEntitlementReadiness(entitlementEstimated)).toEqual({
      state: 'not_released',
      stage: 'estimated',
      reasons: ['not_released_estimated'],
    });
  });

  it('keeps confirmed-but-pending distinct from released', () => {
    expect(evaluateEntitlementReadiness(entitlementConfirmedPending)).toEqual({
      state: 'not_released',
      stage: 'confirmed_pending',
      reasons: ['not_released_confirmed_pending'],
    });
  });

  it('does not release a source entitlement from a different scope', () => {
    const result = evaluateEntitlementReadiness(entitlementScopeMismatch);
    expect(result.state).toBe('not_released');
    expect(result.reasons).toContain('source_scope_mismatch');
  });

  it('rejects a stale source revision even for a released stage', () => {
    const result = evaluateEntitlementReadiness(entitlementStaleRevision);
    expect(result.state).toBe('not_released');
    expect(result.reasons).toContain('source_revision_stale');
  });

  it('returns unknown for an explicit unknown source with a null stage', () => {
    expect(evaluateEntitlementReadiness(entitlementUnknownSource)).toEqual({
      state: 'unknown',
      stage: null,
      reasons: ['source_unknown'],
    });
  });

  it('returns unknown when the trusted current source revision is unresolved', () => {
    expect(evaluateEntitlementReadiness(entitlementUnresolvedRevision)).toEqual({
      state: 'unknown',
      stage: 'released',
      reasons: ['source_current_revision_unknown'],
    });
  });

  it('rejects a fabricated stage on an unknown source at parse time', () => {
    expect(() =>
      SourceEntitlement.parse({ status: 'unknown', stage: 'released' }),
    ).toThrow();
  });
});

// =====================================================================================
// Aggregate request readiness
// =====================================================================================

describe('aggregate request readiness — approved golden case', () => {
  it('gates ready when all facts approved and the trusted balance is current and positive', () => {
    const result = evaluateWithdrawalReadiness(approvedGoldenReady);
    expect(result.requestGate).toBe('ready');
    expect(result.blockingReasons).toEqual([]);
    expect(result.balance).toEqual({ state: 'satisfied' });
    expect(result.prerequisites).toEqual({
      payer: { state: 'satisfied' },
      releaseRule: { state: 'satisfied' },
      taxPolicy: { state: 'satisfied' },
      beneficiary: { state: 'satisfied' },
    });
    // The result round-trips through its own contract even with the aggregate shape.
    expect(WithdrawalReadinessResult.parse(result)).toEqual(result);
  });

  it('is deterministic across repeated evaluations', () => {
    const a = evaluateWithdrawalReadiness(approvedGoldenReady);
    const b = evaluateWithdrawalReadiness(approvedGoldenReady);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('accepts a one-satang and a very large positive balance as ready', () => {
    expect(evaluateWithdrawalReadiness(approvedOneSatangReady).requestGate).toBe('ready');
    expect(evaluateWithdrawalReadiness(approvedLargeBalanceReady).requestGate).toBe('ready');
  });
});

// W01-B-F01: a per-source stage must never gate withdrawal of already released aggregate money.
describe('source stage is independent of the aggregate gate (W01-B-F01)', () => {
  it('leaves the request ready while a separately-evaluated new source is not released', () => {
    // The aggregate is ready purely from the trusted balance + approved config...
    expect(evaluateWithdrawalReadiness(approvedGoldenReady).requestGate).toBe('ready');
    // ...and each of these newly observed sources is independently NOT released / unknown,
    // yet none of them can touch the aggregate result — they are a different function.
    expect(evaluateEntitlementReadiness(entitlementEstimated).state).toBe('not_released');
    expect(evaluateEntitlementReadiness(entitlementConfirmedPending).state).toBe('not_released');
    expect(evaluateEntitlementReadiness(entitlementUnknownSource).state).toBe('unknown');
  });

  it('blocks the request when the aggregate balance is zero even though a source is released', () => {
    expect(evaluateEntitlementReadiness(entitlementReleased).state).toBe('released');
    const result = evaluateWithdrawalReadiness(balanceZeroCase);
    expect(result.requestGate).toBe('blocked');
    expect(result.balance).toEqual({ state: 'blocked', code: 'balance_not_positive', detail: expect.any(String) });
  });
});

describe('unknown prerequisite facts stay unresolved', () => {
  const cases = [
    ['payer', unknownPayer],
    ['releaseRule', unknownReleaseRule],
    ['taxPolicy', unknownTax],
    ['beneficiary', unknownBeneficiary],
  ] as const;

  for (const [key, input] of cases)
    it(`blocks the request when ${key} is unknown, even though other fields are complete`, () => {
      const result = evaluateWithdrawalReadiness(input);
      expect(result.requestGate).toBe('blocked');
      expect(result.prerequisites[key]).toEqual({ state: 'unknown' });
      expect(result.blockingReasons).toContainEqual(
        expect.objectContaining({ prerequisite: key, code: 'unknown' }),
      );
      // A missing request prerequisite must NOT disturb the trusted balance disposition
      // (already released money is not erased by a missing tax/beneficiary approval).
      expect(result.balance).toEqual({ state: 'satisfied' });
    });
});

describe('explicit zero-policy is distinct from unknown', () => {
  it('treats an approved "no withholding" tax policy as satisfied and ready', () => {
    const zero = evaluateWithdrawalReadiness(approvedZeroWithholdingReady);
    expect(zero.prerequisites.taxPolicy).toEqual({ state: 'satisfied' });
    expect(zero.requestGate).toBe('ready');
  });

  it('produces a different disposition than an unknown tax fact', () => {
    const zero = evaluateWithdrawalReadiness(approvedZeroWithholdingReady);
    const unknown = evaluateWithdrawalReadiness(unknownTax);
    expect(zero.prerequisites.taxPolicy).not.toEqual(unknown.prerequisites.taxPolicy);
    expect(unknown.prerequisites.taxPolicy).toEqual({ state: 'unknown' });
    expect(unknown.requestGate).toBe('blocked');
  });
});

describe('scope and version consistency of approved facts', () => {
  it('blocks an approved fact whose scope differs from the current context', () => {
    const result = evaluateWithdrawalReadiness(scopeMismatchBeneficiary);
    expect(result.prerequisites.beneficiary).toMatchObject({ state: 'blocked', code: 'scope_mismatch' });
    expect(result.requestGate).toBe('blocked');
  });

  it('blocks an approved fact bound to a version other than the expected one', () => {
    const result = evaluateWithdrawalReadiness(versionMismatchPayer);
    expect(result.prerequisites.payer).toMatchObject({ state: 'blocked', code: 'version_mismatch' });
    expect(result.requestGate).toBe('blocked');
  });
});

// W01-B-F03: unresolved expected versions/source are representable without fabricated Ids.
describe('unresolved current versions are honestly representable (W01-B-F03)', () => {
  it('blocks an otherwise-approved fact with expected_version_unknown when its version is unresolved', () => {
    const result = evaluateWithdrawalReadiness(payerExpectedVersionUnknown);
    expect(result.prerequisites.payer).toMatchObject({ state: 'blocked', code: 'expected_version_unknown' });
    expect(result.requestGate).toBe('blocked');
  });

  it('evaluates a fully unconfigured setup as blocked without any fabricated Ids', () => {
    const result = evaluateWithdrawalReadiness(allUnknownNoDefaults);
    expect(result.requestGate).toBe('blocked');
    expect(result.prerequisites).toEqual({
      payer: { state: 'unknown' },
      releaseRule: { state: 'unknown' },
      taxPolicy: { state: 'unknown' },
      beneficiary: { state: 'unknown' },
    });
    expect(result.balance.state).toBe('unavailable');
    // Deterministic reasons, not just a boolean: four unknown prerequisites + unavailable balance.
    expect(result.blockingReasons.map((r) => [r.prerequisite, r.code])).toEqual([
      ['payer', 'unknown'],
      ['releaseRule', 'unknown'],
      ['taxPolicy', 'unknown'],
      ['beneficiary', 'unknown'],
      ['balance', 'balance_unavailable'],
    ]);
    expect(WithdrawalReadinessResult.parse(result)).toEqual(result);
  });
});

// W01-B-F02: the W01-A BalanceSnapshot is bound directly; unknown/stale/mismatched balances
// never yield ready and never collapse into a single "not positive" code.
describe('trusted balance snapshot binding (W01-B-F02)', () => {
  it('preserves an unavailable snapshot as its own state with reasons, not a zero', () => {
    const result = evaluateWithdrawalReadiness(balanceUnavailableCase);
    expect(result.balance).toEqual({
      state: 'unavailable',
      reasons: ['SYNTH-no payer/beneficiary source resolved for this scope'],
    });
    expect(result.requestGate).toBe('blocked');
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ prerequisite: 'balance', code: 'balance_unavailable' }),
    );
  });

  it('blocks a known zero balance as not positive', () => {
    const result = evaluateWithdrawalReadiness(balanceZeroCase);
    expect(result.balance).toMatchObject({ state: 'blocked', code: 'balance_not_positive' });
    expect(result.requestGate).toBe('blocked');
  });

  it('blocks a deficit balance as not positive (does not clear the debt to ready)', () => {
    const result = evaluateWithdrawalReadiness(balanceDeficitCase);
    expect(result.balance).toMatchObject({ state: 'blocked', code: 'balance_not_positive' });
  });

  it('blocks a balance from a different partner/payer scope distinctly from not-positive', () => {
    const result = evaluateWithdrawalReadiness(balanceScopeMismatchCase);
    expect(result.balance).toMatchObject({ state: 'blocked', code: 'balance_scope_mismatch' });
    expect(result.requestGate).toBe('blocked');
  });

  it('blocks a stale balance revision distinctly from not-positive', () => {
    const result = evaluateWithdrawalReadiness(balanceStaleRevisionCase);
    expect(result.balance).toMatchObject({ state: 'blocked', code: 'balance_revision_stale' });
  });

  it('blocks when the expected current balance revision is unresolved', () => {
    const result = evaluateWithdrawalReadiness(balanceExpectedRevisionUnknownCase);
    expect(result.balance).toMatchObject({ state: 'blocked', code: 'balance_expected_revision_unknown' });
    expect(result.requestGate).toBe('blocked');
  });
});

describe('a positive balance is necessary but not sufficient', () => {
  it('blocks when a prerequisite is unknown even though the balance is positive', () => {
    const result = evaluateWithdrawalReadiness(unknownTax);
    expect(result.balance).toEqual({ state: 'satisfied' });
    expect(result.requestGate).toBe('blocked');
  });
});

describe('blocking reasons are deterministic and ordered', () => {
  it('orders reasons prerequisites -> balance', () => {
    const result = evaluateWithdrawalReadiness(multiBlocked);
    expect(result.blockingReasons.map((r) => [r.prerequisite, r.code])).toEqual([
      ['payer', 'unknown'],
      ['balance', 'balance_not_positive'],
    ]);
  });
});

// W01-B-F04: valid but maximum-length identifiers must not overflow the result schema.
describe('maximum-length identifiers do not crash result validation (W01-B-F04)', () => {
  it('returns a scope mismatch with 160-char Ids and a parseable result', () => {
    const result = evaluateWithdrawalReadiness(longIdScopeMismatch);
    expect(result.prerequisites.beneficiary).toMatchObject({ state: 'blocked', code: 'scope_mismatch' });
    expect(WithdrawalReadinessResult.parse(result)).toEqual(result);
    // Bounded detail: independent of the 160-char identifiers.
    if (result.prerequisites.beneficiary.state === 'blocked')
      expect(result.prerequisites.beneficiary.detail.length).toBeLessThanOrEqual(300);
  });

  it('returns a version mismatch with 160-char Ids and a parseable result', () => {
    const result = evaluateWithdrawalReadiness(longIdVersionMismatch);
    expect(result.prerequisites.payer).toMatchObject({ state: 'blocked', code: 'version_mismatch' });
    expect(WithdrawalReadinessResult.parse(result)).toEqual(result);
  });
});

describe('structural validity is not proof of approval', () => {
  it('rejects an approved fact missing its evidence reference at parse time', () => {
    expect(() =>
      PayerFact.parse({ status: 'approved', scope: synthetic.SCOPE, version: 'SYNTH-payer-v1' }),
    ).toThrow();
  });

  it('rejects an approved fact missing its version at parse time', () => {
    expect(() =>
      TaxPolicyFact.parse({
        status: 'approved',
        scope: synthetic.SCOPE,
        evidenceRef: 'SYNTH-evidence://tax/x',
        declaredWithholding: 'applies',
      }),
    ).toThrow();
  });

  it('does not allow a scheduled/statement date to be smuggled in as a readiness gate', () => {
    // strictObject: monthly statement publication / scheduled dates are not part of the
    // readiness inputs, so an extra field is rejected rather than treated as a gate.
    expect(() =>
      ReadinessInputs.parse({ ...approvedGoldenReady, scheduledAt: '2026-10-01T00:00:00+07:00' }),
    ).toThrow();
    expect(() =>
      ReadinessInputs.parse({ ...approvedGoldenReady, statementPublished: true }),
    ).toThrow();
  });
});
