// Development-only withdrawal-controller SEAM for the coherent partner-demo dataset. Browser-safe:
// imports only the dev withdrawal scenario/store types + the withdrawal-journey contract, never a node
// builtin or the server DB. It converts the authored DB story into:
//   • a `scenarioOverride` (WithdrawalScenario) whose base.released = Σ released earnings and
//     base.settled = 0 (the PAID rows below carry the settlement, so nothing is double-counted), and
//     whose currentPeriodPending = Σ ALL unreleased current-period commission (confirmed-unreleased +
//     estimated) — the "ยอดรอตัดรอบ" figure, not only the estimated part; and
//   • an `initialState` (validated PersistedStateV2) seeding the four PAID + one PENDING withdrawals
//     as full lifecycle records, so a fresh generation namespace opens with settled = Σ paid gross,
//     reserved = pending gross and available = released − settled − reserved.
//
// It also maps the controller's LIVE records back to dataset overlay rows (`withdrawalRowsFromRecords`)
// so the monetary projections reflect real settlements. Only the partner-demo scenario is injected;
// every other diagnostic scenario is untouched.

import type {
  PeriodReferenceValue,
  MaskedBeneficiaryValue,
  WithdrawalScopeValue,
  WithdrawalTimelineEntryValue,
} from '@/contracts/withdrawal-journey';
// Type-only import (erased at runtime): keeps ONE source of truth for the reveal entry shape without a
// runtime dependency on the client feature module (this is a dev→feature type reference, never the reverse).
import type { BeneficiaryAccountRevealEntry } from '@/features/withdrawals/BeneficiaryAccountRevealContext';
import type { WithdrawalScenario, SourcePeriodConfig } from '../withdrawals/scenarios';
import {
  PersistedStateV2,
  type PersistedStateV2Value,
  type PersistedWithdrawalRecordValue,
} from '../withdrawals/store';
import {
  DEMO_BENEFICIARY,
  OPEN_PERIOD,
  CLOSED_STATEMENT_ID,
  type DatasetRecords,
  type WithdrawalRow,
} from './dataset';

export interface WithdrawalBootstrap {
  scenarioOverride: WithdrawalScenario;
  initialState: PersistedStateV2Value;
}

const money = (minor: bigint | string) => ({
  currency: 'THB' as const,
  minor: typeof minor === 'bigint' ? minor.toString() : minor,
});

// The fresh-config quote-binding versions (identical to what the controller derives for an absent
// payout config: `${versions.beneficiary}-b0-c0`), so a seeded record's binding is coherent with a
// controller that has not yet seen a config edit.
const VERSIONS = {
  payer: 'payer-v1',
  releaseRule: 'release-v1',
  taxPolicy: 'tax-v1',
  beneficiary: 'ben-v1',
} as const;
// The fresh-config beneficiary version the controller derives for an absent payout config
// (`${versions.beneficiary}-b0-c0`) — i.e. exactly the `version` the summary beneficiary carries until a
// config edit bumps it. Reveal entries bind to THIS version so an edit fails the reveal closed.
export const SEED_BENEFICIARY_VERSION = `${VERSIONS.beneficiary}-b0-c0`;
const SEED_BINDINGS = {
  balanceRevision: 'wr-bal-partner-demo-seed',
  policyRevision: VERSIONS.taxPolicy,
  beneficiaryVersion: SEED_BENEFICIARY_VERSION,
} as const;

// The beneficiary (name/bank/mask) is DATA owned by the seeded rows, not a code constant, so an OLD
// generation keeps its OLD bank even if the default const later changes. Read it from any seeded
// withdrawal row (all rows in a generation share one beneficiary); fall back to the default only when a
// dataset has no withdrawals at all.
function datasetBeneficiary(dataset: DatasetRecords): {
  beneficiaryName: string;
  bankName: string;
  maskedAccount: string;
} {
  const row = dataset.withdrawals[0];
  return row
    ? { beneficiaryName: row.beneficiaryName, bankName: row.bankName, maskedAccount: row.maskedAccount }
    : { ...DEMO_BENEFICIARY };
}

const maskedOf = (b: {
  beneficiaryName: string;
  bankName: string;
  maskedAccount: string;
}): MaskedBeneficiaryValue => ({
  displayName: b.beneficiaryName,
  bankName: b.bankName,
  maskedAccount: b.maskedAccount,
  version: SEED_BENEFICIARY_VERSION,
});

