// SYNTHETIC W01-B readiness fixtures — test data ONLY.
//
// Everything here is visibly fake (ids/versions/evidence prefixed `SYNTH-`). These values
// are NOT production policy, NOT default runtime configuration and MUST NOT be imported by
// product code. Only `import type` of the contracts is used, so there is no runtime coupling
// to product modules (in particular no dependency on the W01-A balance builder). The unit
// test feeds these into the SAME pure evaluators that product code would use
// (`evaluateEntitlementReadiness` / `evaluateWithdrawalReadiness`) — no test-only logic.

import type { BalanceSnapshotValue } from '@/contracts/withdrawal';
import type {
  EntitlementReadinessInputValue,
  ReadinessInputsValue,
} from '@/contracts/withdrawal-readiness';

const SCOPE = {
  partnerId: 'SYNTH-partner-alpha',
  payerId: 'SYNTH-payer-labsd-th',
  currency: 'THB' as const,
};
// A different paying entity in the same partner — used for scope-mismatch cases.
const OTHER_PAYER_SCOPE = { ...SCOPE, payerId: 'SYNTH-payer-labsd-sg' };

const BALANCE_REVISION = 'SYNTH-bal-rev-1';
const EXPECTED_VERSIONS = {
  payer: 'SYNTH-payer-v1',
  releaseRule: 'SYNTH-release-v1',
  taxPolicy: 'SYNTH-tax-v1',
  beneficiary: 'SYNTH-bene-v1',
};
const CONTEXT = {
  scope: SCOPE,
  asOf: '2026-09-15T00:00:00+07:00',
  expectedVersions: EXPECTED_VERSIONS,
  expectedBalanceRevision: BALANCE_REVISION,
};

const thb = (minor: string) => ({ currency: 'THB' as const, minor });

// Synthetic W01-A-shaped snapshots, hand-built so the fixtures do not import the balance
// builder. Amounts are internally consistent (rawAvailable = released - settled, holds 0).
const knownSnapshot = (over: {
  scope?: typeof SCOPE;
  revision?: string;
  released: string;
  settled?: string;
  available: string;
  rawAvailable?: string;
  deficit?: string;
}): BalanceSnapshotValue => ({
  state: 'known',
  scope: over.scope ?? SCOPE,
  revision: over.revision ?? BALANCE_REVISION,
  asOf: '2026-09-15T00:00:00+07:00',
  released: thb(over.released),
  settled: thb(over.settled ?? '0'),
  reserved: thb('0'),
  held: thb('0'),
  rawAvailable: thb(over.rawAvailable ?? over.available),
  available: thb(over.available),
  deficit: thb(over.deficit ?? '0'),
});

const balancePositive = knownSnapshot({ released: '400000', available: '400000' });
const balanceZero = knownSnapshot({ released: '0', available: '0' });
const balanceDeficit = knownSnapshot({
  released: '100000',
  settled: '200000',
  rawAvailable: '-100000',
  available: '0',
  deficit: '100000',
});
const balanceOneSatang = knownSnapshot({ released: '1', available: '1' });
const balanceLarge = knownSnapshot({
  released: '9007199254740992999',
  available: '9007199254740992999',
});
const balanceWrongScope = knownSnapshot({
  scope: OTHER_PAYER_SCOPE,
  released: '400000',
  available: '400000',
});
const balanceStaleRevision = knownSnapshot({
  revision: 'SYNTH-bal-rev-0',
  released: '400000',
  available: '400000',
});
const balanceUnavailable: BalanceSnapshotValue = {
  state: 'unavailable',
  scope: SCOPE,
  asOf: '2026-09-15T00:00:00+07:00',
  reasons: ['SYNTH-no payer/beneficiary source resolved for this scope'],
};

const payerApproved = {
  status: 'approved' as const,
  scope: SCOPE,
  version: 'SYNTH-payer-v1',
  evidenceRef: 'SYNTH-evidence://payer/msa-2026',
};
const releaseRuleApproved = {
  status: 'approved' as const,
  scope: SCOPE,
  version: 'SYNTH-release-v1',
  evidenceRef: 'SYNTH-evidence://release-rule/contract-2026',
};
const taxApprovedApplies = {
  status: 'approved' as const,
  scope: SCOPE,
  version: 'SYNTH-tax-v1',
  evidenceRef: 'SYNTH-evidence://tax/wht-policy-2026',
  declaredWithholding: 'applies' as const,
};
// Explicit, versioned+evidenced "no withholding" — a real zero-policy DECISION, distinct
// from an unknown tax fact (absence of any known policy). No rate is modelled either way.
const taxApprovedNone = { ...taxApprovedApplies, declaredWithholding: 'none' as const };
const beneficiaryApproved = {
  status: 'approved' as const,
  scope: SCOPE,
  version: 'SYNTH-bene-v1',
  evidenceRef: 'SYNTH-evidence://beneficiary/verified-2026',
};

