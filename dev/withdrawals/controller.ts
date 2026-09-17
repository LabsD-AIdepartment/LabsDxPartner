import {
  computeWithdrawable,
  knownBalance,
  unavailableBalance,
} from '@/server/modules/withdrawals/balance';
import { evaluateWithdrawalReadiness } from '@/server/modules/withdrawals/readiness';
import { thb } from '@/server/modules/earnings/money';
import type { MoneyValue } from '@/contracts/common';
import type { BalanceScopeValue, BalanceSnapshotValue } from '@/contracts/withdrawal';
import type { WithdrawalReadinessResultValue } from '@/contracts/withdrawal-readiness';
import {
  EVENT_KIND_STATUS,
  type MaskedBeneficiaryValue,
  type PayoutBeneficiaryValue,
  type QuoteDeductionValue,
  REQUEST_TRANSITIONS,
  type RequestActionValue,
  type RequestStatusValue,
  WithdrawalCancelCommand,
  type WithdrawalCancelCommandValue,
  WithdrawalCancelResult,
  type WithdrawalCancelResultValue,
  WithdrawalCancellationRecovery,
  type WithdrawalCancellationRecoveryValue,
  type WithdrawalCancellationReceiptValue,
  WithdrawalDetailResult,
  type WithdrawalDetailResultValue,
  type WithdrawalLastPaidValue,
  WithdrawalList,
  type WithdrawalListValue,
  WithdrawalOutcomeSimCommand,
  type WithdrawalOutcomeSimCommandValue,
  WithdrawalOutcomeSimResult,
  type WithdrawalOutcomeSimResultValue,
  PayoutBeneficiaryConfig,
  type PayoutBeneficiaryConfigValue,
  SetPayoutBeneficiaryCommand,
  type SetPayoutBeneficiaryCommandValue,
  SetPayoutBeneficiaryResult,
  type SetPayoutBeneficiaryResultValue,
  WithdrawalPeriodsView,
  type WithdrawalPeriodsViewValue,
  WithdrawalQuote,
  type WithdrawalQuoteValue,
  WithdrawalReadError,
  WithdrawalRecovery,
  type WithdrawalRecoveryValue,
  WithdrawalRequest,
  type WithdrawalRequestValue,
  type WithdrawalResumeValue,
  WithdrawalScope,
  type WithdrawalScopeValue,
  type WithdrawalSourceContextValue,
  WithdrawalSubmission,
  type WithdrawalSubmissionValue,
  WithdrawalSubmitResult,
  type WithdrawalSubmitResultValue,
  WithdrawalSummary,
  type WithdrawalSummaryValue,
  type WithdrawalTimelineEntryValue,
} from '@/contracts/withdrawal-journey';
import {
  type CancelSimModeValue,
  type DevKeyValueStorage,
  memoryStorage,
  type PersistedControlsV2Value,
  type PersistedStateV1Value,
  type PersistedStateV2Value,
  type PersistedStateValue,
  type PersistedWithdrawalRecordValue,
  PersistedStore,
  type ReleaseEventValue,
  STORE_VERSION,
} from './store';
import { getScenario, SCENARIO_NAMES, type ScenarioName, type WithdrawalScenario } from './scenarios';
import {
  BENEFICIARY_CATALOG,
  BeneficiaryConfigStore,
  catalogAccount,
  catalogBank,
  CONFIG_VERSION_MAX,
  type PersistedBeneficiaryConfigValue,
} from './beneficiary-store';

// Development-only synthetic withdrawal controller. It is the SINGLE narrowly-scoped browser
// consumer of the three audited pure W01 modules (balance, readiness, earnings/money). All money
// math derives from those functions — this file never restates the balance formula and never
// invents tax/fee. Feature UI/model never import it or the pure server modules.
//
// WU02 adds: full request lifecycle (processing/paid/failed/reconciling) as pure projections of
// status; durable cancellation OPERATIONS with their own idempotency/recovery; per-request frozen
// timeline + source provenance; a bounded monotonic mutation `seq` that drives all revisions; and
// a v1->v2 in-place storage upgrade. Reservation/settlement remain projections of the request set,
// so a replayed/late/lost command can never double-release or double-settle.

const QUOTE_TTL_MS = 5 * 60 * 1000;

// Bounded synthetic capacities. A NEW record/operation beyond the bound is refused BEFORE any
// mutation, so the store never holds a number of records/receipts it cannot serialise/re-read.
const STORE_CAPACITY = 200;
const CANCEL_CAPACITY = 400;
const TIMELINE_CAPACITY = 50;
// The persisted `seq` upper bound (matches the MutationSeq contract bound). A mutation whose event
// budget would push seq past this is refused BEFORE any state change, so the store never holds an
// in-memory seq it cannot serialise/re-read (a submit at the bound must not "succeed" then vanish
// on reload).
const MAX_SEQ = 1_000_000;
// The persisted bound for the beneficiary-version bump counter (matches the store schema's
// `.max(10000)`). `changeBeneficiary` refuses BEFORE mutating at this bound so it never mutates
// in-memory state that then fails to persist. (`staleBump` no longer increments in WU02, so it
// needs no separate guard.)
const BUMP_MAX = 10_000;

const REASON: Record<string, string> = {
  amount_not_positive: 'จำนวนที่ขอถอนต้องมากกว่าศูนย์',
  amount_exceeds_available: 'จำนวนที่ขอถอนเกินยอดที่พร้อมถอน',
  amount_unsupported: 'ยังไม่มีใบเสนอราคาที่ตรงกับจำนวนนี้ในสถานการณ์นี้',
  tax_policy_unknown: 'ยังไม่ทราบนโยบายภาษีสำหรับขอบเขตนี้',
  fee_unknown: 'ยังไม่ทราบค่าธรรมเนียมสำหรับขอบเขตนี้',
  beneficiary_missing: 'ยังไม่ได้ตั้งค่าบัญชีผู้รับเงิน',
  beneficiary_pending: 'บัญชีผู้รับเงินอยู่ระหว่างการตรวจสอบ',
  beneficiary_unavailable: 'การตั้งค่าบัญชีผู้รับเงินยังใช้ไม่ได้ กรุณาตั้งค่าใหม่',
  balance_unknown: 'ยังไม่ทราบยอดคงเหลือสำหรับขอบเขตนี้',
  not_ready: 'ยังไม่พร้อมส่งคำขอถอนสำหรับขอบเขตนี้',
};

export interface ControllerClock {
  now(): Date;
}
export interface ControllerIdGen {
  next(prefix: string): string;
}

// The optional demo bootstrap seam. Typed LOCALLY (from the dev scenario/store types this file
// already imports) so the controller never gains a dependency on the projections module or the server:
// a caller that owns a `WithdrawalScenario` + a `PersistedStateV2` (e.g. the demo-dataset bootstrap)
// can inject them without any import closure crossing into `dev/demo-dataset` or `@/server`.
export interface ControllerBootstrap {
  scenarioOverride: WithdrawalScenario;
  initialState: PersistedStateV2Value;
}

export interface ControllerOptions {
  scope: WithdrawalScopeValue;
  storage?: DevKeyValueStorage;
  clock?: ControllerClock;
  idGen?: ControllerIdGen;
  // Only honoured for the `partner-demo` scenario (rejected otherwise). When present it REPLACES the
  // fixture scenario with `scenarioOverride`, and seeds `initialState` on a FRESH namespace (existing
  // stored state still wins). See the constructor / restore() / reset().
  bootstrap?: ControllerBootstrap;
}

interface IssuedQuote {
  gross: MoneyValue;
  net: MoneyValue;
  deductions: QuoteDeductionValue[];
  beneficiary: MaskedBeneficiaryValue;
  balanceRevision: string;
  policyRevision: string;
  beneficiaryVersion: string;
  expiresAtMs: number;
}

