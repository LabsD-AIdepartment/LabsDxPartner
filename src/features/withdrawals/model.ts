import { z } from 'zod';
import { Minor } from '@/contracts/common';
import type { BalanceScopeValue } from '@/contracts/withdrawal';
import {
  EVENT_KIND_STATUS,
  REQUEST_TRANSITIONS,
  WithdrawalCancellationRecovery,
  type WithdrawalCancellationRecoveryValue,
  type WithdrawalCancellationReceiptValue,
  WithdrawalCancelCommand,
  type WithdrawalCancelCommandValue,
  WithdrawalCancelResult,
  type WithdrawalCancelResultValue,
  WithdrawalDetailResult,
  type WithdrawalDetailResultValue,
  type WithdrawalRequestDetailValue,
  WithdrawalGatewayStatus,
  type WithdrawalGatewayStatusValue,
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
  type WithdrawalRequestValue,
  WithdrawalScope,
  type WithdrawalScopeValue,
  WithdrawalSubmission,
  type WithdrawalSubmissionValue,
  WithdrawalSubmitResult,
  type WithdrawalSubmitResultValue,
  WithdrawalSummary,
  type WithdrawalSummaryValue,
} from '@/contracts/withdrawal-journey';

// Re-export the transport read-outage error so the UI can `instanceof`-check it from the model
// without reaching into the contract layer for one symbol.
export { WithdrawalReadError };

// WU01 SYSTEM — feature-side withdrawal model.
//
// This module holds ONLY: the injected transport interface, scope/query-key helpers, an
// exact-decimal amount parser and typed transport/validation errors. It has NO JSX, NO React
// and — critically — NEVER imports `@/server/modules/*`. All display figures arrive already
// computed from the transport; this layer validates them against the shared contracts and
// enforces scope/quote consistency. It never performs balance or tax arithmetic.