// ---- Aggregate request-readiness fixtures --------------------------------------------

// Fully explicit synthetic APPROVED golden case: all four prerequisites approved at the
// expected scope/version, a trusted current positive balance -> gate 'ready'.
export const approvedGoldenReady: ReadinessInputsValue = {
  context: CONTEXT,
  payer: payerApproved,
  releaseRule: releaseRuleApproved,
  taxPolicy: taxApprovedApplies,
  beneficiary: beneficiaryApproved,
  balance: balancePositive,
};

// Same as the golden case but tax is an explicit approved zero-policy -> still 'ready'.
export const approvedZeroWithholdingReady: ReadinessInputsValue = {
  ...approvedGoldenReady,
  taxPolicy: taxApprovedNone,
};

export const approvedOneSatangReady: ReadinessInputsValue = {
  ...approvedGoldenReady,
  balance: balanceOneSatang,
};
export const approvedLargeBalanceReady: ReadinessInputsValue = {
  ...approvedGoldenReady,
  balance: balanceLarge,
};

// One-unknown-fact-at-a-time cases: everything else stays approved so the block is
// attributable to exactly that unknown prerequisite.
export const unknownPayer: ReadinessInputsValue = { ...approvedGoldenReady, payer: { status: 'unknown' } };
export const unknownReleaseRule: ReadinessInputsValue = { ...approvedGoldenReady, releaseRule: { status: 'unknown' } };
export const unknownTax: ReadinessInputsValue = { ...approvedGoldenReady, taxPolicy: { status: 'unknown' } };
export const unknownBeneficiary: ReadinessInputsValue = { ...approvedGoldenReady, beneficiary: { status: 'unknown' } };

// Approved beneficiary but for a different payer entity than the current scope.
export const scopeMismatchBeneficiary: ReadinessInputsValue = {
  ...approvedGoldenReady,
  beneficiary: { ...beneficiaryApproved, scope: OTHER_PAYER_SCOPE },
};
// Approved payer but bound to a version other than the caller's expected current version.
export const versionMismatchPayer: ReadinessInputsValue = {
  ...approvedGoldenReady,
  payer: { ...payerApproved, version: 'SYNTH-payer-v2' },
};

// F03: an otherwise-approved payer but the trusted current payer version is unresolved.
export const payerExpectedVersionUnknown: ReadinessInputsValue = {
  ...approvedGoldenReady,
  context: { ...CONTEXT, expectedVersions: { ...EXPECTED_VERSIONS, payer: null } },
};

// F03: a fully honest "nothing is configured yet" setup — every fact unknown, every expected
// version null, the balance unavailable and no expected balance revision. Must evaluate
// (parse) successfully as blocked without any fabricated Ids/versions.
export const allUnknownNoDefaults: ReadinessInputsValue = {
  context: {
    scope: SCOPE,
    asOf: '2026-09-15T00:00:00+07:00',
    expectedVersions: { payer: null, releaseRule: null, taxPolicy: null, beneficiary: null },
    expectedBalanceRevision: null,
  },
  payer: { status: 'unknown' },
  releaseRule: { status: 'unknown' },
  taxPolicy: { status: 'unknown' },
  beneficiary: { status: 'unknown' },
  balance: balanceUnavailable,
};

// Balance-focused cases (all facts approved so balance is the only differentiator).
export const balanceUnavailableCase: ReadinessInputsValue = { ...approvedGoldenReady, balance: balanceUnavailable };
export const balanceZeroCase: ReadinessInputsValue = { ...approvedGoldenReady, balance: balanceZero };
export const balanceDeficitCase: ReadinessInputsValue = { ...approvedGoldenReady, balance: balanceDeficit };
export const balanceScopeMismatchCase: ReadinessInputsValue = { ...approvedGoldenReady, balance: balanceWrongScope };
export const balanceStaleRevisionCase: ReadinessInputsValue = { ...approvedGoldenReady, balance: balanceStaleRevision };
export const balanceExpectedRevisionUnknownCase: ReadinessInputsValue = {
  ...approvedGoldenReady,
  context: { ...CONTEXT, expectedBalanceRevision: null },
};