function currentPeriodReference(): PeriodReferenceValue {
  return {
    periodId: 'period-2026-09',
    label: 'งวดปัจจุบัน กันยายน 2569',
    from: `${OPEN_PERIOD.from}T00:00:00+07:00`,
    toExclusive: `${OPEN_PERIOD.toExclusive}T00:00:00+07:00`,
  };
}

/** Build the withdrawal bootstrap (scenario override + seeded state) from the authored dataset. */
export function bootstrapWithdrawal(
  dataset: DatasetRecords,
  scope: WithdrawalScopeValue,
): WithdrawalBootstrap {
  const released = dataset.earnings
    .filter((e) => e.released)
    .reduce((t, e) => t + BigInt(e.amountMinor), 0n);
  // currentPeriodPending = ยอดรอตัดรอบ = ALL unreleased current-period commission (confirmed that is
  // not yet released PLUS estimated), never only the estimated part.
  const currentPeriodPending = dataset.earnings
    .filter((e) => !e.released)
    .reduce((t, e) => t + BigInt(e.amountMinor), 0n);

  const beneficiary = datasetBeneficiary(dataset);

  const sourcePeriods: SourcePeriodConfig[] = [
    {
      periodId: 'period-2026-07-08',
      label: 'งวด ก.ค.–ส.ค. 2569',
      releasedAt: '2026-09-01T00:00:00+07:00',
      amount: released.toString(),
      statementId: CLOSED_STATEMENT_ID,
    },
  ];

  const scenarioOverride: WithdrawalScenario = {
    name: 'partner-demo',
    title: 'พาร์ทเนอร์ (เดโมข้ามหน้า) — ยอดจากชุดข้อมูลจริง',
    balanceState: 'known',
    balanceReasons: [],
    base: { released: released.toString(), settled: '0', held: '0', sourcePeriods },
    currentPeriodPending: currentPeriodPending.toString(),
    currentPeriod: currentPeriodReference(),
    beneficiary: {
      state: 'known',
      displayName: beneficiary.beneficiaryName,
      bankName: beneficiary.bankName,
      maskedAccount: beneficiary.maskedAccount,
    },
    facts: {
      payer: 'approved',
      releaseRule: 'approved',
      taxPolicy: { status: 'approved', declaredWithholding: 'none' },
      beneficiary: 'approved',
    },
    versions: { ...VERSIONS },
    deduction: { kind: 'none' },
    releasable: [],
    persistenceNote: null,
    // No `openingLastWithdrawal`: the PAID records below are the genuine settlement history, so the
    // controller's lastWithdrawal comes from a real record — never a fabricated opening figure.
  };

  const initialState = buildInitialState(dataset, scope, sourcePeriods);
  return { scenarioOverride, initialState };
}

// Build the seeded PersistedStateV2 from the dataset withdrawals. Paid rows become full
// submitted→processing→paid records (settlement carried by the record); the pending row is a live
// `requested` reservation. Seq is a single global monotonic counter so timelines stay legally ordered.
function buildInitialState(
  dataset: DatasetRecords,
  scope: WithdrawalScopeValue,
  sourcePeriods: SourcePeriodConfig[],
): PersistedStateV2Value {
  let seq = 0;
  const next = () => (seq += 1);
  const sourceContext = {
    state: 'known' as const,
    periods: sourcePeriods.map((sp) => ({
      periodId: sp.periodId,
      label: sp.label,
      releasedAt: sp.releasedAt,
      releasedAmount: money(sp.amount),
      statementId: sp.statementId ?? null,
    })),
    allocationModeled: false as const,
  };

  const records = dataset.withdrawals.map((row) => {
    const gross = money(row.grossMinor);
    const net = money(row.netMinor);
    const common = {
      requestRef: row.requestRef,
      idempotencyKey: row.idempotencyKey,
      scope,
      gross,
      net,
      deductions: [],
      // The record's masked beneficiary is read from the DB row itself (per-generation bank), never a
      // code constant, so a seeded request snapshot always matches the summary + any reveal record.
      beneficiary: maskedOf(row),
      quoteId: `${row.requestRef}-quote`,
      bindings: { ...SEED_BINDINGS },
      submittedAt: row.submittedAt,
      historyComplete: true as const,
      sourceContext,
    };
    if (row.status === 'paid') {
      const timeline: WithdrawalTimelineEntryValue[] = [
        { seq: next(), at: row.submittedAt, kind: 'submitted', status: 'requested', detail: null },
        { seq: next(), at: row.submittedAt, kind: 'processing', status: 'processing', detail: null },
        { seq: next(), at: row.paidAt ?? row.submittedAt, kind: 'paid', status: 'paid', detail: null },
      ];
      return {
        ...common,
        status: 'paid',
        reserved: money('0'),
        allowedActions: ['check_status'],
        timeline,
      };
    }
    // The single live pending reservation (status requested, reserve == gross).
    const timeline: WithdrawalTimelineEntryValue[] = [
      { seq: next(), at: row.submittedAt, kind: 'submitted', status: 'requested', detail: null },
    ];
    return {
      ...common,
      status: 'requested',
      reserved: gross,
      allowedActions: ['cancel', 'check_status'],
      timeline,
    };
  });

  const state = {
    version: 2 as const,
    scope,
    scenario: 'partner-demo',
    seq,
    requests: records,
    cancellations: [],
    releasedPeriods: [],
    releaseLog: [],
    controls: {
      staleQuote: false,
      changedBeneficiary: false,
      unknownOutcome: false,
      cancelMode: 'success',
    },
    beneficiaryBump: 0,
    staleBump: 0,
  };
  // Validate the shape EXACTLY like a stored blob (the controller additionally re-checks the
  // accounting/lifecycle invariants via validatePersistedState on load).
  return PersistedStateV2.parse(state);
}