// ---- Transport ----------------------------------------------------------------------
//
// A small injected seam (HTTP implementation lands later). Every method returns `unknown`;
// the loader functions below parse the payload through the shared contracts before it can
// reach the UI, so a malformed or cross-scope response can never be rendered.
export interface WithdrawalTransport {
  summary(input: { scope: WithdrawalScopeValue; signal: AbortSignal }): Promise<unknown>;
  quote(input: {
    scope: WithdrawalScopeValue;
    grossMinor: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  submit(input: {
    submission: WithdrawalSubmissionValue;
    signal: AbortSignal;
  }): Promise<unknown>;
  recover(input: {
    scope: WithdrawalScopeValue;
    idempotencyKey?: string;
    requestRef?: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}

// WU02 SUPERSET transport. It EXTENDS the WU01 four-method seam so existing WU01 callers/mocks
// keep working without dummy methods, and adds the history read projections plus the durable
// cancellation command/recovery. The HTTP implementation lands later; every method returns
// `unknown` and is parsed through the shared contracts by the loaders below before it can render.
export interface WithdrawalHistoryTransport extends WithdrawalTransport {
  // All requests in scope (full immutable records, newest submitted first, <= 200).
  list(input: { scope: WithdrawalScopeValue; signal: AbortSignal }): Promise<unknown>;
  // One request's detail: immutable core + timeline + frozen source context + pending docs.
  detail(input: {
    scope: WithdrawalScopeValue;
    requestRef: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  // A durable cancellation command (a COMMAND, like submit: a scope disagreement is a typed
  // `rejected`, never a throw). Carries its own operationKey distinct from the request key.
  cancel(input: {
    command: WithdrawalCancelCommandValue;
    signal: AbortSignal;
  }): Promise<unknown>;
  // Recover a cancellation operation by the SAME operationKey/ref (never invents a new key).
  recoverCancellation(input: {
    scope: WithdrawalScopeValue;
    operationKey?: string;
    requestRef?: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}

// WU03 S1 SUPERSET transport. Adds ONLY the staff/period read and the outcome-simulation command
// (beneficiary-config methods are a SEPARATE, still-unapproved slice and are intentionally absent).
// Existing WU01/WU02 mocks/callers remain valid — the WU02 loaders still take
// `WithdrawalHistoryTransport`.
export interface WithdrawalStaffTransport extends WithdrawalHistoryTransport {
  // Release-pool / current-period preview (a read; scope-gated). Read outage -> WithdrawalReadError('periods').
  periods(input: { scope: WithdrawalScopeValue; signal: AbortSignal }): Promise<unknown>;
  // A staff outcome SIMULATION (a COMMAND, like submit/cancel: a scope/stale disagreement is a typed
  // `rejected`, never a throw). Bound to scope + requestRef + the money revision.
  outcome(input: {
    command: WithdrawalOutcomeSimCommandValue;
    signal: AbortSignal;
  }): Promise<unknown>;
}

// WU03 S2 SUPERSET transport. Adds ONLY the payout-config read + save on top of the staff transport,
// so the accepted S1 staff/period tests and existing WU01/WU02 mock callers stay compatible.
export interface WithdrawalBeneficiaryTransport extends WithdrawalStaffTransport {
  // The payout config read (scope-gated). It returns an honest `unavailable` arm for a present-but-
  // invalid config rather than throwing — so it never surfaces as a WithdrawalReadError.
  beneficiaryConfig(input: { scope: WithdrawalScopeValue; signal: AbortSignal }): Promise<unknown>;
  // A COMMAND (typed reject, never a throw for scope/stale). A same-key replay is `unknown`.
  setBeneficiary(input: {
    command: SetPayoutBeneficiaryCommandValue;
    signal: AbortSignal;
  }): Promise<unknown>;
}

// ---- Typed errors -------------------------------------------------------------------

// A response that failed contract validation OR arrived under a different scope/identity than
// the one requested. All are unrenderable: the caller must discard the response (and, for a
// scope mismatch, it belongs to a superseded request that must not appear under the new scope).
export class WithdrawalResponseError extends Error {
  constructor(
    // `identity_mismatch`: the response is well-formed and in-scope but its immutable identity
    // (echoed command fields, a nested revision/beneficiary binding, or a recovered/handled
    // request) does not match what was asked — e.g. a submit result carrying a foreign
    // idempotency key/quote/amount, or a recovery whose record does not match a supplied
    // handle. Such a response is never rendered.
    readonly reason: 'invalid' | 'scope_mismatch' | 'quote_mismatch' | 'identity_mismatch',
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WithdrawalResponseError';
  }
}

// ---- Scope / query-key helpers -------------------------------------------------------

// Derive the W01-A BalanceScope (partner + payer + currency) from the richer withdrawal
// scope. The synthetic scenario namespace and the user/permission identity are intentionally
// dropped: a balance is keyed only by partner/payer/currency.
export function balanceScopeOf(scope: WithdrawalScopeValue): BalanceScopeValue {
  return { partnerId: scope.partnerId, payerId: scope.payerId, currency: scope.currency };
}

// Stable scope prefix for the feature query-key factory. Carries user/partner/permission
// (matching the shared partner-key convention) PLUS payer/currency/scenario — and NO earnings
// date or brand filter, so a withdrawable balance is never keyed by an earnings window.
export function withdrawalScopeKey(scope: WithdrawalScopeValue) {
  return [
    'withdrawal',
    scope.userId,
    scope.partnerId,
    scope.permissionRevision,
    scope.payerId,
    scope.currency,
    scope.scenario,
  ] as const;
}

// Feature-local key factory. `revision` (from the summary) is appended so a mutation that
// changes the summary revision invalidates dependent reads without a manual refresh.
export const withdrawalKeys = {
  summary: (scope: WithdrawalScopeValue, revision: string | null = null) =>
    [...withdrawalScopeKey(scope), 'summary', revision] as const,
  quote: (scope: WithdrawalScopeValue, grossMinor: string, revision: string | null = null) =>
    [...withdrawalScopeKey(scope), 'quote', grossMinor, revision] as const,
  request: (scope: WithdrawalScopeValue, idempotencyKey: string) =>
    [...withdrawalScopeKey(scope), 'request', idempotencyKey] as const,
  // WU02: history list + per-request detail. `revision` (the summary/list/detail revision) is
  // appended so an accepted transition / cancellation / release invalidates them and every
  // visible projection refetches without a manual refresh.
  list: (scope: WithdrawalScopeValue, revision: string | null = null) =>
    [...withdrawalScopeKey(scope), 'list', revision] as const,
  detail: (scope: WithdrawalScopeValue, requestRef: string, revision: string | null = null) =>
    [...withdrawalScopeKey(scope), 'detail', requestRef, revision] as const,
  // WU03 S1: release-pool / period preview. `revision` (the summary/money revision) invalidates it
  // after a release/outcome so the staff/period view refetches without a manual refresh.
  periods: (scope: WithdrawalScopeValue, revision: string | null = null) =>
    [...withdrawalScopeKey(scope), 'periods', revision] as const,
  // WU03 S2: payout config read. `revision` is the config's OWN revision (unaffected by money), so a
  // save invalidates the editor read without a withdrawal spuriously refetching it.
  beneficiary: (scope: WithdrawalScopeValue, revision: string | null = null) =>
    [...withdrawalScopeKey(scope), 'beneficiary', revision] as const,
};

function scopeEqual(a: WithdrawalScopeValue, b: WithdrawalScopeValue): boolean {
  return (
    a.userId === b.userId &&
    a.partnerId === b.partnerId &&
    a.permissionRevision === b.permissionRevision &&
    a.payerId === b.payerId &&
    a.currency === b.currency &&
    a.scenario === b.scenario
  );
}

// Balance scopes are keyed by partner/payer/currency only; used to bind the summary's NESTED
// balance/readiness context back to the requested envelope without duplicating any arithmetic.
function balanceScopeEqual(a: BalanceScopeValue, b: BalanceScopeValue): boolean {
  return a.partnerId === b.partnerId && a.payerId === b.payerId && a.currency === b.currency;
}

// ---- Exact-decimal THB amount parser -------------------------------------------------

// THB minor unit is satang (2 fraction digits). Parsing uses BigInt string arithmetic only —
// never Number/parseFloat — so 0.01 and very large amounts stay exact.
//
// Grouping is NOT blindly stripped (that silently turned "1,5" into 15 THB): the integer part
// must be EITHER ungrouped digits OR well-formed thousands groups (a 1–3 digit lead group then
// runs of exactly three digits separated by a comma or a regular/thin/narrow space). "1,5",
// "1 2" and "12,3456" are format errors, not reinterpreted amounts. The result is validated
// against the shared canonical `Minor` (≤ 40 digits) BEFORE `ok`, so a value that would exceed
// the Money contract returns a typed `too_large` error instead of a later uncaught Zod throw.
export type AmountParseError =
  | 'empty'
  | 'format'
  | 'too_many_decimals'
  | 'not_positive'
  | 'too_large';
export type AmountParse =
  | { ok: true; minor: string }
  | { ok: false; error: AmountParseError };

// A grouping separator between three-digit runs: comma, ASCII space, no-break (U+00A0) and
// narrow no-break (U+202F) spaces.
const SEP = '[,\\u0020\\u00A0\\u202F]';
const UNGROUPED = /^\d+$/;
const GROUPED = new RegExp(`^\\d{1,3}(?:${SEP}\\d{3})+$`);
const SEP_GLOBAL = new RegExp(SEP, 'g');

export function parseThbAmountToMinor(raw: string): AmountParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: 'empty' };
  // Bound the raw length BEFORE any BigInt work so a pathological input can never trigger a
  // huge-BigInt computation. A 40-digit satang value needs at most ~41 significant chars.
  if (trimmed.length > 45) return { ok: false, error: 'too_large' };

  const parts = trimmed.split('.');
  if (parts.length > 2) return { ok: false, error: 'format' };
  const [wholeRaw, fractionRaw = ''] = parts;

  if (!UNGROUPED.test(wholeRaw) && !GROUPED.test(wholeRaw)) return { ok: false, error: 'format' };
  const whole = wholeRaw.replace(SEP_GLOBAL, '');
  // The fraction is never grouped and is at most two satang digits.
  if (fractionRaw.length > 0 && !/^\d+$/.test(fractionRaw)) return { ok: false, error: 'format' };
  if (fractionRaw.length > 2) return { ok: false, error: 'too_many_decimals' };

  // whole * 100 + fraction(padded to 2). BigInt keeps this exact for arbitrarily large input.
  const minor = BigInt(whole) * 100n + BigInt(fractionRaw.padEnd(2, '0') || '0');
  if (minor <= 0n) return { ok: false, error: 'not_positive' };
  const minorStr = minor.toString();
  // Shared canonical/bounded validation: reject anything the Money `Minor` contract would.
  if (!Minor.safeParse(minorStr).success) return { ok: false, error: 'too_large' };
  return { ok: true, minor: minorStr };
}

// Format a satang string back to a THB decimal string (display helper; exact, no float).
export function formatThbMinor(minor: string): string {
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  return `${negative ? '-' : ''}${BigInt(whole).toString()}.${fraction}`;
}

// ---- Loaders (parse + scope/quote consistency) ---------------------------------------

function afterAwait(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

// A transport may itself REFUSE the requested scope before answering (a declared-scope gate on
// the synthetic dev adapter today; a 403/scope error on the eventual HTTP transport). Such a
// refusal is surfaced to the UI as a `scope_mismatch` response error — identical to a response
// whose envelope scope disagrees — so the caller never distinguishes "the transport refused
// this scope" from "the answer was for another scope". Detected structurally (by name) so this
// module never imports the dev adapter, keeping the feature import closure server/adapter-free.
function isScopeRefusal(error: unknown): boolean {
  return error instanceof Error && error.name === 'WithdrawalScopeError';
}
async function readThroughTransport<T>(
  operation:
    | 'summary'
    | 'quote'
    | 'recovery'
    | 'list'
    | 'detail'
    | 'recoverCancellation'
    | 'periods'
    | 'beneficiaryConfig',
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isScopeRefusal(error))
      throw new WithdrawalResponseError(
        'scope_mismatch',
        `Transport refused the requested scope for ${operation}`,
        error,
      );
    throw error;
  }
}

function parseOrThrow<T extends z.ZodType>(schema: T, raw: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new WithdrawalResponseError('invalid', `Invalid ${what} response`, parsed.error);
  return parsed.data;
}

// A projected request must be financially coherent before the UI can render it: net + Σ
// deductions must reconcile EXACTLY to gross (satang BigInt, never float), and an ACTIVE
// request's reservation must equal the gross it holds (a WU01 record is never a settled/partial
// projection). This guards the submit/recovery boundary against an incoherent record even when
// the shape parses (F03).
function assertRequestCoherent(request: WithdrawalRequestValue, what: string): void {
  const deducted = request.deductions.reduce((total, d) => total + BigInt(d.amount.minor), 0n);
  if (BigInt(request.net.minor) + deducted !== BigInt(request.gross.minor))
    throw new WithdrawalResponseError(
      'invalid',
      `${what} request net + deductions do not reconcile to gross`,
    );
  // Reservation is the CURRENT hold and is a pure function of status. An ACTIVE request holds its
  // full gross; a TERMINAL request (paid settles it, cancelled/failed release it) holds nothing.
  // A record disagreeing with this rule is incoherent and never rendered — the guard that makes a
  // replayed/late/lost outcome unable to fabricate a phantom reserve or a second release.
  const active =
    request.status === 'requested' ||
    request.status === 'processing' ||
    request.status === 'reconciling';
  if (active && request.reserved.minor !== request.gross.minor)
    throw new WithdrawalResponseError(
      'invalid',
      `${what} active request reservation does not equal its gross`,
    );
  if (!active && request.reserved.minor !== '0')
    throw new WithdrawalResponseError(
      'invalid',
      `${what} terminal request must hold no reservation`,
    );
}

export async function loadWithdrawalSummary(
  transport: WithdrawalTransport,
  input: { scope: WithdrawalScopeValue; signal: AbortSignal },
): Promise<WithdrawalSummaryValue> {
  const requested = WithdrawalScope.parse(input.scope);
  const raw = await readThroughTransport('summary', () => transport.summary(input));
  afterAwait(input.signal);
  const summary = parseOrThrow(WithdrawalSummary, raw, 'summary');
  if (!scopeEqual(summary.scope, requested))
    throw new WithdrawalResponseError('scope_mismatch', 'Summary scope does not match request');

  // Bind the NESTED balance/readiness context to the requested envelope so a foreign
  // partner/payer balance can never ride inside an in-scope summary envelope. No arithmetic is
  // duplicated here — only identity/scope is checked.
  const bScope = balanceScopeOf(requested);
  if (!balanceScopeEqual(summary.balance.scope, bScope))
    throw new WithdrawalResponseError('scope_mismatch', 'Summary balance is out of scope');
  if (!balanceScopeEqual(summary.readiness.context.scope, bScope))
    throw new WithdrawalResponseError('scope_mismatch', 'Summary readiness context is out of scope');
  // The readiness must be bound to THIS balance snapshot's current revision (when known) and to
  // THIS beneficiary version (when one is presented), so a stale/foreign readiness cannot claim
  // freshness for a different snapshot/recipient. NULL is an HONEST unresolved/blocked state
  // (W01-B makes expectedBalanceRevision / expectedVersions.beneficiary nullable): a null
  // expected value is accepted as a legitimate blocked/unknown config; only a NON-NULL value
  // that disagrees is a substituted-freshness mismatch and is rejected.
  const expectedRevision = summary.readiness.context.expectedBalanceRevision;
  if (
    summary.balance.state === 'known' &&
    expectedRevision !== null &&
    expectedRevision !== summary.balance.revision
  )
    throw new WithdrawalResponseError(
      'identity_mismatch',
      'Summary readiness is not bound to the current balance revision',
    );
  const beneficiaryVersion =
    summary.beneficiary.state === 'known' || summary.beneficiary.state === 'pending'
      ? summary.beneficiary.version
      : null;
  const expectedBeneficiary = summary.readiness.context.expectedVersions.beneficiary;
  if (
    beneficiaryVersion !== null &&
    expectedBeneficiary !== null &&
    expectedBeneficiary !== beneficiaryVersion
  )
    throw new WithdrawalResponseError(
      'identity_mismatch',
      'Summary readiness is not bound to the presented beneficiary version',
    );
  return summary;
}

export async function loadWithdrawalQuote(
  transport: WithdrawalTransport,
  input: { scope: WithdrawalScopeValue; grossMinor: string; signal: AbortSignal },
): Promise<WithdrawalQuoteValue> {
  const requested = WithdrawalScope.parse(input.scope);
  const raw = await readThroughTransport('quote', () => transport.quote(input));
  afterAwait(input.signal);
  const quote = parseOrThrow(WithdrawalQuote, raw, 'quote');
  if (!scopeEqual(quote.scope, requested))
    throw new WithdrawalResponseError('scope_mismatch', 'Quote scope does not match request');
  // A quote for a different gross must never appear under the requested amount.
  if (quote.gross.minor !== input.grossMinor)
    throw new WithdrawalResponseError('quote_mismatch', 'Quote gross does not match request');
  // The immutable masked snapshot must be the exact one the bindings pin — a quote whose shown
  // recipient disagrees with its own beneficiary version is never confirmable.
  if (quote.state === 'quoted' && quote.beneficiary.version !== quote.bindings.beneficiaryVersion)
    throw new WithdrawalResponseError(
      'identity_mismatch',
      'Quote beneficiary snapshot does not match its bindings',
    );
  return quote;
}

export async function submitWithdrawal(
  transport: WithdrawalTransport,
  input: { submission: WithdrawalSubmissionValue; signal: AbortSignal },
): Promise<WithdrawalSubmitResultValue> {
  const submission = WithdrawalSubmission.parse(input.submission);
  const raw = await transport.submit({ submission, signal: input.signal });
  afterAwait(input.signal);
  const result = parseOrThrow(WithdrawalSubmitResult, raw, 'submit');
  if (result.outcome !== 'rejected') {
    const r = result.request;
    if (!scopeEqual(r.scope, submission.scope))
      throw new WithdrawalResponseError('scope_mismatch', 'Submit scope does not match request');
    // The accepted/unknown record MUST echo the immutable command identity. A same-scope
    // response carrying a different idempotency key / quote / amount / bindings is a
    // substituted record and is rejected rather than shown as this command's outcome.
    if (
      r.idempotencyKey !== submission.idempotencyKey ||
      r.quoteId !== submission.quoteId ||
      r.gross.minor !== submission.gross.minor ||
      r.net.minor !== submission.net.minor ||
      r.bindings.balanceRevision !== submission.bindings.balanceRevision ||
      r.bindings.policyRevision !== submission.bindings.policyRevision ||
      r.bindings.beneficiaryVersion !== submission.bindings.beneficiaryVersion
    )
      throw new WithdrawalResponseError(
        'identity_mismatch',
        'Submit result does not echo the submitted command identity',
      );
    assertRequestCoherent(r, 'Submit');
  }
  return result;
}

export async function recoverWithdrawal(
  transport: WithdrawalTransport,
  input: {
    scope: WithdrawalScopeValue;
    idempotencyKey?: string;
    requestRef?: string;
    signal: AbortSignal;
  },
): Promise<WithdrawalRecoveryValue> {
  const requested = WithdrawalScope.parse(input.scope);
  // Recovery must be anchored to at least one concrete handle; a handle-less recovery could
  // otherwise return an arbitrary in-scope record.
  if (input.idempotencyKey === undefined && input.requestRef === undefined)
    throw new WithdrawalResponseError(
      'invalid',
      'Recovery requires an idempotency key or a request reference',
    );
  const raw = await readThroughTransport('recovery', () => transport.recover(input));
  afterAwait(input.signal);
  const recovery = parseOrThrow(WithdrawalRecovery, raw, 'recovery');
  if (recovery.state === 'found') {
    if (!scopeEqual(recovery.request.scope, requested))
      throw new WithdrawalResponseError('scope_mismatch', 'Recovered request is out of scope');
    // EVERY supplied handle must match the recovered record — a record for a different key or
    // reference is never accepted as the answer to this query.
    if (input.idempotencyKey !== undefined && recovery.request.idempotencyKey !== input.idempotencyKey)
      throw new WithdrawalResponseError(
        'identity_mismatch',
        'Recovered request does not match the requested idempotency key',
      );
    if (input.requestRef !== undefined && recovery.request.requestRef !== input.requestRef)
      throw new WithdrawalResponseError(
        'identity_mismatch',
        'Recovered request does not match the requested reference',
      );
    assertRequestCoherent(recovery.request, 'Recovered');
  }
  return recovery;
}

// ---- WU02 history / detail / durable cancellation loaders -----------------------------
//
// Each loader parses `unknown` through the shared contract, then re-checks IDENTITY/SCOPE on the
// nested records so a well-formed but foreign/substituted envelope can never render. None of them
// performs money arithmetic; `assertRequestCoherent` (reused) enforces net+Σdeductions==gross and
// the status/reserved rule on every nested request.

// A timeline must be LEGAL before a detail can render. `seq` (never the clock) is the ordering
// authority and must be STRICTLY increasing (unique). Each non-`legacy_snapshot` event's kind
// determines its status exactly (EVENT_KIND_STATUS); consecutive statuses must follow the legal
// transition graph (REQUEST_TRANSITIONS), so a terminal status can never move back to an active
// one. The tail status must equal the record's current status.
//
// Completeness is explicit and honest:
//  - historyComplete === true : the head is a real `submitted` event (status requested) and there
//    is NO `legacy_snapshot` anywhere — the full recorded history.
//  - historyComplete === false: the head is a `legacy_snapshot` at the original submittedAt whose
//    status is the legacy record's own status (no invented submitted-at-current-status event), and
//    there is NO `submitted` event. Real events MAY follow (a v2 session can append transitions).
function assertTimelineCoherent(
  timeline: WithdrawalRequestDetailValue['timeline'],
  request: WithdrawalRequestValue,
  historyComplete: boolean,
  what: string,
): void {
  if (timeline.length === 0)
    throw new WithdrawalResponseError('invalid', `${what} timeline is empty`);
  const head = timeline[0];
  if (historyComplete) {
    if (head.kind !== 'submitted')
      throw new WithdrawalResponseError('invalid', `${what} complete history must begin with submission`);
    if (timeline.some((e) => e.kind === 'legacy_snapshot'))
      throw new WithdrawalResponseError('invalid', `${what} complete history cannot carry a legacy snapshot`);
  } else {
    if (head.kind !== 'legacy_snapshot')
      throw new WithdrawalResponseError('invalid', `${what} incomplete history must begin with a legacy snapshot`);
    if (head.at !== request.submittedAt)
      throw new WithdrawalResponseError('invalid', `${what} legacy snapshot is not anchored to the original submittedAt`);
    if (timeline.some((e) => e.kind === 'submitted'))
      throw new WithdrawalResponseError('invalid', `${what} incomplete history cannot carry a submitted event`);
    if (timeline.filter((e) => e.kind === 'legacy_snapshot').length !== 1)
      throw new WithdrawalResponseError('invalid', `${what} incomplete history must carry exactly one legacy snapshot`);
  }
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];
    // Each non-snapshot event's kind must match its status exactly.
    if (entry.kind !== 'legacy_snapshot' && EVENT_KIND_STATUS[entry.kind] !== entry.status)
      throw new WithdrawalResponseError('invalid', `${what} timeline event kind does not match its status`);
    if (i > 0) {
      const prev = timeline[i - 1];
      if (entry.seq <= prev.seq)
        throw new WithdrawalResponseError('invalid', `${what} timeline sequence is not strictly increasing`);
      // A snapshot only ever leads; it is never a transition TARGET.
      if (entry.kind === 'legacy_snapshot')
        throw new WithdrawalResponseError('invalid', `${what} legacy snapshot may only lead the timeline`);
      if (!REQUEST_TRANSITIONS[prev.status].includes(entry.status))
        throw new WithdrawalResponseError('invalid', `${what} timeline has an illegal status transition`);
    }
  }
  if (timeline[timeline.length - 1].status !== request.status)
    throw new WithdrawalResponseError(
      'invalid',
      `${what} timeline tail does not match the request status`,
    );
}

// A cancellation receipt must be provable in the FULL six-field scope and echo the command/target
// identity. `commandExpectedRevision` is checked only when the caller knows it (a cancel command);
// recovery does not re-assert it.
function assertReceiptScopeIdentity(
  receipt: WithdrawalCancellationReceiptValue,
  scope: WithdrawalScopeValue,
  binding: { requestRef?: string; operationKey?: string; requestIdempotencyKey?: string; expectedRevision?: string },
  what: string,
): void {
  if (!scopeEqual(receipt.scope, scope))
    throw new WithdrawalResponseError('scope_mismatch', `${what} receipt is out of scope`);
  if (binding.operationKey !== undefined && receipt.operationKey !== binding.operationKey)
    throw new WithdrawalResponseError('identity_mismatch', `${what} receipt operation key does not match`);
  if (binding.requestRef !== undefined && receipt.requestRef !== binding.requestRef)
    throw new WithdrawalResponseError('identity_mismatch', `${what} receipt request reference does not match`);
  if (binding.requestIdempotencyKey !== undefined && receipt.requestIdempotencyKey !== binding.requestIdempotencyKey)
    throw new WithdrawalResponseError('identity_mismatch', `${what} receipt request key does not match`);
  if (binding.expectedRevision !== undefined && receipt.expectedRevision !== binding.expectedRevision)
    throw new WithdrawalResponseError('identity_mismatch', `${what} receipt expected revision does not match`);
}

// outcome <-> code/resolvedAt coherence. An `unknown` receipt is genuinely unresolved; the others
// are resolved and carry a code where a reason exists.
function assertReceiptOutcomeCoherent(receipt: WithdrawalCancellationReceiptValue, what: string): void {
  const { outcome, code, resolvedAt } = receipt;
  const fail = (why: string) => {
    throw new WithdrawalResponseError('invalid', `${what} receipt ${why}`);
  };
  if (outcome === 'accepted' && (code !== null || resolvedAt === null))
    fail('accepted must have no code and a resolved time');
  if (outcome === 'unknown' && (code !== null || resolvedAt !== null))
    fail('unknown must be unresolved with no code');
  if (outcome === 'operation_failed' && (code === null || resolvedAt === null))
    fail('operation_failed must carry a code and a resolved time');
  if (outcome === 'rejected' && (code === null || resolvedAt === null))
    fail('rejected must carry a code and a resolved time');
}

// A receipt outcome must be consistent with the CURRENT request record, distinguishing a receipt
// that changed the reservation from a historical one that did not (S04):
//  - accepted        : this cancel RELEASED the reserve, so the current request must be `cancelled`
//                      with reserved 0 — never an "accepted" claim over money still reserved.
//  - unknown         : the cancel is still UNRESOLVED, so the reserve is conservatively retained;
//                      the current request must still be ACTIVE (a terminal request would mean the
//                      outcome is in fact known).
//  - operation_failed / rejected : these are RESOLVED failures of the cancellation OPERATION that
//                      did NOT change the reservation. They are HISTORICAL: the request may since
//                      have proceeded to paid/failed or been cancelled by a later new operation.
//                      Recovering such a receipt keeps its failed record while showing whatever the
//                      current request status is — no state constraint beyond identity/coherence.
function assertReceiptRequestCoherent(
  receipt: WithdrawalCancellationReceiptValue,
  request: WithdrawalRequestValue,
  what: string,
): void {
  if (request.requestRef !== receipt.requestRef || request.idempotencyKey !== receipt.requestIdempotencyKey)
    throw new WithdrawalResponseError('identity_mismatch', `${what} receipt does not identify this request`);
  const active =
    request.status === 'requested' || request.status === 'processing' || request.status === 'reconciling';
  if (receipt.outcome === 'accepted' && !(request.status === 'cancelled' && request.reserved.minor === '0'))
    throw new WithdrawalResponseError('invalid', `${what} accepted cancel does not match a released request`);
  if (receipt.outcome === 'unknown' && !active)
    throw new WithdrawalResponseError('invalid', `${what} unresolved cancel is inconsistent with a terminal request`);
}

export async function loadWithdrawalList(
  transport: WithdrawalHistoryTransport,
  input: { scope: WithdrawalScopeValue; signal: AbortSignal },
): Promise<WithdrawalListValue> {
  const requested = WithdrawalScope.parse(input.scope);
  const raw = await readThroughTransport('list', () => transport.list(input));
  afterAwait(input.signal);
  const list = parseOrThrow(WithdrawalList, raw, 'list');
  if (!scopeEqual(list.scope, requested))
    throw new WithdrawalResponseError('scope_mismatch', 'List scope does not match request');
  const refs = new Set<string>();
  const keys = new Set<string>();
  for (const row of list.items) {
    // Every ROW must be in-scope: a foreign request can never ride inside an in-scope list.
    if (!scopeEqual(row.scope, requested))
      throw new WithdrawalResponseError('scope_mismatch', 'List contains an out-of-scope request');
    if (refs.has(row.requestRef) || keys.has(row.idempotencyKey))
      throw new WithdrawalResponseError('invalid', 'List contains a duplicate request');
    refs.add(row.requestRef);
    keys.add(row.idempotencyKey);
    assertRequestCoherent(row, 'List');
  }
  return list;
}

export async function loadWithdrawalDetail(
  transport: WithdrawalHistoryTransport,
  input: { scope: WithdrawalScopeValue; requestRef: string; signal: AbortSignal },
): Promise<WithdrawalDetailResultValue> {
  const requested = WithdrawalScope.parse(input.scope);
  const raw = await readThroughTransport('detail', () =>
    transport.detail({ scope: input.scope, requestRef: input.requestRef, signal: input.signal }),
  );
  afterAwait(input.signal);
  const result = parseOrThrow(WithdrawalDetailResult, raw, 'detail');
  if (result.state === 'missing') {
    // Even a not-found answer must be bound to THIS exact scope + reference.
    if (!scopeEqual(result.scope, requested))
      throw new WithdrawalResponseError('scope_mismatch', 'Detail miss is out of scope');
    if (result.requestRef !== input.requestRef)
      throw new WithdrawalResponseError('identity_mismatch', 'Detail miss does not echo the requested reference');
    return result;
  }
  const { request, timeline, historyComplete, pendingCancellations, documents } = result.detail;
  if (!scopeEqual(request.scope, requested))
    throw new WithdrawalResponseError('scope_mismatch', 'Detail request is out of scope');
  if (request.requestRef !== input.requestRef)
    throw new WithdrawalResponseError(
      'identity_mismatch',
      'Detail does not match the requested reference',
    );
  assertRequestCoherent(request, 'Detail');
  assertTimelineCoherent(timeline, request, historyComplete, 'Detail');
  // Every pending (UNRESOLVED) cancellation must be genuinely unresolved (outcome `unknown`), be
  // provable in this scope, echo the target identity AND be consistent with an active/reserved
  // request — a pending cancel over a terminal request is incoherent.
  for (const receipt of pendingCancellations) {
    if (receipt.outcome !== 'unknown')
      throw new WithdrawalResponseError('invalid', 'Detail pending cancellation is not unresolved');
    assertReceiptScopeIdentity(
      receipt,
      requested,
      { requestRef: request.requestRef, requestIdempotencyKey: request.idempotencyKey },
      'Detail pending cancellation',
    );
    assertReceiptOutcomeCoherent(receipt, 'Detail pending cancellation');
    assertReceiptRequestCoherent(receipt, request, 'Detail pending cancellation');
  }
  // A terminal-confirmed proof section is honest only for a settled (paid) request: an `available`
  // section over a non-paid request is incoherent (no success proof before settlement). Every proof
  // descriptor must scope to THIS request (requestRef), carry THIS request's exact net cash, be
  // issued at the RECORDED paid-event instant (paid-timeline coherence), and keep issuer/kind honest
  // (system_acknowledgment ⇒ labsd + no providerReference; provider_bank_slip ⇒ provider + a real
  // reference). A forged scope/type/net is rejected as unrenderable.
  if (documents.state === 'available') {
    if (request.status !== 'paid')
      throw new WithdrawalResponseError('invalid', 'Detail proof documents require a settled request');
    const paidInstants = new Set(
      timeline.filter((e) => e.kind === 'paid').map((e) => e.at),
    );
    if (paidInstants.size === 0)
      throw new WithdrawalResponseError('invalid', 'Detail proof documents require a recorded paid event');
    for (const doc of documents.documents) {
      if (doc.requestRef !== request.requestRef)
        throw new WithdrawalResponseError('identity_mismatch', 'Detail proof does not identify this request');
      if (doc.net.minor !== request.net.minor)
        throw new WithdrawalResponseError('invalid', 'Detail proof net does not match the request net');
      if (!paidInstants.has(doc.issuedAt))
        throw new WithdrawalResponseError('invalid', 'Detail proof issuedAt is not a recorded paid-event instant');
      if (doc.kind === 'system_acknowledgment' && (doc.issuer !== 'labsd' || doc.providerReference !== null))
        throw new WithdrawalResponseError('invalid', 'A system acknowledgment must be issued by labsd with no provider reference');
      if (doc.kind === 'provider_bank_slip' && (doc.issuer !== 'provider' || doc.providerReference === null))
        throw new WithdrawalResponseError('invalid', 'A provider bank slip must be issued by the provider with a real reference');
    }
  }
  return result;
}

// Cancel is a COMMAND. A scope/permission/late/stale disagreement is a typed `rejected` result
// (never a throw); the loader only rejects a response that is unrenderable (foreign identity or an
// incoherent released record). Every outcome echoes the command identity via the receipt.
export async function cancelWithdrawal(
  transport: WithdrawalHistoryTransport,
  input: { command: WithdrawalCancelCommandValue; signal: AbortSignal },
): Promise<WithdrawalCancelResultValue> {
  const command = WithdrawalCancelCommand.parse(input.command);
  const raw = await transport.cancel({ command, signal: input.signal });
  afterAwait(input.signal);
  const result = parseOrThrow(WithdrawalCancelResult, raw, 'cancel');
  const receipt = result.receipt;
  // The receipt must be provable in the full command scope and echo the command identity...
  assertReceiptScopeIdentity(
    receipt,
    command.scope,
    {
      operationKey: command.operationKey,
      requestRef: command.requestRef,
      requestIdempotencyKey: command.requestIdempotencyKey,
      expectedRevision: command.expectedRevision,
    },
    'Cancel',
  );
  // ...its stated outcome must match the envelope outcome (a `cancelled` result cannot carry an
  // `unknown` receipt, nor an `unknown` envelope an `accepted` receipt)...
  const envelopeOutcome = result.outcome === 'cancelled' ? 'accepted' : result.outcome;
  if (receipt.outcome !== envelopeOutcome)
    throw new WithdrawalResponseError(
      'invalid',
      'Cancel receipt outcome disagrees with the result envelope',
    );
  // ...and its outcome/code/resolvedAt must be internally coherent.
  assertReceiptOutcomeCoherent(receipt, 'Cancel');
  if (result.outcome === 'cancelled') {
    const r = result.request;
    if (!scopeEqual(r.scope, command.scope))
      throw new WithdrawalResponseError('scope_mismatch', 'Cancel result is out of scope');
    if (r.requestRef !== command.requestRef || r.idempotencyKey !== command.requestIdempotencyKey)
      throw new WithdrawalResponseError(
        'identity_mismatch',
        'Cancel result does not identify the commanded request',
      );
    if (r.status !== 'cancelled' || r.reserved.minor !== '0')
      throw new WithdrawalResponseError(
        'invalid',
        'Cancel result did not release the reservation exactly once',
      );
    assertRequestCoherent(r, 'Cancel');
    assertReceiptRequestCoherent(receipt, r, 'Cancel');
  }
  return result;
}

export async function recoverCancellation(
  transport: WithdrawalHistoryTransport,
  input: {
    scope: WithdrawalScopeValue;
    operationKey?: string;
    requestRef?: string;
    signal: AbortSignal;
  },
): Promise<WithdrawalCancellationRecoveryValue> {
  const requested = WithdrawalScope.parse(input.scope);
  // Anchored to at least one handle; a miss is never a licence to invent a new operation key.
  if (input.operationKey === undefined && input.requestRef === undefined)
    throw new WithdrawalResponseError(
      'invalid',
      'Cancellation recovery requires an operation key or a request reference',
    );
  const raw = await readThroughTransport('recoverCancellation', () =>
    transport.recoverCancellation(input),
  );
  afterAwait(input.signal);
  const recovery = parseOrThrow(WithdrawalCancellationRecovery, raw, 'cancellation recovery');
  if (recovery.state === 'missing') {
    // A miss must be bound to this scope and CORRELATE every supplied handle — never echo
    // unrelated operation/reference handles (and never a licence to invent a new key).
    if (!scopeEqual(recovery.scope, requested))
      throw new WithdrawalResponseError('scope_mismatch', 'Cancellation miss is out of scope');
    if (input.operationKey !== undefined && recovery.operationKey !== input.operationKey)
      throw new WithdrawalResponseError('identity_mismatch', 'Cancellation miss does not echo the requested operation key');
    if (input.requestRef !== undefined && recovery.requestRef !== input.requestRef)
      throw new WithdrawalResponseError('identity_mismatch', 'Cancellation miss does not echo the requested reference');
    return recovery;
  }
  const { receipt, request } = recovery;
  // Correlate ALL supplied handles against the receipt, prove full scope, then check outcome/state
  // coherence — including "no accepted claim with an active reservation".
  assertReceiptScopeIdentity(
    receipt,
    requested,
    { operationKey: input.operationKey, requestRef: input.requestRef },
    'Recovered cancellation',
  );
  assertReceiptOutcomeCoherent(receipt, 'Recovered cancellation');
  if (receipt.outcome === 'accepted' && request === null)
    throw new WithdrawalResponseError(
      'invalid',
      'Recovered accepted cancellation must carry its released request',
    );
  if (request !== null) {
    if (!scopeEqual(request.scope, requested))
      throw new WithdrawalResponseError('scope_mismatch', 'Recovered cancellation request is out of scope');
    assertRequestCoherent(request, 'Recovered cancellation');
    assertReceiptRequestCoherent(receipt, request, 'Recovered cancellation');
  }
  return recovery;
}

// ---- WU03 S1: staff period read + outcome-simulation command + static gateway --------

// The release-pool / current-period preview. Validates scope AND period-identity coherence (S1-F02):
// no duplicate period id within or across released/releasable, and the current open period is never
// also a released/releasable prior period, with a valid current range. The schema already enforces
// the honest field shapes (released[].releasedAt/releasedAmount MAY be null for legacy provenance;
// releasable carries a DISTINCT `eligibleAmount`). NO money sums / finance re-implementation.
export async function loadWithdrawalPeriods(
  transport: WithdrawalStaffTransport,
  input: { scope: WithdrawalScopeValue; signal: AbortSignal },
): Promise<WithdrawalPeriodsViewValue> {
  const requested = WithdrawalScope.parse(input.scope);
  const raw = await readThroughTransport('periods', () => transport.periods(input));
  afterAwait(input.signal);
  const view = parseOrThrow(WithdrawalPeriodsView, raw, 'periods');
  if (!scopeEqual(view.scope, requested))
    throw new WithdrawalResponseError('scope_mismatch', 'Periods scope does not match request');
  // Identity coherence: a period id appears at most once, and never in two categories at once.
  const releasedIds = new Set<string>();
  for (const p of view.released) {
    if (releasedIds.has(p.periodId))
      throw new WithdrawalResponseError('invalid', 'Periods released list has a duplicate period id');
    releasedIds.add(p.periodId);
  }
  const releasableIds = new Set<string>();
  for (const p of view.releasable) {
    if (releasableIds.has(p.periodId))
      throw new WithdrawalResponseError('invalid', 'Periods releasable list has a duplicate period id');
    if (releasedIds.has(p.periodId))
      throw new WithdrawalResponseError('invalid', 'A period is both released and releasable');
    releasableIds.add(p.periodId);
  }
  if (view.currentPeriod !== null) {
    if (releasedIds.has(view.currentPeriod.periodId) || releasableIds.has(view.currentPeriod.periodId))
      throw new WithdrawalResponseError(
        'invalid',
        'Current open period also appears as a released/releasable prior period',
      );
    if (Date.parse(view.currentPeriod.from) >= Date.parse(view.currentPeriod.toExclusive))
      throw new WithdrawalResponseError('invalid', 'Current period range is not increasing');
  }
  return view;
}

// A staff outcome SIMULATION command (like cancel: a scope/stale disagreement is a typed
// `rejected`, never a throw). On `applied`, the returned request must be in-scope, identify the
// commanded request, have reached the commanded target, and be WU02-coherent (reserve/settle rules).
export async function applyWithdrawalOutcome(
  transport: WithdrawalStaffTransport,
  input: { command: WithdrawalOutcomeSimCommandValue; signal: AbortSignal },
): Promise<WithdrawalOutcomeSimResultValue> {
  const command = WithdrawalOutcomeSimCommand.parse(input.command);
  const raw = await transport.outcome({ command, signal: input.signal });
  afterAwait(input.signal);
  const result = parseOrThrow(WithdrawalOutcomeSimResult, raw, 'outcome');
  if (result.outcome === 'applied') {
    const r = result.request;
    if (!scopeEqual(r.scope, command.scope))
      throw new WithdrawalResponseError('scope_mismatch', 'Outcome result is out of scope');
    if (r.requestRef !== command.requestRef)
      throw new WithdrawalResponseError(
        'identity_mismatch',
        'Outcome result does not identify the commanded request',
      );
    if (r.status !== command.target)
      throw new WithdrawalResponseError(
        'invalid',
        'Outcome result status does not match the commanded target',
      );
    assertRequestCoherent(r, 'Outcome');
  } else {
    // A rejection must still echo the commanded scope + reference (full-scope-echo invariant).
    if (!scopeEqual(result.scope, command.scope))
      throw new WithdrawalResponseError('scope_mismatch', 'Outcome rejection is out of scope');
    if (result.requestRef !== command.requestRef)
      throw new WithdrawalResponseError(
        'identity_mismatch',
        'Outcome rejection does not echo the commanded reference',
      );
  }
  return result;
}

// Gateway configuration status is a STATIC trusted dev config — a global truthful `not_connected`
// with no secrets/provider/activation/retry. It is NOT scope-dependent, so it is exposed here as a
// static value (validated against the contract) rather than via the scope-gated transport.
const GATEWAY_STATUS: WithdrawalGatewayStatusValue = WithdrawalGatewayStatus.parse({
  state: 'not_connected',
  reasons: ['ยังไม่ได้เชื่อมต่อช่องทางจ่ายเงิน (สภาพแวดล้อมตัวอย่าง) จึงยังโอนเงินจริงไม่ได้'],
});
export function withdrawalGatewayStatus(): WithdrawalGatewayStatusValue {
  return GATEWAY_STATUS;
}

// ---- WU03 S2: payout beneficiary config read + save ----------------------------------

// The scoped payout-config read that powers the shared editor. Validates scope + catalog/state
// coherence; a present-but-invalid config is the honest `unavailable` arm (not a throw). Any saved
// catalog id must be in the returned catalog; a `verified` config must resolve a masked recipient;
// an `unavailable` config is never editable.
export async function loadPayoutBeneficiaryConfig(
  transport: WithdrawalBeneficiaryTransport,
  input: { scope: WithdrawalScopeValue; signal: AbortSignal },
): Promise<PayoutBeneficiaryConfigValue> {
  const requested = WithdrawalScope.parse(input.scope);
  const raw = await readThroughTransport('beneficiaryConfig', () =>
    transport.beneficiaryConfig(input),
  );
  afterAwait(input.signal);
  const config = parseOrThrow(PayoutBeneficiaryConfig, raw, 'beneficiary config');
  if (!scopeEqual(config.scope, requested))
    throw new WithdrawalResponseError('scope_mismatch', 'Beneficiary config scope does not match request');
  const bankIds = new Set(config.catalog.banks.map((b) => b.bankId));
  const accountIds = new Set(config.catalog.accounts.map((a) => a.accountChoiceId));
  if (config.bankId !== null && !bankIds.has(config.bankId))
    throw new WithdrawalResponseError('invalid', 'Beneficiary config bank is not in its catalog');
  if (config.accountChoiceId !== null && !accountIds.has(config.accountChoiceId))
    throw new WithdrawalResponseError('invalid', 'Beneficiary config account is not in its catalog');
  if (config.state === 'verified' && config.maskedAccount === null)
    throw new WithdrawalResponseError('invalid', 'A ready beneficiary must resolve a masked account');
  if (config.state === 'unavailable' && config.allowedEdit)
    throw new WithdrawalResponseError('invalid', 'An unavailable beneficiary config must not be editable');
  return config;
}

// A beneficiary save COMMAND (typed reject, never a throw for scope/stale). `saved` STRICTLY carries
// a fresh `pending` config (with an advanced revision); `unknown` (incl. a same-key replay) echoes
// the command identity and drives an authoritative re-read; `rejected` writes nothing.
export async function setPayoutBeneficiary(
  transport: WithdrawalBeneficiaryTransport,
  input: { command: SetPayoutBeneficiaryCommandValue; signal: AbortSignal },
): Promise<SetPayoutBeneficiaryResultValue> {
  const command = SetPayoutBeneficiaryCommand.parse(input.command);
  const raw = await transport.setBeneficiary({ command, signal: input.signal });
  afterAwait(input.signal);
  const result = parseOrThrow(SetPayoutBeneficiaryResult, raw, 'set beneficiary');
  if (!scopeEqual(result.scope, command.scope))
    throw new WithdrawalResponseError('scope_mismatch', 'Set beneficiary result is out of scope');
  if (result.idempotencyKey !== command.idempotencyKey)
    throw new WithdrawalResponseError(
      'identity_mismatch',
      'Set beneficiary result does not echo the command key',
    );
  if (result.outcome === 'saved') {
    const cfg = result.config;
    if (!scopeEqual(cfg.scope, command.scope))
      throw new WithdrawalResponseError('scope_mismatch', 'Saved beneficiary config is out of scope');
    // The documented `saved` promise: a FRESH pending record, its revision ADVANCED past the
    // submitted expectedRevision, echoing exactly the submitted recipient, with catalog-coherent ids.
    // Anything else is a malformed / cross-recipient claimed save and must not be accepted as this
    // command's success (the caller would otherwise render an unrelated recipient as freshly saved).
    if (cfg.state !== 'pending')
      throw new WithdrawalResponseError('invalid', 'A saved beneficiary config must be pending');
    if (cfg.revision === command.expectedRevision)
      throw new WithdrawalResponseError('invalid', 'A saved beneficiary config must advance its revision');
    if (
      cfg.displayName !== command.displayName ||
      cfg.bankId !== command.bankId ||
      cfg.accountChoiceId !== command.accountChoiceId
    )
      throw new WithdrawalResponseError(
        'identity_mismatch',
        'A saved beneficiary config must echo the submitted recipient',
      );
    const bankIds = new Set(cfg.catalog.banks.map((b) => b.bankId));
    const accountIds = new Set(cfg.catalog.accounts.map((a) => a.accountChoiceId));
    if (cfg.bankId === null || !bankIds.has(cfg.bankId) || cfg.accountChoiceId === null || !accountIds.has(cfg.accountChoiceId))
      throw new WithdrawalResponseError('invalid', 'A saved beneficiary config must reference catalog choices');
  } else if (result.expectedRevision !== command.expectedRevision) {
    throw new WithdrawalResponseError(
      'identity_mismatch',
      'Set beneficiary result does not echo the expected revision',
    );
  }
  return result;
}