function defaultIdGen(): ControllerIdGen {
  let n = 0;
  return { next: (prefix) => `${prefix}-${(++n).toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
}

const ACTIVE = new Set<RequestStatusValue>(['requested', 'processing', 'reconciling']);

// Actions the transport authorises per status. `cancel` appears ONLY while `requested`, so the UI
// (which reads allowedActions, never a badge) can never offer cancel on an ineligible request.
function actionsFor(status: RequestStatusValue): RequestActionValue[] {
  switch (status) {
    case 'requested':
      return ['cancel', 'check_status'];
    case 'processing':
      return ['check_status', 'contact_support'];
    case 'reconciling':
      return ['check_status', 'contact_support'];
    case 'paid':
      return ['check_status'];
    case 'failed':
      return ['check_status', 'contact_support'];
    case 'cancelled':
      return ['check_status'];
  }
}

export class WithdrawalController {
  private scope: WithdrawalScopeValue;
  private scenarioName: ScenarioName;
  private scenario: WithdrawalScenario;
  // The demo bootstrap, honoured ONLY for the partner-demo scenario. Fixed for the controller's life.
  private readonly bootstrap: ControllerBootstrap | null;
  private store: PersistedStore;
  // WU03 S2: SEPARATE self-versioned payout-config store (distinct key; money v2 store unchanged).
  private beneficiaryStore: BeneficiaryConfigStore;
  private benConfig:
    | { kind: 'absent' }
    | { kind: 'loaded'; config: PersistedBeneficiaryConfigValue }
    | { kind: 'unavailable'; reasons: string[] } = { kind: 'absent' };
  // Non-persisted DEV control: simulate an uncertain save reply (committed but response "lost").
  private beneficiarySaveMode: 'ok' | 'unknown' = 'ok';
  // Non-persisted submit initiation mode. Default 'auto': a NEW valid submit processes automatically
  // (synthetic initiation) — the accepted record is persisted at `processing` in ONE transaction.
  // 'legacy_manual' reproduces the older submit->`requested` behaviour and exists ONLY to seed legacy
  // requested records for cancel/legacy coverage (never wired into the preview UI or banner). It is
  // NOT persisted, so it changes no store schema and cannot survive a reload.
  private submitInitiation: 'auto' | 'legacy_manual' = 'auto';
  private readonly rawStorage: DevKeyValueStorage;
  private readError = false;
  private readonly clock: ControllerClock;
  private readonly idGen: ControllerIdGen;

  private requests: PersistedWithdrawalRecordValue[] = [];
  private cancellations: WithdrawalCancellationReceiptValue[] = [];
  private releaseLog: ReleaseEventValue[] = [];
  private releasedPeriods = new Set<string>();
  private controls: PersistedControlsV2Value = {
    staleQuote: false,
    changedBeneficiary: false,
    unknownOutcome: false,
    cancelMode: 'success',
  };
  private beneficiaryBump = 0;
  private staleBump = 0;
  // Bounded monotonic mutation sequence. Every accepted transition / cancellation intent /
  // release / config change increments it, and ALL revision strings derive from it — so a quote is
  // stale after ANY change (even processing/reconciling with equal totals) and equal-total
  // cancel/recreate (ABA) can never resurrect an old quote. Persisted so monotonicity survives
  // reload.
  private seq = 0;
  // True once a clean read has established a trustworthy in-memory view. A read outage BEFORE this
  // is a fresh unreadable restore; AFTER it is a transient reload fault that keeps known state.
  private stateKnown = false;
  private restoreUnread = false;
  private readonly issuedQuotes = new Map<string, IssuedQuote>();
  private readonly consumedQuotes = new Set<string>();
  private persistenceWarning: string | null = null;
  // UI refresh listeners ONLY. They never abort or reset a money command; a command finishes
  // regardless of whether any listener is still mounted.
  private readonly listeners = new Set<() => void>();
  // A monotonic UI-notification version, DISTINCT from the financial `seq`. It increments on EVERY
  // notify() (read-error/cancel-mode/reset/reload/warning changes AND money transitions), so a
  // useSyncExternalStore/refreshKey consumer always observes a changed snapshot — without misusing
  // the financial seq (which stales quotes only on real money/authority changes).
  private uiTick = 0;
  // An explicit reset/scenario GENERATION. An explicit reset (or scenario switch) bumps it and
  // clears in-flight intents + issued quotes, so a delayed command that started before the reset can
  // never resurrect pre-reset data or apply its old revision to newly reset state.
  private resetEpoch = 0;

  constructor(options: ControllerOptions) {
    this.scope = WithdrawalScope.parse(options.scope);
    this.scenarioName = this.resolveScenarioName(this.scope.scenario);
    this.scope = { ...this.scope, scenario: this.scenarioName };
    // A bootstrap is ONLY valid for the partner-demo scenario; reject a bootstrap aimed at any other
    // scenario rather than silently ignoring it (a misconfigured injection is a bug, not a fallback).
    if (options.bootstrap && this.scenarioName !== 'partner-demo')
      throw new Error(
        `withdrawal bootstrap is only allowed for the partner-demo scenario, not ${this.scenarioName}`,
      );
    this.bootstrap = options.bootstrap ?? null;
    this.scenario = this.resolveScenario();
    this.rawStorage = options.storage ?? memoryStorage();
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGen = options.idGen ?? defaultIdGen();
    this.store = this.makeStore();
    this.beneficiaryStore = this.makeBeneficiaryStore();
    this.reload();
  }

  // ---- infrastructure ---------------------------------------------------------------

  private resolveScenarioName(candidate: string): ScenarioName {
    return (SCENARIO_NAMES as string[]).includes(candidate)
      ? (candidate as ScenarioName)
      : 'golden';
  }

  // True when the partner-demo bootstrap should apply for the CURRENT scenario. A scenario switch away
  // from partner-demo turns this off (the bootstrap only ever narrates partner-demo).
  private bootstrapActive(): boolean {
    return this.bootstrap !== null && this.scenarioName === 'partner-demo';
  }

  // The active scenario definition: the bootstrap override for partner-demo, else the fixture.
  private resolveScenario(): WithdrawalScenario {
    return this.bootstrapActive() ? (this.bootstrap as ControllerBootstrap).scenarioOverride : getScenario(this.scenarioName);
  }

  // Establish the FRESH-namespace state: seed the bootstrap's validated initialState when active (and
  // persist it so a reload restores it), else the empty defaults. `warning` is an explanatory caveat
  // (e.g. the message from a reset-on-invalid) preserved after the seed's own persist result.
  private seedFresh(warning: string | null): void {
    this.stateKnown = true;
    this.restoreUnread = false;
    if (this.bootstrapActive()) {
      const seed = (this.bootstrap as ControllerBootstrap).initialState;
      // Validated EXACTLY like a stored blob: the same accounting/identity/lifecycle invariants a
      // loaded blob must pass. A bad seed is a programming error, surfaced loudly rather than silently
      // opening a fabricated available balance.
      const problem = this.validatePersistedState(seed);
      if (problem) throw new Error(`withdrawal bootstrap initialState is invalid: ${problem}`);
      this.applyState(seed);
      this.persist();
      if (warning) this.persistenceWarning = warning;
      return;
    }
    this.applyDefaults();
    this.persistenceWarning = warning;
  }

  private makeStore(): PersistedStore {
    // The store key carries the FULL declared scope (incl. user + permission) so a different
    // actor/permission over the same partner/payer/scenario never restores another actor's
    // reserved money (F03). The `readError` control is a TRANSPORT-read simulation and is NOT
    // wired into storage: a failed read must not erase persisted data (F05).
    return new PersistedStore(this.rawStorage, {
      scenario: this.scenarioName,
      userId: this.scope.userId,
      partnerId: this.scope.partnerId,
      permissionRevision: this.scope.permissionRevision,
      payerId: this.scope.payerId,
      currency: this.scope.currency,
    });
  }

  private makeBeneficiaryStore(): BeneficiaryConfigStore {
    return new BeneficiaryConfigStore(this.rawStorage, {
      scenario: this.scenarioName,
      userId: this.scope.userId,
      partnerId: this.scope.partnerId,
      permissionRevision: this.scope.permissionRevision,
      payerId: this.scope.payerId,
      currency: this.scope.currency,
    });
  }

  // Load the SEPARATE payout config (independent of the money store): fail-closed on a present-but-
  // invalid/unreadable/foreign-scope config; fixture fallback ONLY when truly absent (legacy).
  private loadBenConfig(): void {
    const r = this.beneficiaryStore.load(this.scope);
    if (r.outcome === 'loaded' && r.config) this.benConfig = { kind: 'loaded', config: r.config };
    else if (r.outcome === 'unavailable')
      this.benConfig = { kind: 'unavailable', reasons: [r.warning ?? 'การตั้งค่าบัญชีรับเงินยังใช้ไม่ได้'] };
    else this.benConfig = { kind: 'absent' };
  }

  // Read-boundary authoritative refresh (B-F05). A config read attempts to recover from a TRANSIENT
  // read outage: an uncertain post-commit save that could not reread durably left the common
  // effective beneficiary `unavailable`, but the durable record may now be readable. Reread the scoped
  // config ONCE — on success the shared `benConfig` is updated in place so summary/readiness/quote all
  // observe the recovered record; on a repeated read failure it STAYS `unavailable` (fail-closed). A
  // genuinely corrupt/foreign record simply re-parses to `unavailable` again, so it is never masked.
  // This is a pure recovery READ: it never mutates money, never replays the original command (no false
  // saved), and never notifies — so a query/`useSyncExternalStore` consumer cannot loop on refetch.
  private refreshBenConfigOnRead(): void {
    if (this.benConfig.kind === 'unavailable') this.loadBenConfig();
  }

  // ---- subscribe / version seam (UI refresh only) -----------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  // Bump the UI-notification version FIRST (so a listener that reads uiVersion() sees the new value),
  // then fan out. Listeners only refresh UI.
  private notify(): void {
    this.uiTick += 1;
    for (const fn of [...this.listeners]) fn();
  }
  // Reactive UI version (changes on every notify). This is what the runtime `version()` exposes.
  uiVersion(): number {
    return this.uiTick;
  }
  // The financial mutation sequence (drives revisions/quote staleness). NOT a UI change signal.
  mutationSeq(): number {
    return this.seq;
  }
  epoch(): number {
    return this.resetEpoch;
  }
  cancelSimMode(): CancelSimModeValue {
    return this.controls.cancelMode;
  }
  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }
  // True when `n` more seq increments stay within the persisted bound. Checked BEFORE any mutation.
  private seqBudget(n: number): boolean {
    return this.seq + n <= MAX_SEQ;
  }

  // ---- state application / persistence ----------------------------------------------

  private applyDefaults(): void {
    this.requests = [];
    this.cancellations = [];
    this.releaseLog = [];
    this.releasedPeriods = new Set();
    this.controls = {
      staleQuote: false,
      changedBeneficiary: false,
      unknownOutcome: false,
      cancelMode: 'success',
    };
    this.beneficiaryBump = 0;
    this.staleBump = 0;
    this.seq = 0;
    this.issuedQuotes.clear();
    this.consumedQuotes.clear();
  }

  private applyState(state: PersistedStateValue): void {
    if (state.version === 2) {
      this.requests = state.requests;
      this.cancellations = state.cancellations;
      this.releaseLog = state.releaseLog;
      this.releasedPeriods = new Set(state.releasedPeriods);
      this.controls = state.controls;
      this.beneficiaryBump = state.beneficiaryBump;
      this.staleBump = state.staleBump;
      this.seq = state.seq;
    } else {
      this.applyMigratedV1(state);
    }
    this.issuedQuotes.clear();
    this.consumedQuotes.clear();
  }

  // Same-key v1 -> v2 in-place upgrade. Preserves refs/keys/amounts/beneficiary/submittedAt
  // exactly. Each legacy record gets a SINGLE honest `legacy_snapshot` at its original submittedAt
  // (no invented submitted-at-current-status event) and an `unavailable` source context —
  // historyComplete:false. The controller writes v2 on the NEXT save.
  private applyMigratedV1(state: PersistedStateV1Value): void {
    this.seq = 0;
    this.requests = state.requests.map((core) => {
      const seq = this.nextSeq();
      const record: PersistedWithdrawalRecordValue = {
        ...core,
        timeline: [
          { seq, at: core.submittedAt, kind: 'legacy_snapshot', status: core.status, detail: null },
        ],
        historyComplete: false,
        sourceContext: {
          state: 'unavailable',
          reasons: ['ไม่มีบันทึกที่มาของงวดสำหรับคำขอเดิม (ก่อนอัปเกรดข้อมูล)'],
        },
      };
      return record;
    });
    this.cancellations = [];
    this.releaseLog = [];
    this.releasedPeriods = new Set(state.releasedPeriods);
    this.controls = { ...state.controls, cancelMode: 'success' };
    this.beneficiaryBump = state.beneficiaryBump;
    this.staleBump = state.staleBump;
  }

  private currentPersistedState(): PersistedStateV2Value {
    return {
      version: STORE_VERSION,
      scope: this.scope,
      scenario: this.scenarioName,
      seq: this.seq,
      requests: this.requests,
      cancellations: this.cancellations,
      releasedPeriods: [...this.releasedPeriods],
      releaseLog: this.releaseLog,
      controls: this.controls,
      beneficiaryBump: this.beneficiaryBump,
      staleBump: this.staleBump,
    };
  }

  private scopeEqual(a: WithdrawalScopeValue, b: WithdrawalScopeValue): boolean {
    return (
      a.userId === b.userId &&
      a.partnerId === b.partnerId &&
      a.permissionRevision === b.permissionRevision &&
      a.payerId === b.payerId &&
      a.currency === b.currency &&
      a.scenario === b.scenario
    );
  }

  // Validate a loaded blob's ACCOUNTING/IDENTITY/lifecycle invariants (not just its shape, which
  // the store already parsed) before projection. Returns a warning to reject-and-reset, or null.
  private validatePersistedState(state: PersistedStateValue): string | null {
    return state.version === 2 ? this.validateV2(state) : this.validateV1(state);
  }

  private static readonly REJECT =
    'สถานะที่บันทึกไว้ไม่สอดคล้องกับกติกา จึงรีเซ็ตเฉพาะสถานการณ์นี้';

  // v1 (WU01) invariants — unchanged: v1 only records active requests (requested/reconciling) whose
  // reserve equals gross. Any other status is a projection WU01 never wrote.
  private validateV1(state: PersistedStateV1Value): string | null {
    const reject = WithdrawalController.REJECT;
    if (!this.scopeEqual(state.scope, this.scope)) return reject;
    if (state.scenario !== this.scenarioName) return reject;
    const seenRefs = new Set<string>();
    const seenKeys = new Set<string>();
    for (const r of state.requests) {
      if (!this.scopeEqual(r.scope, this.scope)) return reject;
      if (seenRefs.has(r.requestRef) || seenKeys.has(r.idempotencyKey)) return reject;
      seenRefs.add(r.requestRef);
      seenKeys.add(r.idempotencyKey);
      const deducted = r.deductions.reduce((t, d) => t + BigInt(d.amount.minor), 0n);
      if (BigInt(r.net.minor) + deducted !== BigInt(r.gross.minor)) return reject;
      if (r.status !== 'requested' && r.status !== 'reconciling') return reject;
      if (r.reserved.minor !== r.gross.minor) return reject;
    }
    const knownReleasable = new Set(this.scenario.releasable.map((p) => p.periodId));
    for (const periodId of state.releasedPeriods) if (!knownReleasable.has(periodId)) return reject;
    return null;
  }

  // v2 (WU02) invariants: per-record reserve/status/net coherence + legal timeline; cancellation
  // receipt coherence; releaseLog consistency; and request-derived conservation (settled+reserved
  // never exceed released). The authored zero/deficit/unavailable BASELINES are never rejected —
  // conservation only bounds REQUEST-derived amounts, not the authored base.settled.
  private validateV2(state: PersistedStateV2Value): string | null {
    const reject = WithdrawalController.REJECT;
    if (!this.scopeEqual(state.scope, this.scope)) return reject;
    if (state.scenario !== this.scenarioName) return reject;
    const knownReleasable = new Set(this.scenario.releasable.map((p) => p.periodId));
    const byRef = new Map<string, PersistedWithdrawalRecordValue>();
    const seenKeys = new Set<string>();
    let settled = 0n;
    let reserved = 0n;
    for (const r of state.requests) {
      if (!this.scopeEqual(r.scope, this.scope)) return reject;
      if (byRef.has(r.requestRef) || seenKeys.has(r.idempotencyKey)) return reject;
      byRef.set(r.requestRef, r);
      seenKeys.add(r.idempotencyKey);
      const deducted = r.deductions.reduce((t, d) => t + BigInt(d.amount.minor), 0n);
      if (BigInt(r.net.minor) + deducted !== BigInt(r.gross.minor)) return reject;
      const active = ACTIVE.has(r.status);
      if (active && r.reserved.minor !== r.gross.minor) return reject;
      if (!active && r.reserved.minor !== '0') return reject;
      if (r.status === 'paid') settled += BigInt(r.gross.minor);
      if (active) reserved += BigInt(r.reserved.minor);
      if (!this.timelineLegal(r)) return reject;
    }
    for (const c of state.cancellations) {
      if (!this.scopeEqual(c.scope, this.scope)) return reject;
      if (!this.receiptCoherent(c)) return reject;
      const rec = byRef.get(c.requestRef);
      if (!rec || rec.idempotencyKey !== c.requestIdempotencyKey) return reject;
      if (c.outcome === 'unknown' && !ACTIVE.has(rec.status)) return reject;
      if (c.outcome === 'accepted' && !(rec.status === 'cancelled' && rec.reserved.minor === '0'))
        return reject;
    }
    for (const e of state.releaseLog)
      if (!knownReleasable.has(e.periodId) || !state.releasedPeriods.includes(e.periodId))
        return reject;
    for (const periodId of state.releasedPeriods) if (!knownReleasable.has(periodId)) return reject;
    const releasedPool =
      BigInt(this.scenario.base.released) +
      this.scenario.releasable
        .filter((p) => state.releasedPeriods.includes(p.periodId))
        .reduce((t, p) => t + BigInt(p.amount), 0n);
    if (settled + reserved > releasedPool) return reject;
    return null;
  }

  // Mirror of the model's timeline legality (kept in sync): strictly-increasing unique seq, legal
  // transitions, kind<->status, submitted-or-legacy prefix, tail == current status.
  private timelineLegal(r: PersistedWithdrawalRecordValue): boolean {
    const tl = r.timeline;
    if (tl.length === 0) return false;
    const head = tl[0];
    if (r.historyComplete) {
      if (head.kind !== 'submitted') return false;
      if (tl.some((e) => e.kind === 'legacy_snapshot')) return false;
    } else {
      if (head.kind !== 'legacy_snapshot') return false;
      if (head.at !== r.submittedAt) return false;
      if (tl.some((e) => e.kind === 'submitted')) return false;
      if (tl.filter((e) => e.kind === 'legacy_snapshot').length !== 1) return false;
    }
    for (let i = 0; i < tl.length; i++) {
      const e = tl[i];
      if (e.kind !== 'legacy_snapshot' && EVENT_KIND_STATUS[e.kind] !== e.status) return false;
      if (i > 0) {
        const p = tl[i - 1];
        if (e.seq <= p.seq) return false;
        if (e.kind === 'legacy_snapshot') return false;
        if (!REQUEST_TRANSITIONS[p.status].includes(e.status)) return false;
      }
    }
    return tl[tl.length - 1].status === r.status;
  }

  private receiptCoherent(c: WithdrawalCancellationReceiptValue): boolean {
    switch (c.outcome) {
      case 'accepted':
        return c.code === null && c.resolvedAt !== null;
      case 'unknown':
        return c.code === null && c.resolvedAt === null;
      case 'operation_failed':
        return c.code !== null && c.resolvedAt !== null;
      case 'rejected':
        return c.code !== null && c.resolvedAt !== null;
    }
  }

  // Restore from storage; an unreadable/invalid/inconsistent blob resets ONLY this namespace with a
  // visible warning and never touches auth. A recoverable READ outage keeps the stored bytes intact
  // (defaults shown in memory only). A same-tab reload uses a fresh controller + same storage.
  reload(): void {
    this.restore();
    // The payout config is a SEPARATE store, loaded independently of the money restore.
    this.loadBenConfig();
    // EVERY reload path (data applied, warning set, or warning cleared) publishes a NEW UI snapshot
    // so a shared-runtime subscriber refreshes. The financial `seq` is untouched (this is a read),
    // and read-outage non-overwrite still holds. The constructor has no subscribers, so the initial
    // load's notify is a harmless UI tick.
    this.notify();
  }

  // The actual restore (no UI notification). See reload() for the notification wrapper.
  private restore(): void {
    const { state, warning, readFaulted } = this.store.load();
    if (readFaulted) {
      if (!this.stateKnown) this.restoreUnread = true;
      this.persistenceWarning = warning;
      return;
    }
    if (!state) {
      // FRESH namespace: seed the bootstrap (partner-demo) or empty defaults. A new generation gets
      // its own namespace (permissionRevision carries datasetId::generation), so this seeds once.
      this.seedFresh(warning);
      return;
    }
    const problem = this.validatePersistedState(state);
    if (problem) {
      // Existing-but-inconsistent state resets ONLY this namespace, then re-honours the bootstrap seed
      // (never leaving a partner-demo namespace with a fabricated empty/available state).
      this.store.reset();
      this.seedFresh(problem);
      return;
    }
    // Existing valid stored state WINS (the seed never overwrites a live session).
    this.applyState(state);
    this.stateKnown = true;
    this.restoreUnread = false;
    this.persistenceWarning = warning;
  }

  // Save is best-effort. On failure it warns and NEVER claims durability, but the in-memory state
  // (including an already-shown mutation) is kept. While a fresh restore is unread, persistence is
  // SUPPRESSED so default state can never overwrite the still-stored reservation.
  private persist(): void {
    if (this.restoreUnread) return;
    const warning = this.store.save(this.currentPersistedState());
    this.persistenceWarning = warning;
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }
  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  // ---- record helpers ---------------------------------------------------------------

  private coreOf(rec: PersistedWithdrawalRecordValue): WithdrawalRequestValue {
    const { timeline: _t, historyComplete: _h, sourceContext: _s, ...core } = rec;
    return core;
  }
  private isActive(status: RequestStatusValue): boolean {
    return ACTIVE.has(status);
  }
  private zero(): MoneyValue {
    return thb(0n);
  }

  // Append a lifecycle event using the global monotonic seq (guarantees strictly-increasing,
  // within-record unique ordering). Callers must have bound-checked TIMELINE_CAPACITY.
  private appendEvent(
    rec: PersistedWithdrawalRecordValue,
    kind: WithdrawalTimelineEntryValue['kind'],
    status: RequestStatusValue,
    detail: string | null = null,
  ): void {
    rec.timeline.push({ seq: this.nextSeq(), at: this.nowIso(), kind, status, detail });
  }

  // A legal status transition. Sets reserved by status (active -> gross, terminal -> 0), refreshes
  // allowed actions, records the event, and on reaching a TERMINAL status resolves any outstanding
  // UNKNOWN cancellation intent for the request (it definitively did not complete). Returns false
  // (no mutation) for an illegal transition or a full timeline.
  private transition(rec: PersistedWithdrawalRecordValue, to: RequestStatusValue): boolean {
    if (!REQUEST_TRANSITIONS[rec.status].includes(to)) return false;
    // Timeline + sequence budgets checked BEFORE mutating.
    if (rec.timeline.length >= TIMELINE_CAPACITY) return false;
    if (!this.seqBudget(1)) return false;
    rec.status = to;
    rec.reserved = this.isActive(to) ? rec.gross : this.zero();
    rec.allowedActions = actionsFor(to);
    // A transition target (processing/paid/failed/cancelled/reconciling) is always a valid event
    // kind of the same name; `requested`/`submitted`/`legacy_snapshot` are never transition targets.
    this.appendEvent(rec, to as WithdrawalTimelineEntryValue['kind'], to);
    if (!this.isActive(to)) this.resolveUnknownOps(rec.requestRef);
    return true;
  }

  // A terminal transition means any still-unresolved cancellation intent for the request did NOT
  // take effect: resolve it to operation_failed (historical), never silently to accepted.
  private resolveUnknownOps(requestRef: string): void {
    for (const c of this.cancellations)
      if (c.requestRef === requestRef && c.outcome === 'unknown') {
        c.outcome = 'operation_failed';
        c.code = 'not_cancellable';
        c.detail = 'คำสั่งยกเลิกก่อนหน้าไม่สำเร็จ เพราะคำขอเปลี่ยนสถานะไปแล้ว';
        c.resolvedAt = this.nowIso();
      }
  }

  // The pool provenance FROZEN onto a new request at submission: the base source periods plus any
  // releasable periods released at/before now, each with the ACTUAL recorded release time (or null
  // when unknown, e.g. a v1-migrated release). Never a per-withdrawal allocation.
  private frozenSourceContext(): WithdrawalSourceContextValue {
    const periods = [
      ...this.scenario.base.sourcePeriods.map((sp) => ({
        periodId: sp.periodId,
        label: sp.label,
        releasedAt: sp.releasedAt,
        releasedAmount: thb(BigInt(sp.amount)),
        statementId: sp.statementId ?? null,
      })),
      ...this.scenario.releasable
        .filter((rp) => this.releasedPeriods.has(rp.periodId))
        .map((rp) => ({
          periodId: rp.periodId,
          label: rp.label,
          releasedAt: this.releaseLog.find((e) => e.periodId === rp.periodId)?.at ?? null,
          releasedAmount: thb(BigInt(rp.amount)),
          statementId: rp.statementId ?? null,
        })),
    ];
    return { state: 'known', periods, allocationModeled: false };
  }

  // The documents section for a request detail. Terminal-confirmed only: a `paid` request exposes an
  // `available` section with a single immutable, system-issued acknowledgment (issuer `labsd`,
  // `providerReference: null`) whose `issuedAt` is the RECORDED paid-event instant (never Date.now)
  // and whose `net` is the request's actual net cash. No provider bank slip is fabricated while the
  // gateway is `not_connected`; every non-paid status keeps the honest `pending` arm.
  private documentsSection(
    rec: PersistedWithdrawalRecordValue,
  ): { state: 'pending'; reasons: string[] } | { state: 'available'; documents: unknown[] } {
    if (rec.status !== 'paid')
      return {
        state: 'pending',
        reasons: ['เอกสารประกอบคำขอจะพร้อมให้ดาวน์โหลดในภายหลัง (ยังไม่มีไฟล์จริง)'],
      };
    const paidEvent = [...rec.timeline].reverse().find((e) => e.kind === 'paid');
    // A paid record always carries a `paid` event (kind==='paid' ⇒ status paid). Defensive: without a
    // recorded paid instant we cannot honestly stamp `issuedAt`, so fall back to pending rather than
    // invent a time.
    if (!paidEvent)
      return {
        state: 'pending',
        reasons: ['ยังไม่มีบันทึกเวลาการชำระเงินสำหรับออกเอกสารรับรอง'],
      };
    return {
      state: 'available',
      documents: [
        {
          documentId: `ack:${rec.requestRef}`,
          kind: 'system_acknowledgment',
          issuer: 'labsd',
          title: 'เอกสารรับรองการโอนที่ระบบออก (ตัวอย่าง)',
          requestRef: rec.requestRef,
          issuedAt: paidEvent.at,
          net: rec.net,
          providerReference: null,
        },
      ],
    };
  }

  // ---- derived scope / revisions ----------------------------------------------------

  private balanceScope(): BalanceScopeValue {
    return {
      partnerId: this.scope.partnerId,
      payerId: this.scope.payerId,
      currency: this.scope.currency,
    };
  }

  private configVersionOf(): number {
    return this.benConfig.kind === 'loaded' ? this.benConfig.config.configVersion : 0;
  }
  // The QUOTE-binding beneficiary version folds BOTH the legacy money-store `beneficiaryBump`
  // (WU02 changeBeneficiary invalidation, retained) AND the committed config version — so either a
  // legacy change or a config save stales outstanding quotes. Both derive from committed state.
  private beneficiaryVersion(): string {
    return `${this.scenario.versions.beneficiary}-b${this.beneficiaryBump}-c${this.configVersionOf()}`;
  }
  // The config's OWN revision (write concurrency token + config read key) — derives ONLY from the
  // committed config version, so a money mutation (submit/release/etc.) never disturbs a config edit.
  private configRevision(): string {
    return `cfg-${this.scenarioName}-c${this.configVersionOf()}`;
  }

  // The ONE effective beneficiary used by presentation/mask/readiness/quote. A valid config overrides
  // the scenario fixture; a present-but-invalid config is `unavailable` (blocks); a TRULY ABSENT
  // (legacy) config falls back to the fixture.
  private effectiveBeneficiary():
    | { state: 'known'; displayName: string; bankName: string; maskedAccount: string; version: string }
    | { state: 'pending'; version: string; reasons: string[] }
    | { state: 'missing'; reasons: string[] }
    | { state: 'unavailable'; reasons: string[] } {
    const version = this.beneficiaryVersion();
    if (this.benConfig.kind === 'unavailable')
      return { state: 'unavailable', reasons: this.benConfig.reasons };
    if (this.benConfig.kind === 'loaded') {
      const c = this.benConfig.config;
      if (c.state === 'verified') {
        const bank = c.bankId ? catalogBank(c.bankId) : null;
        const acct = c.accountChoiceId ? catalogAccount(c.accountChoiceId) : null;
        if (!bank || !acct || !c.displayName)
          return { state: 'unavailable', reasons: ['การตั้งค่าบัญชีรับเงินอ้างถึงตัวเลือกที่ไม่มีในแคตตาล็อก'] };
        return { state: 'known', displayName: c.displayName, bankName: bank.bankLabel, maskedAccount: acct.maskedAccount, version };
      }
      if (c.state === 'pending')
        return { state: 'pending', version, reasons: ['บัญชีผู้รับเงินอยู่ระหว่างการยืนยัน (ตัวอย่าง)'] };
      return { state: 'missing', reasons: ['ยังไม่ได้ตั้งค่าบัญชีผู้รับเงิน'] };
    }
    const b = this.scenario.beneficiary;
    if (b.state === 'known')
      return { state: 'known', displayName: b.displayName, bankName: b.bankName, maskedAccount: b.maskedAccount, version };
    if (b.state === 'pending') return { state: 'pending', version, reasons: b.reasons };
    return { state: 'missing', reasons: b.reasons };
  }

  private policyRevision(): string {
    return this.scenario.versions.taxPolicy;
  }

  // Active reservations from live requests (paid/cancelled/failed hold nothing).
  private reservedMinor(): bigint {
    return this.requests
      .filter((r) => this.isActive(r.status))
      .reduce((total, r) => total + BigInt(r.reserved.minor), 0n);
  }

  private componentsMinor(): { released: bigint; settled: bigint; reserved: bigint; held: bigint } {
    const released =
      BigInt(this.scenario.base.released) +
      this.scenario.releasable
        .filter((p) => this.releasedPeriods.has(p.periodId))
        .reduce((total, p) => total + BigInt(p.amount), 0n);
    // Paid requests convert their reserved GROSS (not net cash) into settled obligation, exactly
    // once — this is a projection over status, so it can never double-count.
    const settled =
      BigInt(this.scenario.base.settled) +
      this.requests
        .filter((r) => r.status === 'paid')
        .reduce((total, r) => total + BigInt(r.gross.minor), 0n);
    return {
      released,
      settled,
      reserved: this.reservedMinor(),
      held: BigInt(this.scenario.base.held),
    };
  }

  // Revisions derive PURELY from the bounded monotonic seq (no unbounded ref/status fingerprint,
  // no ABA): any accepted mutation bumps seq and stales every outstanding quote.
  private balanceRevision(): string {
    return `wr-bal-${this.scenarioName}-${this.seq}`;
  }
  private summaryRevision(): string {
    return `wr-sum-${this.scenarioName}-${this.seq}`;
  }

  private balanceSnapshot(): BalanceSnapshotValue {
    if (this.restoreUnread)
      return unavailableBalance({
        scope: this.balanceScope(),
        asOf: this.nowIso(),
        reasons: ['อ่านสถานะที่บันทึกไว้ไม่ได้ชั่วคราว จึงยังไม่ทราบยอดที่พร้อมถอน'],
      });
    if (this.scenario.balanceState === 'unavailable')
      return unavailableBalance({
        scope: this.balanceScope(),
        asOf: this.nowIso(),
        reasons: this.scenario.balanceReasons,
      });
    const c = this.componentsMinor();
    return knownBalance({
      scope: this.balanceScope(),
      revision: this.balanceRevision(),
      asOf: this.nowIso(),
      components: {
        released: thb(c.released),
        settled: thb(c.settled),
        reserved: thb(c.reserved),
        held: thb(c.held),
      },
    });
  }

  private beneficiaryPresentation(): PayoutBeneficiaryValue {
    const e = this.effectiveBeneficiary();
    if (e.state === 'known')
      return {
        state: 'known',
        displayName: e.displayName,
        bankName: e.bankName,
        maskedAccount: e.maskedAccount,
        version: e.version,
      };
    if (e.state === 'pending') return { state: 'pending', version: e.version, reasons: e.reasons };
    // `missing` OR `unavailable` present as summary `missing` (both block); reasons carry the cause.
    return { state: 'missing', reasons: e.reasons };
  }

  private maskedSnapshot(): MaskedBeneficiaryValue | null {
    const e = this.effectiveBeneficiary();
    if (e.state !== 'known') return null;
    return {
      displayName: e.displayName,
      bankName: e.bankName,
      maskedAccount: e.maskedAccount,
      version: e.version,
    };
  }

  private readiness(snapshot: BalanceSnapshotValue): WithdrawalReadinessResultValue {
    const scope = this.balanceScope();
    const evidenceRef = `${this.scenarioName}-evidence`;
    const approved = (version: string) =>
      ({ status: 'approved', scope, version, evidenceRef }) as const;
    const f = this.scenario.facts;
    return evaluateWithdrawalReadiness({
      context: {
        scope,
        asOf: this.nowIso(),
        expectedVersions: {
          payer: this.scenario.versions.payer,
          releaseRule: this.scenario.versions.releaseRule,
          taxPolicy: this.scenario.versions.taxPolicy,
          beneficiary: this.beneficiaryVersion(),
        },
        expectedBalanceRevision:
          snapshot.state === 'known' ? snapshot.revision : this.balanceRevision(),
      },
      payer: f.payer === 'approved' ? approved(this.scenario.versions.payer) : { status: 'unknown' },
      releaseRule:
        f.releaseRule === 'approved'
          ? approved(this.scenario.versions.releaseRule)
          : { status: 'unknown' },
      taxPolicy:
        f.taxPolicy.status === 'approved'
          ? { ...approved(this.scenario.versions.taxPolicy), declaredWithholding: f.taxPolicy.declaredWithholding }
          : { status: 'unknown' },
      // ONE effective beneficiary drives readiness: approved iff effectively `known` (a saved+
      // DEV-verified config, or a legacy-absent fixture that is `known`). missing/pending/unavailable
      // all leave the beneficiary unknown (blocks the quote/submit gate).
      beneficiary:
        this.effectiveBeneficiary().state === 'known'
          ? approved(this.beneficiaryVersion())
          : { status: 'unknown' },
      balance: snapshot,
    });
  }

  // ---- transport operations: reads --------------------------------------------------

  private resumeDescriptors(): WithdrawalResumeValue[] {
    return this.requests
      .filter((r) => this.isActive(r.status))
      .map((r) => ({
        requestRef: r.requestRef,
        idempotencyKey: r.idempotencyKey,
        status: r.status,
        gross: r.gross,
        net: r.net,
        reserved: r.reserved,
        submittedAt: r.submittedAt,
        allowedActions: r.allowedActions,
      }));
  }

  // The most recent GENUINELY PAID withdrawal for the summary's "last successful withdrawal" line.
  // Tri-state:
  //   • undefined — provenance UNKNOWN (a fresh unreadable restore, or an unavailable balance
  //     source): we cannot honestly assert anything, so surface nothing rather than a fabricated none.
  //   • null      — VERIFIED never paid (opening settled is a known zero AND no controller-paid
  //     record AND no authored opening settlement).
  //   • value     — the latest paid withdrawal, chosen by its recorded PAID EVENT instant (never
  //     `submittedAt`), carrying the request's ACTUAL net cash — NEVER the base.settled aggregate.
  private lastWithdrawal(): WithdrawalLastPaidValue | null | undefined {
    // Unknown provenance: never claim a last-withdrawal (or a verified none) we cannot substantiate.
    if (this.restoreUnread) return undefined;
    if (this.scenario.balanceState === 'unavailable') return undefined;

    // Candidate = a genuinely PAID withdrawal. `ms` is the paid EVENT time (ordering authority);
    // `order` breaks exact-time ties toward the later-recorded / real controller record.
    type Candidate = { requestRef: string; net: MoneyValue; paidAt: string; ms: number; order: number };
    const candidates: Candidate[] = [];
    for (const r of this.requests) {
      if (r.status !== 'paid') continue;
      // A paid record always carries exactly one `paid` event (kind==='paid' ⇒ status paid); take
      // its recorded instant. Skip defensively rather than fall back to submittedAt or invent a time.
      const paidEvent = [...r.timeline].reverse().find((e) => e.kind === 'paid');
      if (!paidEvent) continue;
      const ms = Date.parse(paidEvent.at);
      if (!Number.isFinite(ms)) continue;
      candidates.push({ requestRef: r.requestRef, net: r.net, paidAt: paidEvent.at, ms, order: paidEvent.seq });
    }
    // An authored opening settlement is a candidate ONLY with explicit, base.settled-coherent scenario
    // evidence. It uses `order: -1` so a same-instant real controller record always supersedes it.
    const opening = this.scenario.openingLastWithdrawal;
    if (opening) {
      const ms = Date.parse(opening.paidAt);
      if (Number.isFinite(ms))
        candidates.push({
          requestRef: opening.requestRef,
          net: thb(BigInt(opening.net)),
          paidAt: opening.paidAt,
          ms,
          order: -1,
        });
    }

    if (candidates.length > 0) {
      const latest = candidates.reduce((a, b) =>
        b.ms > a.ms || (b.ms === a.ms && b.order > a.order) ? b : a,
      );
      return { requestRef: latest.requestRef, net: latest.net, paidAt: latest.paidAt };
    }

    // No paid withdrawal anywhere. A KNOWN-zero opening settlement is a VERIFIED "never paid" (null);
    // a positive opening settled with no attributable last-withdrawal evidence is UNKNOWN provenance
    // (undefined) — we never mint a "none" from an aggregate we cannot attribute to one payment.
    return BigInt(this.scenario.base.settled) === 0n ? null : undefined;
  }

  summary(): WithdrawalSummaryValue {
    if (this.readError)
      throw new WithdrawalReadError('summary', 'ไม่สามารถอ่านข้อมูลการถอนได้ชั่วคราว กรุณาลองใหม่');
    const balance = this.balanceSnapshot();
    const readiness = this.readiness(balance);
    // Tri-state: undefined is surfaced as an ABSENT key (matching an older transport / an unknown
    // provenance); null and a value are passed through explicitly.
    const last = this.lastWithdrawal();
    return WithdrawalSummary.parse({
      scope: this.scope,
      asOf: this.nowIso(),
      balance,
      beneficiary: this.beneficiaryPresentation(),
      currentPeriodPending:
        this.scenario.currentPeriodPending === null
          ? null
          : thb(BigInt(this.scenario.currentPeriodPending)),
      currentPeriod: this.scenario.currentPeriod,
      readiness,
      persistenceWarning: this.persistenceWarning,
      resume: this.resumeDescriptors(),
      ...(last === undefined ? {} : { lastWithdrawal: last }),
      revision: this.summaryRevision(),
    });
  }

  // All requests in scope, newest submitted first. Every row is the full immutable core record.
  list(): WithdrawalListValue {
    if (this.readError)
      throw new WithdrawalReadError('list', 'ไม่สามารถอ่านประวัติการถอนได้ชั่วคราว กรุณาลองใหม่');
    // A FRESH unreadable restore (S1-F01): the persisted request set is not yet known, so returning
    // an empty list would falsely claim "no requests". Throw a typed read error until a later reload
    // recovers the real records (the stored bytes are preserved). Now a live STAFF read path too.
    if (this.restoreUnread)
      throw new WithdrawalReadError('list', 'ยังกู้คืนสถานะที่บันทึกไว้ไม่สำเร็จ จึงยังแสดงประวัติการถอนไม่ได้');
    const items = [...this.requests]
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
      .map((r) => this.coreOf(r));
    return WithdrawalList.parse({
      scope: this.scope,
      asOf: this.nowIso(),
      items,
      nextCursor: null,
      revision: this.summaryRevision(),
    });
  }

  detail(requestRef: string): WithdrawalDetailResultValue {
    if (this.readError)
      throw new WithdrawalReadError('detail', 'ไม่สามารถอ่านรายละเอียดการถอนได้ชั่วคราว กรุณาลองใหม่');
    // A FRESH unreadable restore (S1-F01): the persisted record is not yet known, so returning
    // `missing` would falsely claim the request does not exist. Throw a typed read error until a
    // later reload recovers it (the stored bytes are preserved). Now a live STAFF read path too.
    if (this.restoreUnread)
      throw new WithdrawalReadError('detail', 'ยังกู้คืนสถานะที่บันทึกไว้ไม่สำเร็จ จึงยังแสดงรายละเอียดการถอนไม่ได้');
    const rec = this.requests.find((r) => r.requestRef === requestRef);
    if (!rec)
      return WithdrawalDetailResult.parse({ state: 'missing', scope: this.scope, requestRef });
    const pendingCancellations = this.cancellations.filter(
      (c) => c.requestRef === rec.requestRef && c.outcome === 'unknown',
    );
    return WithdrawalDetailResult.parse({
      state: 'found',
      detail: {
        request: this.coreOf(rec),
        timeline: rec.timeline,
        historyComplete: rec.historyComplete,
        sourceContext: rec.sourceContext,
        documents: this.documentsSection(rec),
        pendingCancellations,
        revision: this.summaryRevision(),
      },
    });
  }

  // WU03 S1 — release-pool / current-period preview from the SAME controller. Honest provenance:
  // `released` reuses the frozen-source shape (base source periods + releasable periods actually
  // released, each with its ACTUAL recorded time or null for a v1-migrated release); `releasable`
  // lists eligible, NOT-yet-released prior periods with a DISTINCT `eligibleAmount`. No native
  // approval/schedule/count fields. A close/release is separate from a transfer.
  periods(): WithdrawalPeriodsViewValue {
    if (this.readError)
      throw new WithdrawalReadError('periods', 'ไม่สามารถอ่านข้อมูลงวด/การปล่อยยอดได้ชั่วคราว กรุณาลองใหม่');
    // A FRESH unreadable restore (S1-F01): the authoritative persisted release/request state is not
    // yet known, so returning the fixture release state here would confidently contradict it. Throw
    // a typed read error (the stored bytes are untouched) until a later reload recovers the real state.
    if (this.restoreUnread)
      throw new WithdrawalReadError('periods', 'ยังกู้คืนสถานะที่บันทึกไว้ไม่สำเร็จ จึงยังแสดงข้อมูลงวด/การปล่อยยอดไม่ได้');
    // UNKNOWN source (S1-F03): when the scenario's balance/source is `unavailable` (e.g. missing
    // source data), the base released/releasable amounts are placeholders — returning empty
    // released/releasable arrays would be read as a KNOWN-empty snapshot and conflate "unknown
    // source" with "known zero". Refuse this authoritative read with a typed error instead; the
    // balance authority stays `summary()` (which has an honest unavailable arm). A KNOWN-zero
    // scenario (`balanceState: 'known'`) is unaffected and remains a valid readable snapshot.
    if (this.scenario.balanceState === 'unavailable')
      throw new WithdrawalReadError('periods', 'ยังไม่ทราบยอด/แหล่งที่มาสำหรับขอบเขตนี้ จึงยังแสดงข้อมูลงวด/การปล่อยยอดไม่ได้');
    const released = [
      ...this.scenario.base.sourcePeriods.map((sp) => ({
        periodId: sp.periodId,
        label: sp.label,
        releasedAt: sp.releasedAt,
        releasedAmount: thb(BigInt(sp.amount)),
        statementId: sp.statementId ?? null,
      })),
      ...this.scenario.releasable
        .filter((rp) => this.releasedPeriods.has(rp.periodId))
        .map((rp) => ({
          periodId: rp.periodId,
          label: rp.label,
          releasedAt: this.releaseLog.find((e) => e.periodId === rp.periodId)?.at ?? null,
          releasedAmount: thb(BigInt(rp.amount)),
          statementId: rp.statementId ?? null,
        })),
    ];
    const releasable = this.scenario.releasable
      .filter((rp) => !this.releasedPeriods.has(rp.periodId))
      .map((rp) => ({ periodId: rp.periodId, label: rp.label, eligibleAmount: thb(BigInt(rp.amount)) }));
    return WithdrawalPeriodsView.parse({
      scope: this.scope,
      asOf: this.nowIso(),
      currentPeriod: this.scenario.currentPeriod,
      currentPeriodPending:
        this.scenario.currentPeriodPending === null
          ? null
          : thb(BigInt(this.scenario.currentPeriodPending)),
      released,
      releasable,
      revision: this.summaryRevision(),
    });
  }

  // WU03 S2 — the scoped payout config read that powers the shared editor. Independent of the money
  // store. A present-but-invalid config reads as `unavailable` (an honest arm, NOT a throw and NOT a
  // fixture fallback); a truly absent config reflects the scenario fixture. Only masked identity +
  // catalog ids — never a raw number.
  beneficiaryConfig(): PayoutBeneficiaryConfigValue {
    // Attempt a scoped authoritative recovery from a transient read outage BEFORE projecting.
    this.refreshBenConfigOnRead();
    const catalog = BENEFICIARY_CATALOG;
    const revision = this.configRevision();
    if (this.benConfig.kind === 'unavailable')
      return PayoutBeneficiaryConfig.parse({
        scope: this.scope,
        revision,
        state: 'unavailable',
        displayName: null,
        bankId: null,
        bankLabel: null,
        accountChoiceId: null,
        maskedAccount: null,
        reasons: this.benConfig.reasons,
        catalog,
        allowedEdit: false,
      });
    if (this.benConfig.kind === 'loaded') {
      const c = this.benConfig.config;
      const bank = c.bankId ? catalogBank(c.bankId) : null;
      const acct = c.accountChoiceId ? catalogAccount(c.accountChoiceId) : null;
      const reasons =
        c.state === 'pending'
          ? ['บัญชีผู้รับเงินอยู่ระหว่างการยืนยัน (ตัวอย่าง)']
          : c.state === 'missing'
            ? ['ยังไม่ได้ตั้งค่าบัญชีผู้รับเงิน']
            : ['พร้อมใช้งาน (ตัวอย่าง)'];
      return PayoutBeneficiaryConfig.parse({
        scope: this.scope,
        revision,
        state: c.state,
        displayName: c.displayName,
        bankId: c.bankId,
        bankLabel: bank?.bankLabel ?? null,
        accountChoiceId: c.accountChoiceId,
        maskedAccount: acct?.maskedAccount ?? null,
        reasons,
        catalog,
        allowedEdit: true,
      });
    }
    // Absent -> reflect the scenario fixture (the only fixture fallback).
    const b = this.scenario.beneficiary;
    if (b.state === 'known')
      return PayoutBeneficiaryConfig.parse({
        scope: this.scope,
        revision,
        state: 'verified',
        displayName: b.displayName,
        bankId: null,
        bankLabel: b.bankName,
        accountChoiceId: null,
        maskedAccount: b.maskedAccount,
        reasons: ['พร้อมใช้งาน (ตัวอย่างจากสถานการณ์)'],
        catalog,
        allowedEdit: true,
      });
    return PayoutBeneficiaryConfig.parse({
      scope: this.scope,
      revision,
      state: b.state === 'pending' ? 'pending' : 'missing',
      displayName: null,
      bankId: null,
      bankLabel: null,
      accountChoiceId: null,
      maskedAccount: null,
      reasons: b.reasons,
      catalog,
      allowedEdit: true,
    });
  }

  quote(grossMinor: string): WithdrawalQuoteValue {
    const codes: string[] = [];
    const positive = /^[1-9]\d*$/.test(grossMinor);
    const grossN = positive ? BigInt(grossMinor) : 0n;
    if (!positive) codes.push('amount_not_positive');

    const eff = this.effectiveBeneficiary();
    if (eff.state === 'missing') codes.push('beneficiary_missing');
    else if (eff.state === 'pending') codes.push('beneficiary_pending');
    else if (eff.state === 'unavailable') codes.push('beneficiary_unavailable');

    const snapshot = this.balanceSnapshot();
    let deductions: QuoteDeductionValue[] = [];
    let netN = grossN;
    let availableAfterMinor = '0';

    if (snapshot.state === 'unavailable') {
      codes.push('balance_unknown');
    } else if (positive) {
      const readiness = this.readiness(snapshot);
      if (this.scenario.facts.taxPolicy.status === 'unknown') codes.push('tax_policy_unknown');
      if (
        readiness.requestGate === 'blocked' &&
        !codes.includes('tax_policy_unknown') &&
        !codes.includes('beneficiary_missing') &&
        !codes.includes('beneficiary_pending') &&
        !codes.includes('beneficiary_unavailable')
      ) {
        const onlyBalanceNotPositive =
          readiness.blockingReasons.length === 1 &&
          readiness.blockingReasons[0].prerequisite === 'balance';
        if (!onlyBalanceNotPositive) codes.push('not_ready');
      }

      const c = this.componentsMinor();
      const available = computeWithdrawable(c).available;
      if (grossN > available) codes.push('amount_exceeds_available');

      if (this.scenario.deduction.kind === 'applies') {
        const lines = this.scenario.deduction.table[grossMinor];
        if (!lines) codes.push('amount_unsupported');
        else {
          deductions = lines.map((line) => ({
            kind: line.kind,
            label: line.label,
            amount: thb(BigInt(line.amount)),
          }));
          netN = grossN - deductions.reduce((t, d) => t + BigInt(d.amount.minor), 0n);
        }
      }
      availableAfterMinor = computeWithdrawable({ ...c, reserved: c.reserved + grossN }).available.toString();
    }

    const snapshotBeneficiary = this.maskedSnapshot();
    if (codes.length > 0 || snapshotBeneficiary === null) {
      const finalCodes = codes.length > 0 ? codes : ['beneficiary_missing'];
      return WithdrawalQuote.parse({
        state: 'unavailable',
        scope: this.scope,
        gross: thb(positive ? grossN : 0n),
        codes: [...new Set(finalCodes)],
        reasons: [...new Set(finalCodes)].map((code) => REASON[code] ?? code),
      });
    }

    const quoteId = this.idGen.next('quote');
    const grossMoney = thb(grossN);
    const netMoney = thb(netN);
    const bindings = {
      balanceRevision: this.balanceRevision(),
      policyRevision: this.policyRevision(),
      beneficiaryVersion: this.beneficiaryVersion(),
    };
    const expiresAtMs = this.nowMs() + QUOTE_TTL_MS;
    this.issuedQuotes.set(quoteId, {
      gross: grossMoney,
      net: netMoney,
      deductions,
      beneficiary: snapshotBeneficiary,
      ...bindings,
      expiresAtMs,
    });
    return WithdrawalQuote.parse({
      state: 'quoted',
      quoteId,
      scope: this.scope,
      gross: grossMoney,
      deductions,
      net: netMoney,
      availableAfterRequest: thb(BigInt(availableAfterMinor)),
      beneficiary: snapshotBeneficiary,
      bindings,
      issuedAt: this.nowIso(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  }

  // ---- transport operations: commands -----------------------------------------------

  private scopeRejectionFor(s: WithdrawalScopeValue): { code: string; detail: string } | null {
    const target = this.scope;
    if (s.scenario !== target.scenario)
      return { code: 'scenario_mismatch', detail: 'สถานการณ์ (scenario) ไม่ตรงกับขอบเขตปัจจุบัน' };
    if (s.payerId !== target.payerId)
      return { code: 'payer_mismatch', detail: 'ผู้จ่ายเงิน (payer) ไม่ตรงกับขอบเขตปัจจุบัน' };
    if (s.userId !== target.userId || s.permissionRevision !== target.permissionRevision)
      return { code: 'permission_mismatch', detail: 'สิทธิ์ผู้ใช้ไม่ตรงกับขอบเขตปัจจุบัน' };
    if (s.partnerId !== target.partnerId || s.currency !== target.currency)
      return { code: 'scope_mismatch', detail: 'ขอบเขต (partner/currency) ไม่ตรงกัน' };
    return null;
  }

  submit(submission: WithdrawalSubmissionValue): WithdrawalSubmitResultValue {
    const s = WithdrawalSubmission.parse(submission);
    const reject = (code: string, detail: string): WithdrawalSubmitResultValue =>
      WithdrawalSubmitResult.parse({ outcome: 'rejected', code, detail });

    if (this.restoreUnread)
      return reject(
        'restore_unread',
        'ยังอ่านสถานะที่บันทึกไว้ไม่ได้ จึงยังส่งคำขอถอนใหม่ไม่ได้จนกว่าจะอ่านสำเร็จ',
      );

    const scopeReject = this.scopeRejectionFor(s.scope);
    if (scopeReject) return reject(scopeReject.code, scopeReject.detail);

    const existing = this.requests.find((r) => r.idempotencyKey === s.idempotencyKey);
    if (existing) {
      const same =
        existing.quoteId === s.quoteId &&
        existing.gross.minor === s.gross.minor &&
        existing.net.minor === s.net.minor &&
        existing.bindings.balanceRevision === s.bindings.balanceRevision &&
        existing.bindings.beneficiaryVersion === s.bindings.beneficiaryVersion &&
        existing.bindings.policyRevision === s.bindings.policyRevision;
      if (!same)
        return reject('idempotency_conflict', 'คีย์ป้องกันซ้ำเดิมถูกใช้กับข้อมูลที่ต่างออกไป');
      return WithdrawalSubmitResult.parse({
        outcome: existing.status === 'reconciling' ? 'unknown' : 'accepted',
        request: this.coreOf(existing),
      });
    }

    if (this.requests.length >= STORE_CAPACITY)
      return reject(
        'capacity_reached',
        'ถึงขีดจำกัดจำนวนคำขอถอนของสถานการณ์ตัวอย่างนี้แล้ว (เป็นขีดจำกัดของตัวอย่าง ไม่ใช่เพดานการถอนจริง)',
      );

    const issued = this.issuedQuotes.get(s.quoteId);
    if (!issued) {
      if (this.consumedQuotes.has(s.quoteId))
        return reject('quote_consumed', 'ใบเสนอราคานี้ถูกใช้ไปแล้ว ไม่สามารถใช้ซ้ำได้');
      return reject('quote_not_found', 'ไม่พบใบเสนอราคาที่อ้างถึง (อาจหมดอายุหลังรีโหลด)');
    }

    const issuedBindings = {
      balanceRevision: issued.balanceRevision,
      policyRevision: issued.policyRevision,
      beneficiaryVersion: issued.beneficiaryVersion,
    };

    if (
      s.gross.minor !== issued.gross.minor ||
      s.net.minor !== issued.net.minor ||
      s.bindings.balanceRevision !== issuedBindings.balanceRevision ||
      s.bindings.policyRevision !== issuedBindings.policyRevision ||
      s.bindings.beneficiaryVersion !== issuedBindings.beneficiaryVersion
    )
      return reject('stale_quote', 'คำสั่งไม่ตรงกับใบเสนอราคาที่ออกไว้ กรุณาขอใหม่');

    if (this.nowMs() >= issued.expiresAtMs) return reject('quote_expired', 'ใบเสนอราคาหมดอายุ');
    if (issued.beneficiaryVersion !== this.beneficiaryVersion())
      return reject('beneficiary_changed', 'บัญชีผู้รับเงินเปลี่ยนไปหลังออกใบเสนอราคา');
    if (
      issued.balanceRevision !== this.balanceRevision() ||
      issued.policyRevision !== this.policyRevision()
    )
      return reject('stale_quote', 'ใบเสนอราคาไม่ตรงสถานะปัจจุบัน กรุณาขอใหม่');

    const available = computeWithdrawable(this.componentsMinor()).available;
    if (BigInt(issued.gross.minor) > available)
      return reject('amount_unavailable', 'ยอดไม่พอสำหรับคำขอนี้แล้ว');

    // Everything validated against the quote's seq-bound revision: NOW create the reservation,
    // which bumps seq (staling any other outstanding quote) and records the honest timeline +
    // frozen provenance.
    const unknown = this.controls.unknownOutcome;
    // Automatic initiation: a NEW valid submit records the honest `submitted -> processing`
    // timeline in a SINGLE transaction (reserve retained; `paid` NEVER reached from a click). An
    // uncertain outcome instead stays `reconciling` (submitted + reconciling), never auto-advanced.
    // The legacy_manual mode reproduces the older submit->`requested` (single event) behaviour and
    // exists only to seed legacy cancellable records for coverage.
    const legacyManual = this.submitInitiation === 'legacy_manual' && !unknown;
    // Both the auto-initiated (submitted + processing) and the unknown (submitted + reconciling)
    // paths need TWO events; only legacy_manual needs one. Pre-check the sequence AND timeline budget
    // for BOTH events BEFORE any mutation. If insufficient the request is refused (typed), the known
    // state is untouched, and an existing-key replay above still works — NEVER a best-effort fall
    // back to a bare `requested` record after accepting.
    const eventsNeeded = legacyManual ? 1 : 2;
    if (!this.seqBudget(eventsNeeded) || eventsNeeded > TIMELINE_CAPACITY)
      return reject(
        'capacity_reached',
        'ถึงขีดจำกัดลำดับการเปลี่ยนแปลงของสถานการณ์ตัวอย่างนี้แล้ว (ขีดจำกัดของตัวอย่าง)',
      );
    const status: RequestStatusValue = unknown
      ? 'reconciling'
      : legacyManual
        ? 'requested'
        : 'processing';
    const timeline: WithdrawalTimelineEntryValue[] = [
      { seq: this.nextSeq(), at: this.nowIso(), kind: 'submitted', status: 'requested', detail: null },
    ];
    if (unknown)
      timeline.push({
        seq: this.nextSeq(),
        at: this.nowIso(),
        kind: 'reconciling',
        status: 'reconciling',
        detail: 'ผลการส่งคำขอไม่แน่นอน จึงคงการกันยอดไว้',
      });
    else if (!legacyManual)
      timeline.push({
        seq: this.nextSeq(),
        at: this.nowIso(),
        kind: 'processing',
        status: 'processing',
        detail: 'เริ่มดำเนินการโอนอัตโนมัติ (สภาพแวดล้อมตัวอย่าง)',
      });
    const core = WithdrawalRequest.parse({
      requestRef: this.idGen.next('wr'),
      idempotencyKey: s.idempotencyKey,
      scope: this.scope,
      status,
      gross: issued.gross,
      net: issued.net,
      deductions: issued.deductions,
      reserved: issued.gross,
      beneficiary: issued.beneficiary,
      quoteId: s.quoteId,
      bindings: issuedBindings,
      submittedAt: this.nowIso(),
      allowedActions: actionsFor(status),
    });
    const record: PersistedWithdrawalRecordValue = {
      ...core,
      timeline,
      historyComplete: true,
      sourceContext: this.frozenSourceContext(),
    };
    this.requests.push(record);
    this.issuedQuotes.delete(s.quoteId);
    this.consumedQuotes.add(s.quoteId);
    this.persist();
    this.notify();
    return WithdrawalSubmitResult.parse({ outcome: unknown ? 'unknown' : 'accepted', request: core });
  }

  recover(query: { idempotencyKey?: string; requestRef?: string }): WithdrawalRecoveryValue {
    if (query.idempotencyKey === undefined && query.requestRef === undefined)
      return WithdrawalRecovery.parse({ state: 'missing' });
    const found = this.requests.find(
      (r) =>
        (query.idempotencyKey === undefined || r.idempotencyKey === query.idempotencyKey) &&
        (query.requestRef === undefined || r.requestRef === query.requestRef),
    );
    return WithdrawalRecovery.parse(
      found ? { state: 'found', request: this.coreOf(found) } : { state: 'missing' },
    );
  }

  // ---- durable cancellation ---------------------------------------------------------

  private makeReceipt(
    c: WithdrawalCancelCommandValue,
    outcome: WithdrawalCancellationReceiptValue['outcome'],
    code: WithdrawalCancellationReceiptValue['code'],
    detail: string | null,
    resolved: boolean,
  ): WithdrawalCancellationReceiptValue {
    const now = this.nowIso();
    return {
      scope: this.scope,
      operationKey: c.operationKey,
      requestRef: c.requestRef,
      requestIdempotencyKey: c.requestIdempotencyKey,
      expectedRevision: c.expectedRevision,
      outcome,
      code,
      detail,
      createdAt: now,
      resolvedAt: resolved ? now : null,
    };
  }

  private resultFromReceipt(r: WithdrawalCancellationReceiptValue): WithdrawalCancelResultValue {
    if (r.outcome === 'accepted') {
      const rec = this.requests.find((x) => x.requestRef === r.requestRef);
      return WithdrawalCancelResult.parse({
        outcome: 'cancelled',
        receipt: r,
        request: this.coreOf(rec as PersistedWithdrawalRecordValue),
      });
    }
    if (r.outcome === 'unknown')
      return WithdrawalCancelResult.parse({ outcome: 'unknown', receipt: r });
    if (r.outcome === 'operation_failed')
      return WithdrawalCancelResult.parse({ outcome: 'operation_failed', receipt: r });
    return WithdrawalCancelResult.parse({ outcome: 'rejected', receipt: r });
  }

  // A cancellation is TWO phases so a durable intent exists BEFORE any async outcome (S05):
  //  - beginCancel: synchronous VALIDATION + persistence of an UNRESOLVED (`unknown`) intent
  //    (reserve retained). A hard reload during the transport's round-trip therefore discovers the
  //    operation and recovers by the same key. A validation failure is a typed reject (no persist);
  //    an existing operationKey replays its current (possibly resolved) result.
  //  - resolveCancel: synchronous FINAL outcome per the dev cancel mode.
  // `cancel` runs both (a fully synchronous cancellation for direct callers); the transport runs
  // beginCancel BEFORE its delay and resolveCancel after.
  beginCancel(command: WithdrawalCancelCommandValue): {
    result: WithdrawalCancelResultValue;
    needsResolve: boolean;
  } {
    const c = WithdrawalCancelCommand.parse(command);
    const reject = (code: WithdrawalCancellationReceiptValue['code'], detail: string) => ({
      result: WithdrawalCancelResult.parse({
        outcome: 'rejected',
        receipt: this.makeReceipt(c, 'rejected', code, detail, true),
      }),
      needsResolve: false,
    });

    if (this.restoreUnread)
      return reject('restore_unread', 'ยังอ่านสถานะที่บันทึกไว้ไม่ได้ จึงยังยกเลิกคำขอไม่ได้');
    const scopeReject = this.scopeRejectionFor(c.scope);
    if (scopeReject)
      return reject(scopeReject.code as WithdrawalCancellationReceiptValue['code'], scopeReject.detail);

    // A replay of the SAME operationKey returns the SAME operation; a conflicting payload is
    // rejected. A missing operation is never a licence to mint a new one.
    const existing = this.cancellations.find((r) => r.operationKey === c.operationKey);
    if (existing) {
      const same =
        existing.requestRef === c.requestRef &&
        existing.requestIdempotencyKey === c.requestIdempotencyKey &&
        existing.expectedRevision === c.expectedRevision;
      if (!same)
        return reject('operation_conflict', 'คีย์การยกเลิกเดิมถูกใช้กับข้อมูลที่ต่างออกไป');
      return { result: this.resultFromReceipt(existing), needsResolve: false };
    }

    // Bounds checked BEFORE any mutation (receipt log + sequence budget).
    if (this.cancellations.length >= CANCEL_CAPACITY)
      return reject(
        'capacity_reached',
        'ถึงขีดจำกัดจำนวนรายการยกเลิกของสถานการณ์ตัวอย่างนี้แล้ว (ขีดจำกัดของตัวอย่าง)',
      );
    if (!this.seqBudget(1))
      return reject('capacity_reached', 'ถึงขีดจำกัดลำดับการเปลี่ยนแปลงของสถานการณ์ตัวอย่างนี้แล้ว');

    const rec = this.requests.find((r) => r.requestRef === c.requestRef);
    if (!rec) return reject('not_found', 'ไม่พบคำขอถอนที่อ้างถึง');
    if (rec.idempotencyKey !== c.requestIdempotencyKey)
      return reject('identity_mismatch', 'คีย์คำขอไม่ตรงกับคำขอที่อ้างถึง');
    // Only a `requested` request is cancellable; anything beyond it is too late.
    if (rec.status !== 'requested')
      return reject('not_cancellable', 'คำขอนี้ไม่อยู่ในสถานะที่ยกเลิกได้แล้ว');
    // Optimistic concurrency: a stale view does not mutate anything.
    if (c.expectedRevision !== this.summaryRevision())
      return reject('stale_revision', 'ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดใหม่ก่อนยกเลิก');

    // Persist the UNRESOLVED intent (reserve retained) BEFORE the async outcome.
    const receipt = this.makeReceipt(c, 'unknown', null, null, false);
    this.cancellations.push(receipt);
    this.nextSeq();
    this.persist();
    this.notify();
    return {
      result: WithdrawalCancelResult.parse({ outcome: 'unknown', receipt }),
      needsResolve: true,
    };
  }

  private failCancelReceipt(
    receipt: WithdrawalCancellationReceiptValue,
  ): WithdrawalCancelResultValue {
    // A resolved cancellation-OPERATION failure: the request's reservation is UNCHANGED (distinct
    // from a failed withdrawal); a new operationKey may retry.
    receipt.outcome = 'operation_failed';
    receipt.code = 'not_cancellable';
    receipt.detail = 'คำสั่งยกเลิกไม่สำเร็จ (การยกเลิกนี้ไม่ได้เปลี่ยนสถานะคำขอ)';
    receipt.resolvedAt = this.nowIso();
    if (this.seqBudget(1)) this.nextSeq();
    this.persist();
    this.notify();
    return WithdrawalCancelResult.parse({ outcome: 'operation_failed', receipt });
  }

  resolveCancel(command: WithdrawalCancelCommandValue): WithdrawalCancelResultValue {
    const c = WithdrawalCancelCommand.parse(command);
    const receipt = this.cancellations.find((r) => r.operationKey === c.operationKey);
    // The intent may have been cleared by an explicit reset during the async window: nothing is
    // resurrected — the operation is simply gone.
    if (!receipt)
      return WithdrawalCancelResult.parse({
        outcome: 'rejected',
        receipt: this.makeReceipt(c, 'rejected', 'not_found', 'ไม่พบรายการยกเลิก (สถานะอาจถูกรีเซ็ต)', true),
      });
    if (receipt.outcome !== 'unknown') return this.resultFromReceipt(receipt); // already resolved
    const rec = this.requests.find((r) => r.requestRef === receipt.requestRef);
    const mode = this.controls.cancelMode;

    if (mode === 'unknown')
      // Genuinely uncertain: leave the intent UNRESOLVED (reserve retained); recover by the key.
      return WithdrawalCancelResult.parse({ outcome: 'unknown', receipt });
    if (mode === 'operation_failure') return this.failCancelReceipt(receipt);
    if (mode === 'race') {
      // A concurrent transition moved the request first during the window: the op cannot cancel.
      if (rec && rec.status === 'requested') this.transition(rec, 'processing');
      return this.failCancelReceipt(receipt);
    }

    // success | lost_after_accept: cancel iff still cancellable, releasing the reserve EXACTLY once.
    if (rec && rec.status === 'requested') {
      // Mark THIS intent accepted BEFORE the transition, so the transition's resolveUnknownOps
      // (which fails other still-unknown intents) never touches it.
      receipt.outcome = 'accepted';
      receipt.code = null;
      receipt.resolvedAt = this.nowIso();
      if (this.transition(rec, 'cancelled')) {
        this.persist();
        this.notify();
        return WithdrawalCancelResult.parse({
          outcome: 'cancelled',
          receipt,
          request: this.coreOf(rec),
        });
      }
    }
    // Not cancellable any more (moved during the window) or no seq/timeline budget: the op failed.
    return this.failCancelReceipt(receipt);
  }

  cancel(command: WithdrawalCancelCommandValue): WithdrawalCancelResultValue {
    const { result, needsResolve } = this.beginCancel(command);
    return needsResolve ? this.resolveCancel(command) : result;
  }

  recoverCancellation(query: {
    operationKey?: string;
    requestRef?: string;
  }): WithdrawalCancellationRecoveryValue {
    if (this.readError)
      throw new WithdrawalReadError(
        'recoverCancellation',
        'ไม่สามารถตรวจสอบสถานะการยกเลิกได้ชั่วคราว กรุณาลองใหม่',
      );
    const missing = (): WithdrawalCancellationRecoveryValue =>
      WithdrawalCancellationRecovery.parse({
        state: 'missing',
        scope: this.scope,
        operationKey: query.operationKey ?? null,
        requestRef: query.requestRef ?? null,
      });
    if (query.operationKey === undefined && query.requestRef === undefined) return missing();
    const matches = this.cancellations.filter(
      (r) =>
        (query.operationKey === undefined || r.operationKey === query.operationKey) &&
        (query.requestRef === undefined || r.requestRef === query.requestRef),
    );
    if (matches.length === 0) return missing();
    // The receipt is the durable HISTORICAL record (unchanged); the request is the CURRENT state,
    // so an old operation_failed stays valid even after the request later proceeds/paid/cancelled.
    const receipt = matches[matches.length - 1];
    const rec = this.requests.find((r) => r.requestRef === receipt.requestRef);
    return WithdrawalCancellationRecovery.parse({
      state: 'found',
      receipt,
      request: rec ? this.coreOf(rec) : null,
    });
  }

  // ---- WU03 S1: scoped staff outcome SIMULATION ------------------------------------
  //
  // A COMMAND (not a dev-banner shortcut): it carries the full scope, the request reference and the
  // money (summary) revision, and it wraps the WU02 transition graph/conservation (paid settles
  // gross once; failed/cancelled release once; reconciling retains). `atEpoch` is the reset epoch the
  // TRANSPORT captured at call entry; a mismatch means an explicit reset happened during the delay,
  // so a pre-reset command NEVER mutates post-reset state — even if a fresh request coincidentally
  // re-reaches the same seq/ref namespace (this fence does not rely on request absence or revision).
  applyOutcomeSim(
    command: WithdrawalOutcomeSimCommandValue,
    atEpoch?: number,
  ): WithdrawalOutcomeSimResultValue {
    const c = WithdrawalOutcomeSimCommand.parse(command);
    const reject = (
      code: 'not_found' | 'scope_mismatch' | 'permission_mismatch' | 'payer_mismatch' | 'scenario_mismatch' | 'stale_revision' | 'not_transitionable' | 'restore_unread' | 'capacity_reached',
      detail: string,
    ): WithdrawalOutcomeSimResultValue =>
      WithdrawalOutcomeSimResult.parse({
        outcome: 'rejected',
        scope: c.scope,
        requestRef: c.requestRef,
        code,
        detail,
      });

    if (this.restoreUnread)
      return reject('restore_unread', 'ยังอ่านสถานะที่บันทึกไว้ไม่ได้ จึงยังปรับผลลัพธ์ไม่ได้');
    // Reset-epoch fence BEFORE any check that could match post-reset state.
    if (atEpoch !== undefined && atEpoch !== this.resetEpoch)
      return reject('stale_revision', 'สถานะถูกรีเซ็ตระหว่างดำเนินการ จึงไม่ปรับผลลัพธ์ของคำสั่งเดิม');
    const scopeReject = this.scopeRejectionFor(c.scope);
    if (scopeReject)
      return reject(
        scopeReject.code as 'scope_mismatch' | 'permission_mismatch' | 'payer_mismatch' | 'scenario_mismatch',
        scopeReject.detail,
      );
    const rec = this.requests.find((r) => r.requestRef === c.requestRef);
    if (!rec) return reject('not_found', 'ไม่พบคำขอถอนที่อ้างถึง');
    // Optimistic concurrency against the money revision.
    if (c.expectedRevision !== this.summaryRevision())
      return reject('stale_revision', 'ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดใหม่ก่อนปรับผลลัพธ์');
    if (!REQUEST_TRANSITIONS[rec.status].includes(c.target))
      return reject('not_transitionable', 'สถานะปัจจุบันเปลี่ยนไปยังผลลัพธ์นี้ไม่ได้');
    // Budgets checked BEFORE any mutation (same invariant as the WU02 transition path).
    if (rec.timeline.length >= TIMELINE_CAPACITY || !this.seqBudget(1))
      return reject('capacity_reached', 'ถึงขีดจำกัดลำดับการเปลี่ยนแปลงของสถานการณ์ตัวอย่างนี้แล้ว');
    // Guaranteed legal + within budget by the checks above.
    this.transition(rec, c.target);
    this.persist();
    this.notify();
    return WithdrawalOutcomeSimResult.parse({ outcome: 'applied', request: this.coreOf(rec) });
  }

  // ---- WU03 S2: payout beneficiary save (single atomic write) -----------------------
  //
  // A COMMAND. `atEpoch` is the reset epoch the transport captured at call entry; a mismatch after
  // the latency means an explicit reset happened during the write window, so a late save (even with a
  // coincidentally-matching revision) NEVER writes post-reset state. A same-key replay returns
  // `unknown` (no write) — the UI re-reads the authoritative config and never assumes saved/verified;
  // `saved` STRICTLY means a fresh `pending` mutation.
  setBeneficiary(
    command: SetPayoutBeneficiaryCommandValue,
    atEpoch?: number,
  ): SetPayoutBeneficiaryResultValue {
    const c = SetPayoutBeneficiaryCommand.parse(command);
    const reject = (
      code: 'scope_mismatch' | 'permission_mismatch' | 'payer_mismatch' | 'scenario_mismatch' | 'stale_revision' | 'invalid_name' | 'unknown_bank' | 'unknown_account' | 'restore_unread' | 'capacity_reached' | 'config_unavailable',
      detail: string,
    ): SetPayoutBeneficiaryResultValue =>
      SetPayoutBeneficiaryResult.parse({
        outcome: 'rejected',
        scope: c.scope,
        idempotencyKey: c.idempotencyKey,
        expectedRevision: c.expectedRevision,
        code,
        detail,
      });
    const unknown = (): SetPayoutBeneficiaryResultValue =>
      SetPayoutBeneficiaryResult.parse({
        outcome: 'unknown',
        scope: c.scope,
        idempotencyKey: c.idempotencyKey,
        expectedRevision: c.expectedRevision,
      });

    if (this.restoreUnread)
      return reject('restore_unread', 'ยังกู้คืนสถานะไม่สำเร็จ จึงยังบันทึกบัญชีรับเงินไม่ได้');
    if (atEpoch !== undefined && atEpoch !== this.resetEpoch)
      return reject('stale_revision', 'สถานะถูกรีเซ็ตระหว่างบันทึก จึงไม่บันทึกคำสั่งเดิม');
    const scopeReject = this.scopeRejectionFor(c.scope);
    if (scopeReject)
      return reject(
        scopeReject.code as 'scope_mismatch' | 'permission_mismatch' | 'payer_mismatch' | 'scenario_mismatch',
        scopeReject.detail,
      );
    // BOUNDARY GUARD (B-F02): a present-but-invalid/unreadable/foreign config is authoritatively
    // `unavailable`. Its expectedRevision can COINCIDE with the current one (both derive c0 while the
    // config is unusable), so the stale-revision fence below would not catch a crafted matching-
    // revision save — and a write here would silently OVERWRITE the corrupt/foreign bytes with a
    // fresh record despite the edit being disallowed. Refuse until an authoritative valid/absent
    // config is known (an explicit reset or a recovered read), preserving the persisted bytes.
    if (this.benConfig.kind === 'unavailable')
      return reject(
        'config_unavailable',
        'การตั้งค่าบัญชีรับเงินยังใช้ไม่ได้ กรุณาโหลดใหม่หรือรีเซ็ตก่อนบันทึกทับ',
      );
    // Same committed key -> replay -> unknown (no write), BEFORE the revision/payload checks so an
    // idempotent retry after an uncertain reply never re-writes or spuriously conflicts.
    const committedKey = this.benConfig.kind === 'loaded' ? this.benConfig.config.lastSaveKey : null;
    if (committedKey !== null && committedKey === c.idempotencyKey) return unknown();
    if (c.expectedRevision !== this.configRevision())
      return reject('stale_revision', 'การตั้งค่าเปลี่ยนไปแล้ว กรุณาโหลดใหม่ก่อนบันทึก');
    if (c.displayName.trim().length === 0)
      return reject('invalid_name', 'ชื่อผู้รับเงินต้องไม่เว้นว่าง');
    if (!catalogBank(c.bankId)) return reject('unknown_bank', 'ธนาคารที่เลือกไม่อยู่ในตัวเลือกที่กำหนด');
    if (!catalogAccount(c.accountChoiceId))
      return reject('unknown_account', 'บัญชีที่เลือกไม่อยู่ในตัวเลือกที่กำหนด');
    // Config-version budget checked BEFORE the write.
    const nextVersion = this.configVersionOf() + 1;
    if (nextVersion > CONFIG_VERSION_MAX)
      return reject('capacity_reached', 'ถึงขีดจำกัดจำนวนการแก้ไขบัญชีรับเงินของตัวอย่างนี้แล้ว');

    // SINGLE atomic write committing the choice + new config version + lastSaveKey; state pending.
    const config: PersistedBeneficiaryConfigValue = {
      version: 1,
      scope: this.scope,
      configVersion: nextVersion,
      state: 'pending',
      displayName: c.displayName,
      bankId: c.bankId,
      accountChoiceId: c.accountChoiceId,
      lastSaveKey: c.idempotencyKey,
    };
    const warning = this.beneficiaryStore.save(config);
    if (warning !== null) {
      // The atomic write threw -> its durable outcome is UNKNOWN (it may have committed the new
      // pending record BEFORE throwing, or not committed at all). We must NOT keep trusting the prior
      // in-memory config (that would let a check-current read continue quoting the old verified
      // recipient while a new pending record is actually persisted — B-F01). Recover the AUTHORITATIVE
      // scoped state from storage: a committed pending blocks (pending), a not-committed write leaves
      // the prior/absent config, and a read that also fails leaves the config `unavailable` (blocks).
      // Never a false saved/verified.
      this.persistenceWarning = warning;
      this.loadBenConfig();
      this.notify();
      return unknown();
    }
    this.benConfig = { kind: 'loaded', config };
    this.notify();
    // Committed. In 'unknown' save-mode the response is "lost": return unknown (authoritative reread
    // shows the committed pending; a same-key replay stays unknown) — never a false saved.
    if (this.beneficiarySaveMode === 'unknown') return unknown();
    return SetPayoutBeneficiaryResult.parse({
      outcome: 'saved',
      scope: c.scope,
      idempotencyKey: c.idempotencyKey,
      config: this.beneficiaryConfig(),
    });
  }

  // Isolated DEV strip (never real verification): bumps the config version (invalidating future
  // quotes) via a single atomic write on a LOADED config; keeps lastSaveKey (so a replay of the
  // original save still resolves to `unknown`). A no-op on an absent/unavailable config.
  private setConfigState(state: 'verified' | 'pending' | 'missing'): void {
    if (this.benConfig.kind !== 'loaded') return;
    const cur = this.benConfig.config;
    const nextVersion = cur.configVersion + 1;
    if (nextVersion > CONFIG_VERSION_MAX) return;
    const config: PersistedBeneficiaryConfigValue = { ...cur, state, configVersion: nextVersion };
    const warning = this.beneficiaryStore.save(config);
    if (warning !== null) {
      // Same rule as the save COMMAND: an uncertain DEV-state write must not leave the in-memory view
      // asserting the new state (e.g. `verified`) while the durable record is unknown. Recover the
      // authoritative scoped config (or `unavailable` if that read also fails); never a false verified.
      this.persistenceWarning = warning;
      this.loadBenConfig();
      this.notify();
      return;
    }
    this.benConfig = { kind: 'loaded', config };
    this.notify();
  }
  simulateBeneficiaryVerified(): void {
    this.setConfigState('verified');
  }
  simulateBeneficiaryPending(): void {
    this.setConfigState('pending');
  }
  simulateBeneficiaryMissing(): void {
    this.setConfigState('missing');
  }
  setBeneficiarySaveMode(mode: 'ok' | 'unknown'): void {
    this.beneficiarySaveMode = mode;
    this.notify();
  }

  // Non-persisted submit initiation mode. 'auto' (default) auto-initiates a NEW valid submit to
  // `processing`; 'legacy_manual' keeps a NEW submit at `requested` to seed a legacy cancellable
  // record for coverage. Test/legacy-only; not surfaced in the preview UI.
  setSubmitInitiationMode(mode: 'auto' | 'legacy_manual'): void {
    this.submitInitiation = mode;
    this.notify();
  }

  // ---- preview simulation controls (dev banner only; no provider engine) ------------

  private transitionByRef(requestRef: string, to: RequestStatusValue): void {
    const rec = this.requests.find((r) => r.requestRef === requestRef);
    if (!rec) return;
    if (this.transition(rec, to)) {
      this.persist();
      this.notify();
    }
  }
  markProcessing(requestRef: string): void {
    this.transitionByRef(requestRef, 'processing');
  }
  markPaid(requestRef: string): void {
    this.transitionByRef(requestRef, 'paid');
  }
  markFailed(requestRef: string): void {
    this.transitionByRef(requestRef, 'failed');
  }
  markReconciling(requestRef: string): void {
    this.transitionByRef(requestRef, 'reconciling');
  }
  setCancelMode(mode: CancelSimModeValue): void {
    this.controls = { ...this.controls, cancelMode: mode };
    this.persist();
    this.notify();
  }

  // ---- preview banner controls ------------------------------------------------------

  reset(): void {
    // Explicit dev-only reset. Bump the generation and clear in-flight intents + issued quotes so a
    // delayed command that began before this reset cannot resurrect pre-reset data: its issued quote
    // is gone (submit -> quote_not_found), its cancellation intent is gone (resolve -> not_found), and
    // seq is reset to 0 so every old revision is stale. Warnings/isolation are preserved.
    this.resetEpoch += 1;
    const warning = this.store.reset();
    // Explicitly clear THIS scope's payout config too (unrelated scopes' config keys are retained).
    // A FAILED removal (B-F03) must NOT be ignored: unconditionally assigning `absent` would reopen
    // the legacy verified fixture even though the durable config is still pending. Establish the
    // ACTUAL post-reset scoped config instead — a successful remove is truly `absent`; a failed remove
    // rereads the still-persisted record (or `unavailable` if that read also fails) so a new quote/
    // submit stays blocked while the config is uncertain. The reset epoch fence still advanced above.
    const benWarning = this.beneficiaryStore.reset();
    if (benWarning === null) this.benConfig = { kind: 'absent' };
    else this.loadBenConfig();
    // Re-honour the SAME bootstrap seed on an explicit reset (a fresh namespace again), else defaults.
    this.seedFresh(null);
    // Retain the config-reset warning (it is the actionable one when the scoped removal failed).
    this.persistenceWarning = benWarning ?? warning;
    this.notify();
  }

  selectScenario(name: ScenarioName): void {
    this.resetEpoch += 1;
    this.scenarioName = this.resolveScenarioName(name);
    this.scope = { ...this.scope, scenario: this.scenarioName };
    // Re-resolve: switching back to partner-demo re-applies the bootstrap override; any other scenario
    // uses its fixture. reload() below then seeds/restores under the newly-keyed store.
    this.scenario = this.resolveScenario();
    this.store = this.makeStore();
    // Re-key the payout config store to the newly selected scope (unrelated scopes retained).
    this.beneficiaryStore = this.makeBeneficiaryStore();
    this.benConfig = { kind: 'absent' };
    this.applyDefaults();
    this.stateKnown = false;
    this.restoreUnread = false;
    this.reload(); // reload() restores money + config and publishes the UI snapshot
  }

  setReadError(on: boolean): void {
    this.readError = on;
    this.notify();
  }

  forceStaleQuote(): void {
    if (!this.seqBudget(1)) return; // budget exhausted: leave known state untouched
    this.nextSeq();
    this.controls = { ...this.controls, staleQuote: true };
    this.persist();
    this.notify();
  }

  changeBeneficiary(): void {
    // Guard BOTH bounded counters BEFORE any mutation: the persisted beneficiary-version bump bound
    // AND the sequence budget. At the bound this is a no-op that leaves the known state/revision/
    // bytes unchanged (never a warning-only partial change).
    if (this.beneficiaryBump >= BUMP_MAX) return;
    if (!this.seqBudget(1)) return;
    this.beneficiaryBump += 1;
    this.nextSeq();
    this.controls = { ...this.controls, changedBeneficiary: true };
    this.persist();
    this.notify();
  }

  setUnknownOutcome(on: boolean): void {
    // A control toggle affecting the NEXT submit only: no seq bump (never stales an outstanding
    // quote), but it does notify the UI.
    this.controls = { ...this.controls, unknownOutcome: on };
    this.persist();
    this.notify();
  }

  releaseNextPeriod(): string | null {
    const next = this.scenario.releasable.find((p) => !this.releasedPeriods.has(p.periodId));
    if (!next) return null;
    if (!this.seqBudget(1)) return null; // budget exhausted before mutation
    this.releasedPeriods.add(next.periodId);
    this.releaseLog.push({ periodId: next.periodId, at: this.nowIso() });
    this.nextSeq();
    this.persist();
    this.notify();
    return next.periodId;
  }

  view(): {
    scenario: ScenarioName;
    scenarios: ScenarioName[];
    controls: PersistedControlsV2Value;
    persistenceWarning: string | null;
    readError: boolean;
    releasedPeriods: string[];
    remainingReleasable: string[];
    scope: WithdrawalScopeValue;
  } {
    return {
      scenario: this.scenarioName,
      scenarios: SCENARIO_NAMES,
      controls: this.controls,
      persistenceWarning: this.persistenceWarning,
      readError: this.readError,
      releasedPeriods: [...this.releasedPeriods],
      remainingReleasable: this.scenario.releasable
        .filter((p) => !this.releasedPeriods.has(p.periodId))
        .map((p) => p.periodId),
      scope: this.scope,
    };
  }

  currentScope(): WithdrawalScopeValue {
    return this.scope;
  }
}

export function createWithdrawalController(options: ControllerOptions): WithdrawalController {
  return new WithdrawalController(options);
}