// ---- optional reveal entries (dev DatasetBoundary → feature reveal provider) -------------

/**
 * Build the exact beneficiary-reveal entries for one validated dataset. Each synthetic reveal record is
 * paired with the SAME beneficiary version the summary carries (SEED_BENEFICIARY_VERSION), so the feature
 * hook matches all four identity fields. A dataset with no synthetic record (g1–g3 / old DB) yields []
 * ⇒ no reveal. Nothing here exposes the full number in any DTO/snapshot/CSV — it is only entry data.
 */
export function beneficiaryRevealEntriesFromDataset(
  dataset: DatasetRecords,
): BeneficiaryAccountRevealEntry[] {
  return (dataset.beneficiaryAccounts ?? []).map((row) => ({
    displayName: row.beneficiaryName,
    bankName: row.bankName,
    maskedAccount: row.maskedAccount,
    version: SEED_BENEFICIARY_VERSION,
    fullAccount: row.fullAccount,
  }));
}

// ---- live records → dataset overlay rows ------------------------------------------------

// `SYNTH-permission-1::${datasetId}::${generation}` (see scope.ts). The datasetId/generation are
// parsed from the record's permissionRevision when not supplied explicitly.
function scopeIdsFromRecord(
  record: PersistedWithdrawalRecordValue,
): { datasetId: string; generation: string } {
  const parts = record.scope.permissionRevision.split('::');
  return { datasetId: parts[1] ?? '', generation: parts[2] ?? '' };
}

/**
 * Map the controller's CURRENT withdrawal records to dataset overlay rows for the monetary
 * projections. `datasetId`/`generation` are OPTIONAL: when omitted they are parsed from each record's
 * `scope.permissionRevision` (encoded `SYNTH-permission-1::datasetId::generation`); pass them
 * explicitly to bind a known scope. A paid row's `paidAt` is the recorded PAID timeline instant (never
 * submittedAt); non-paid rows carry `paidAt: null`.
 */
export function withdrawalRowsFromRecords(
  records: PersistedWithdrawalRecordValue[],
  datasetId?: string,
  generation?: string,
): WithdrawalRow[] {
  return records.map((record) => {
    const ids =
      datasetId !== undefined && generation !== undefined
        ? { datasetId, generation }
        : scopeIdsFromRecord(record);
    const paidEvent = [...record.timeline].reverse().find((e) => e.kind === 'paid');
    return {
      datasetId: ids.datasetId,
      generation: ids.generation,
      id: record.requestRef,
      requestRef: record.requestRef,
      idempotencyKey: record.idempotencyKey,
      grossMinor: record.gross.minor,
      netMinor: record.net.minor,
      status: record.status,
      submittedAt: record.submittedAt,
      paidAt: record.status === 'paid' && paidEvent ? paidEvent.at : null,
      beneficiaryName: record.beneficiary.displayName,
      bankName: record.beneficiary.bankName,
      maskedAccount: record.beneficiary.maskedAccount,
    };
  });
}