// Multiple blocked parts at once (unknown payer + no positive balance) — used to assert
// deterministic blockingReasons ordering (prerequisites before balance).
export const multiBlocked: ReadinessInputsValue = {
  ...approvedGoldenReady,
  payer: { status: 'unknown' },
  balance: balanceZero,
};

// F04: valid but maximum-length (160-char) identifiers must not overflow the result schema.
const LONG = (c: string) => c.repeat(160);
const longScope = { partnerId: LONG('p'), payerId: LONG('q'), currency: 'THB' as const };
const longOtherScope = { ...longScope, payerId: LONG('r') };
export const longIdScopeMismatch: ReadinessInputsValue = {
  context: {
    scope: longScope,
    asOf: '2026-09-15T00:00:00+07:00',
    expectedVersions: { payer: LONG('a'), releaseRule: LONG('b'), taxPolicy: LONG('c'), beneficiary: LONG('d') },
    expectedBalanceRevision: LONG('e'),
  },
  payer: { status: 'approved', scope: longScope, version: LONG('a'), evidenceRef: LONG('E') },
  releaseRule: { status: 'approved', scope: longScope, version: LONG('b'), evidenceRef: LONG('E') },
  taxPolicy: { status: 'approved', scope: longScope, version: LONG('c'), evidenceRef: LONG('E'), declaredWithholding: 'applies' },
  // Beneficiary approved for a DIFFERENT (also 160-char) scope -> scope mismatch with long Ids.
  beneficiary: { status: 'approved', scope: longOtherScope, version: LONG('d'), evidenceRef: LONG('E') },
  balance: {
    state: 'known',
    scope: longScope,
    revision: LONG('e'),
    asOf: '2026-09-15T00:00:00+07:00',
    released: thb('400000'),
    settled: thb('0'),
    reserved: thb('0'),
    held: thb('0'),
    rawAvailable: thb('400000'),
    available: thb('400000'),
    deficit: thb('0'),
  },
};
// Same long-Id context but the payer version differs from the expected one -> version mismatch.
export const longIdVersionMismatch: ReadinessInputsValue = {
  ...longIdScopeMismatch,
  payer: { status: 'approved', scope: longScope, version: LONG('z'), evidenceRef: LONG('E') },
  beneficiary: { status: 'approved', scope: longScope, version: LONG('d'), evidenceRef: LONG('E') },
};

// ---- Per-source entitlement-readiness fixtures ---------------------------------------

const SOURCE_CONTEXT = { scope: SCOPE, expectedSourceRevision: 'SYNTH-src-rev-42' };
const SOURCE_CONTEXT_UNRESOLVED = { scope: SCOPE, expectedSourceRevision: null };

const knownSource = (over: {
  scope?: typeof SCOPE;
  stage: 'estimated' | 'confirmed_pending' | 'released';
  sourceRevision?: string;
}) => ({
  status: 'known' as const,
  scope: over.scope ?? SCOPE,
  stage: over.stage,
  sourceRevision: over.sourceRevision ?? 'SYNTH-src-rev-42',
  amount: thb('400000'),
});

export const entitlementReleased: EntitlementReadinessInputValue = {
  context: SOURCE_CONTEXT,
  source: knownSource({ stage: 'released' }),
};
export const entitlementEstimated: EntitlementReadinessInputValue = {
  context: SOURCE_CONTEXT,
  source: knownSource({ stage: 'estimated' }),
};
export const entitlementConfirmedPending: EntitlementReadinessInputValue = {
  context: SOURCE_CONTEXT,
  source: knownSource({ stage: 'confirmed_pending' }),
};
export const entitlementScopeMismatch: EntitlementReadinessInputValue = {
  context: SOURCE_CONTEXT,
  source: knownSource({ stage: 'released', scope: OTHER_PAYER_SCOPE }),
};
export const entitlementStaleRevision: EntitlementReadinessInputValue = {
  context: SOURCE_CONTEXT,
  source: knownSource({ stage: 'released', sourceRevision: 'SYNTH-src-rev-OLD' }),
};
export const entitlementUnknownSource: EntitlementReadinessInputValue = {
  context: SOURCE_CONTEXT,
  source: { status: 'unknown' },
};
export const entitlementUnresolvedRevision: EntitlementReadinessInputValue = {
  context: SOURCE_CONTEXT_UNRESOLVED,
  source: knownSource({ stage: 'released' }),
};

// Shared synthetic constants exposed for assertions that do not need a full input object.
export const synthetic = {
  SCOPE,
  OTHER_PAYER_SCOPE,
  EXPECTED_VERSIONS,
  BALANCE_REVISION,
  CONTEXT,
  payerApproved,
  balancePositive,
} as const;
