import { z } from 'zod';
import { Id, Instant, Money } from './common';
import { BalanceScope, BalanceSnapshot, NonNegativeMoney } from './withdrawal';
import { BlockingReason, WithdrawalReadinessResult } from './withdrawal-readiness';

// WU01 SYSTEM — withdrawal-journey presentation/quote/request contracts.
//
// This layer defines ONLY the typed shapes exchanged between an injected transport and the
// (independently authored) withdrawal UI. It performs NO money arithmetic, invents NO tax
// rate/fee/minimum and never derives amounts from a badge or a label. Every display figure
// the UI shows must arrive here already computed by the trusted W01 pure evaluators; the UI
// must never infer amounts or tax. Reuses W01-A BalanceSnapshot / W01-B readiness verbatim.
//
// "unknown" is always kept DISTINCT from a known zero: a nullable Money means "not known",
// never a fabricated 0; an `unavailable` quote arm carries reasons and no amounts so a
// missing tax/fee/recipient can never masquerade as a confirmable figure.

const reasons = z.array(z.string().min(1).max(300)).min(1).max(30);

// ---- Scope ---------------------------------------------------------------------------
//
// The withdrawal scope carries the existing partner query identity (user/partner/permission)
// PLUS the paying entity, currency and the synthetic scenario namespace. It is deliberately
// independent of any earnings date window or brand filter (a balance spans periods; an open
// current period never constrains it). `scenario` isolates dev-only synthetic state and has
// no meaning in production reads.
export const WithdrawalScope = z.strictObject({
  userId: Id,
  partnerId: Id,
  permissionRevision: Id,
  payerId: Id,
  currency: z.literal('THB'),
  scenario: Id,
});
export type WithdrawalScopeValue = z.infer<typeof WithdrawalScope>;

// ---- Read-only masked beneficiary ----------------------------------------------------
//
// A distinct new concept (NOT the existing AccountProfile). WU01 only PRESENTS it read-only
// and masked; the editable panel is WU03. `known` carries the masked destination and its
// version; `missing` (nothing configured) and `pending` (configured but not yet verified)
// carry reasons and never expose an account number.
export const MaskedBeneficiary = z.strictObject({
  displayName: z.string().min(1).max(140),
  bankName: z.string().min(1).max(140),
  // Already masked upstream, e.g. "SCB ••••1234". No full account number is modelled.
  maskedAccount: z.string().min(1).max(60),
  version: Id,
});
export type MaskedBeneficiaryValue = z.infer<typeof MaskedBeneficiary>;

export const PayoutBeneficiary = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('known'), ...MaskedBeneficiary.shape }),
  z.strictObject({ state: z.literal('missing'), reasons }),
  z.strictObject({ state: z.literal('pending'), version: Id, reasons }),
]);
export type PayoutBeneficiaryValue = z.infer<typeof PayoutBeneficiary>;

// ---- Summary (getSummary) ------------------------------------------------------------

// A minimal reference to the CURRENT open period. Separate from the withdrawable balance:
// its pending amount never contributes to `available` until an explicit release event.
export const PeriodReference = z.strictObject({
  periodId: Id,
  label: z.string().min(1).max(140),
  from: Instant,
  toExclusive: Instant,
});
export type PeriodReferenceValue = z.infer<typeof PeriodReference>;

// ---- Request status / actions (defined here so the resume descriptor and summary can bind
// them; the full WithdrawalRequest below reuses the same enums) ------------------------

// requested != paid. `reconciling` is the uncertain/unknown-outcome state that still holds a
// reservation. Nothing here converts a badge into financial authority.
export const RequestStatus = z.enum([
  'requested',
  'processing',
  'paid',
  'cancelled',
  'failed',
  'reconciling',
]);
export type RequestStatusValue = z.infer<typeof RequestStatus>;

// Actions the transport authorises for a request — the UI must not derive these from status
// text. `cancel` never appears once a request is beyond cancellation; `check_status` and
// `contact_support` are safe under an unknown outcome (never an automatic retry).
export const RequestAction = z.enum(['cancel', 'check_status', 'contact_support']);
export type RequestActionValue = z.infer<typeof RequestAction>;

// ---- Resume descriptor (durable reload recovery) -------------------------------------
//
// A compact, durable descriptor of an unresolved/active request that survives reload. The UI
// reads it from `summary.resume` to REDISCOVER a submission whose client idempotency key it
// may have lost (reload/close after a timeout-after-accept), then recovers the full record by
// idempotencyKey/requestRef. It carries a stable identity + status + allowed actions + the
// reserved/gross/net amounts — enough to reopen review/result/recovery WITHOUT WU02 history.
// A reconciling entry keeps a genuine unknown distinct: the reservation is still held and no
// payment completion is invented.
export const WithdrawalResume = z.strictObject({
  requestRef: Id,
  idempotencyKey: Id,
  status: RequestStatus,
  gross: NonNegativeMoney,
  net: NonNegativeMoney,
  reserved: NonNegativeMoney,
  submittedAt: Instant,
  allowedActions: z.array(RequestAction).max(3),
});
export type WithdrawalResumeValue = z.infer<typeof WithdrawalResume>;

// ---- Last successful withdrawal (getSummary) -----------------------------------------
//
// A compact reference to the SINGLE most recent GENUINELY PAID withdrawal in this scope, for an
// at-a-glance "last successful withdrawal" line. It is chosen by the recorded PAID EVENT instant
// (never `submittedAt`), and `net` is that one request's ACTUAL net cash. It is deliberately NOT
// `balance.settled` — that aggregate sums MANY historical payments, so surfacing it here would
// overstate a single withdrawal. The tri-state on `summary.lastWithdrawal` (below) keeps a genuine
// unknown distinct from a verified none.
export const WithdrawalLastPaid = z.strictObject({
  // The paid request's stable reference (a controller-recorded request, or an authored opening
  // settlement with explicit scenario provenance). Never invented from an aggregate.
  requestRef: Id,
  // The ACTUAL net cash of that one withdrawal (gross − Σ deductions), never the settled aggregate.
  net: NonNegativeMoney,
  // The recorded settlement instant of the paid EVENT — NOT the submission time.
  paidAt: Instant,
});
export type WithdrawalLastPaidValue = z.infer<typeof WithdrawalLastPaid>;

export const WithdrawalSummary = z.strictObject({
  scope: WithdrawalScope,
  asOf: Instant,
  // Accumulated ready balance across periods (W01-A snapshot; may be known/unavailable).
  balance: BalanceSnapshot,
  beneficiary: PayoutBeneficiary,
  // Current open-period pending amount. NULL means genuinely unknown — never a guessed 0 and
  // never summed into the withdrawable balance.
  currentPeriodPending: Money.nullable(),
  currentPeriod: PeriodReference.nullable(),
  // The W01-B aggregate readiness (facts + trusted balance). `readiness.blockingReasons`
  // enumerates WHAT blocks a request; the UI reads `readiness.requestGate`, never a badge.
  readiness: WithdrawalReadinessResult,
  // A dev-only persistence caveat surfaced verbatim to the UI banner (e.g. a save failed and
  // reload durability is not guaranteed). NULL when there is nothing to warn about.
  persistenceWarning: z.string().min(1).max(300).nullable(),
  // Durable reload-recovery descriptors for every still-active (non-terminal) request in this
  // scope. After a reload/close the UI reads these to rediscover a submission whose client key
  // it lost, then recovers the full record. Empty when there is nothing outstanding. The bound
  // is ALIGNED with PersistedStateV1.requests (200): every persisted request is active in WU01,
  // so a smaller resume cap would make the summary unparseable past that many small requests.
  resume: z.array(WithdrawalResume).max(200),
  // The most recent genuinely PAID withdrawal in this scope (see WithdrawalLastPaid). Tri-state on
  // purpose:
  //   • omitted (undefined) — provenance UNKNOWN: an older transport that predates this field, an
  //     unavailable balance source, or a not-yet-recovered restore. NEVER a fabricated "none".
  //   • null — VERIFIED there is no prior paid withdrawal (nothing has ever settled in this scope).
  //   • present — the latest paid withdrawal's ref, net cash, and settlement instant.
  // `.optional()` keeps summaries produced by an older transport (without the key) parseable, and a
  // consuming UI reads `summary.lastWithdrawal` (undefined vs null vs value), never a badge.
  lastWithdrawal: WithdrawalLastPaid.nullable().optional(),
  // Freshness binding for the feature query-key factory: changes whenever the summary would
  // change (release, submission, beneficiary revision) so scoped invalidation refetches.
  revision: Id,
});
export type WithdrawalSummaryValue = z.infer<typeof WithdrawalSummary>;

// ---- Quote (previewQuote) ------------------------------------------------------------

// A single scenario-authored deduction line, bound to the exact quoted gross + policy
// revision by the QUOTE, never by the UI. `amount` is a non-negative magnitude.
export const QuoteDeductionKind = z.enum(['withholding_tax', 'transfer_fee', 'other']);
export type QuoteDeductionKindValue = z.infer<typeof QuoteDeductionKind>;
export const QuoteDeduction = z.strictObject({
  kind: QuoteDeductionKind,
  label: z.string().min(1).max(140),
  amount: NonNegativeMoney,
});
export type QuoteDeductionValue = z.infer<typeof QuoteDeduction>;

// The immutable version bindings a quote was computed against. A submission carrying stale
// bindings is rejected; a fresh quote is required when balance/policy/beneficiary changes.
export const QuoteBindings = z.strictObject({
  balanceRevision: Id,
  policyRevision: Id,
  beneficiaryVersion: Id,
});
export type QuoteBindingsValue = z.infer<typeof QuoteBindings>;

// Why a quote could not produce confirmable figures. Distinct codes keep an unsupported
// amount separate from a missing recipient / unknown policy — none of which is ever filled
// in with an invented amount.
export const QuoteUnavailableCode = z.enum([
  'amount_not_positive',
  'amount_exceeds_available',
  'amount_unsupported', // "applies" scenario without a scenario-authored quote for this gross
  'tax_policy_unknown',
  'fee_unknown',
  'beneficiary_missing',
  'beneficiary_pending',
  // WU03 S2: the saved payout config is PRESENT but invalid/unreadable — a quote is blocked
  // (fail-closed) rather than falling back to a fixture-ready recipient.
  'beneficiary_unavailable',
  'balance_unknown',
  'not_ready',
]);
export type QuoteUnavailableCodeValue = z.infer<typeof QuoteUnavailableCode>;

const QuotedArm = z.strictObject({
  state: z.literal('quoted'),
  quoteId: Id,
  scope: WithdrawalScope,
  // Requested gross obligation (pre-withholding), a positive magnitude.
  gross: NonNegativeMoney,
  deductions: z.array(QuoteDeduction).max(10),
  // Cash net = gross - Σ deductions (validated below); reconciled, never a relabelled gross.
  net: NonNegativeMoney,
  // Withdrawable balance AFTER this request reserves the gross (derived by W01-A, not the UI).
  availableAfterRequest: NonNegativeMoney,
  // Immutable masked beneficiary snapshot captured at quote time.
  beneficiary: MaskedBeneficiary,
  bindings: QuoteBindings,
  issuedAt: Instant,
  expiresAt: Instant,
});
const UnavailableArm = z.strictObject({
  state: z.literal('unavailable'),
  scope: WithdrawalScope,
  // The gross the caller asked about, echoed back so the UI can show it — but with NO
  // deduction/net/available figures, which prevents confirmation.
  gross: NonNegativeMoney,
  codes: z.array(QuoteUnavailableCode).min(1).max(10),
  reasons,
});

const WithdrawalQuoteUnion = z.discriminatedUnion('state', [QuotedArm, UnavailableArm]);
// Reconciliation invariant on the confirmable arm: gross == net + Σ deductions, in exact
// satang. A quote that does not reconcile is rejected at the boundary, never displayed.
export const WithdrawalQuote = WithdrawalQuoteUnion.superRefine((quote, ctx) => {
  if (quote.state !== 'quoted') return;
  const deducted = quote.deductions.reduce((total, d) => total + BigInt(d.amount.minor), 0n);
  if (BigInt(quote.net.minor) + deducted !== BigInt(quote.gross.minor))
    ctx.addIssue({
      code: 'custom',
      message: 'quote net + deductions must reconcile exactly to gross',
      path: ['net'],
    });
});
export type WithdrawalQuoteValue = z.infer<typeof WithdrawalQuote>;

// ---- Request / submission ------------------------------------------------------------
// (RequestStatus / RequestAction are declared above, before WithdrawalSummary.)

export const WithdrawalRequest = z.strictObject({
  requestRef: Id,
  idempotencyKey: Id,
  scope: WithdrawalScope,
  status: RequestStatus,
  gross: NonNegativeMoney,
  net: NonNegativeMoney,
  deductions: z.array(QuoteDeduction).max(10),
  // The money currently held for this request. Preserved on an unknown outcome; released
  // once on a known cancelled/failed; converted to settled once on paid.
  reserved: NonNegativeMoney,
  beneficiary: MaskedBeneficiary,
  quoteId: Id,
  bindings: QuoteBindings,
  submittedAt: Instant,
  allowedActions: z.array(RequestAction).max(3),
});
export type WithdrawalRequestValue = z.infer<typeof WithdrawalRequest>;

// The command the UI submits: an accepted quote plus a client-stable idempotency key. The
// echoed figures/bindings let the transport detect a stale quote or a mismatched replay of
// the same key.
export const WithdrawalSubmission = z.strictObject({
  scope: WithdrawalScope,
  idempotencyKey: Id,
  quoteId: Id,
  gross: NonNegativeMoney,
  net: NonNegativeMoney,
  bindings: QuoteBindings,
});
export type WithdrawalSubmissionValue = z.infer<typeof WithdrawalSubmission>;

// Why a submission was rejected. Scope/permission/payer/scenario mismatches and a stale quote
// are all distinct; none of them creates, mutates or reserves money.
export const SubmitRejectCode = z.enum([
  'scope_mismatch',
  'permission_mismatch',
  'payer_mismatch',
  'scenario_mismatch',
  'quote_not_found',
  // A quote that was already consumed by an accepted/unknown submission. Distinct from
  // `quote_not_found` so a one-use replay under a FRESH key can never mint a second
  // reservation from the same quote.
  'quote_consumed',
  'stale_quote',
  'quote_expired',
  'beneficiary_changed',
  'amount_unavailable',
  'idempotency_conflict',
  // The synthetic persisted state could not be READ on a fresh restore (a recoverable storage
  // read outage). No spendable balance is fabricated and NO new request is written until a
  // later read recovers — a submission attempted in this window is refused, never reserved.
  'restore_unread',
  // The synthetic in-memory/persisted store has a bounded record capacity (aligned with the
  // PersistedStateV1.requests / summary.resume cap). A NEW request beyond that bound is refused
  // BEFORE any money/quote mutation, so the store never holds an unserialisable/unreadable
  // number of records. This is an explicitly SYNTHETIC dev-store limit — NOT an invented live
  // minimum/maximum withdrawal policy. An existing key still replays at capacity.
  'capacity_reached',
]);
export type SubmitRejectCodeValue = z.infer<typeof SubmitRejectCode>;

// Submission outcome:
//  - accepted: the request is recorded with money reserved (status requested). An idempotent
//    replay of the same key + same payload returns the SAME record (never a duplicate).
//  - unknown: acceptance is uncertain (e.g. timeout after accept). The reservation is
//    PRESERVED and the same key recovers the record; a fresh key is never invented and funds
//    are never released automatically.
//  - rejected: no money is reserved or moved.
export const WithdrawalSubmitResult = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('accepted'), request: WithdrawalRequest }),
  z.strictObject({ outcome: z.literal('unknown'), request: WithdrawalRequest }),
  z.strictObject({
    outcome: z.literal('rejected'),
    code: SubmitRejectCode,
    detail: z.string().min(1).max(300),
  }),
]);
export type WithdrawalSubmitResultValue = z.infer<typeof WithdrawalSubmitResult>;

// ---- Recovery ------------------------------------------------------------------------
//
// Minimal WU01 retrieval by idempotency key or request reference (full history is WU02).
// `missing` means no such record — the caller must NOT invent a new key from a miss.
export const WithdrawalRecovery = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('found'), request: WithdrawalRequest }),
  z.strictObject({ state: z.literal('missing') }),
]);
export type WithdrawalRecoveryValue = z.infer<typeof WithdrawalRecovery>;

// ---- Transport read outage (typed, bounded) ------------------------------------------
//
// A recoverable READ failure of a transport operation (e.g. the summary source is
// temporarily unreadable). It is deliberately DISTINCT from a validation/scope error and from
// a storage/data fault: it means "the read did not complete", NOT "the data is gone". The
// transport rejects with this; the UI can surface a retry affordance while the durable
// reservation/state is left completely untouched. Defined in the contract layer so BOTH the
// UI model and the dev adapter reference one type (neither invents a private variant).
export class WithdrawalReadError extends Error {
  constructor(
    // WU02 widens the operation set additively: the history list/detail reads and the
    // cancellation-operation recovery are read paths that can suffer the same recoverable outage
    // as summary/quote/recover, and the UI must be able to identify which read failed.
    readonly operation:
      | 'summary'
      | 'quote'
      | 'recover'
      | 'list'
      | 'detail'
      | 'recoverCancellation'
      // WU03 S1: the staff/period preview read. (Beneficiary-config read stays out until that slice.)
      | 'periods',
    message: string,
  ) {
    super(message);
    this.name = 'WithdrawalReadError';
  }
}

// ======================================================================================
// WU02 — history / detail / durable cancellation (additive; WU01 shapes above are unchanged)
//
// The WU01 `WithdrawalTransport` (four methods) and every WU01 contract stay compatible. WU02
// adds a superset transport (WithdrawalHistoryTransport, in the feature model) plus the read
// projections below. Nothing here performs money arithmetic: the controller (dev) or the future
// trusted service produces every figure through the audited W01 evaluators; this layer only
// TYPES and (via the model loaders) VALIDATES them. Monetary reservation/settlement is a pure
// projection of request status — never an incremental credit — so a replayed/late/lost command
// can never double-release or double-settle.
// ======================================================================================

// A bounded, monotonic mutation sequence. Revisions are derived from it (see the dev controller):
// it increments on every accepted transition / cancellation intent / release / config change, so
// an old quote is stale after ANY change (including processing/reconciling, whose totals are
// numerically equal) and equal-total cancel/recreate (ABA) can never resurrect an old quote.
export const MutationSeq = z.number().int().min(0).max(1_000_000);
export type MutationSeqValue = z.infer<typeof MutationSeq>;

// ---- Timeline -------------------------------------------------------------------------
//
// The lifecycle events recorded on a request. `seq` (not `at`) is the ORDERING AUTHORITY, so a
// repeated/backtracking synthetic clock never reorders history. `status` is the request status
// AFTER the event; the last entry's status MUST equal the record's status (enforced by the model
// loader + the store validator). The first entry is always `submitted`.
export const WithdrawalEventKind = z.enum([
  // `legacy_snapshot` is the HONEST head of an INCOMPLETE (v1-upgraded) history: it records the
  // status a legacy record stood at upgrade WITHOUT inventing a `submitted`-at-current-status
  // event or claiming a real recorded transition sequence. It appears only when
  // WithdrawalRequestDetail.historyComplete === false, always first, at the original submittedAt.
  'legacy_snapshot',
  'submitted', // request accepted, reservation created (status requested)
  'reconciling', // uncertain outcome recorded (reservation retained)
  'processing', // provider began processing (reservation retained)
  'paid', // settled once: reserved gross -> settled gross (net cash may differ)
  'failed', // definitive withdrawal failure: reservation released once
  'cancelled', // cancelled while requested: reservation released once
]);
export type WithdrawalEventKindValue = z.infer<typeof WithdrawalEventKind>;

// The status a NON-`legacy_snapshot` event must carry (kind determines status exactly). A
// `legacy_snapshot` is exempt: it carries the legacy record's own status (requested/reconciling).
// Exported so the model loader and dev controller share ONE legal kind<->status/transition map.
export const EVENT_KIND_STATUS: Record<
  Exclude<WithdrawalEventKindValue, 'legacy_snapshot'>,
  RequestStatusValue
> = {
  submitted: 'requested',
  reconciling: 'reconciling',
  processing: 'processing',
  paid: 'paid',
  failed: 'failed',
  cancelled: 'cancelled',
};

// The legal request-status transition graph (also drives the dev controller's simulation). A
// terminal status has no outgoing edges, so a complete history can never move paid/failed/cancelled
// back to an active state.
export const REQUEST_TRANSITIONS: Record<RequestStatusValue, readonly RequestStatusValue[]> = {
  requested: ['processing', 'paid', 'failed', 'cancelled', 'reconciling'],
  processing: ['paid', 'failed', 'reconciling'],
  reconciling: ['processing', 'paid', 'failed'],
  paid: [],
  failed: [],
  cancelled: [],
};

export const WithdrawalTimelineEntry = z.strictObject({
  seq: MutationSeq,
  at: Instant,
  kind: WithdrawalEventKind,
  status: RequestStatus,
  detail: z.string().min(1).max(300).nullable(),
});
export type WithdrawalTimelineEntryValue = z.infer<typeof WithdrawalTimelineEntry>;

// ---- Linked period provenance (honest — NOT a per-withdrawal allocation) --------------
//
// A source period that contributed to the accumulated available balance the request drew from.
// `releasedAmount` is the POOL-release amount for that period (which IS modelled via released
// periods), NEVER a claim of how much of THIS withdrawal it funded (allocation is NOT modelled).
// `statementId` deep-links a retained period statement ONLY when a scenario supplies a real
// mapping; otherwise null so there is never a dead link.
export const WithdrawalPeriodLink = z.strictObject({
  periodId: Id,
  label: z.string().min(1).max(140),
  releasedAt: Instant.nullable(),
  releasedAmount: NonNegativeMoney.nullable(),
  statementId: Id.nullable(),
});
export type WithdrawalPeriodLinkValue = z.infer<typeof WithdrawalPeriodLink>;

// The source-period context FROZEN onto a request at submission. `known` carries the pool
// provenance with an explicit `allocationModeled: false`; `unavailable` is the HONEST state for a
// v1-upgraded record whose provenance was never recorded — never fabricated after the fact.
export const WithdrawalSourceContext = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('known'),
    periods: z.array(WithdrawalPeriodLink).max(30),
    allocationModeled: z.literal(false),
  }),
  z.strictObject({ state: z.literal('unavailable'), reasons }),
]);
export type WithdrawalSourceContextValue = z.infer<typeof WithdrawalSourceContext>;

// ---- Documents (pending; plus a terminal-confirmed proof descriptor) -------------------
//
// A single immutable, system-issued proof descriptor for a SETTLED (paid) withdrawal. It is NOT a
// provider bank slip unless a real authenticated provider reference exists — a `system_acknowledgment`
// (issuer `labsd`, `providerReference: null`) is the honest artefact while the gateway is not
// connected; a `provider_bank_slip` (issuer `provider`, non-null `providerReference`) is emitted ONLY
// with a genuine reference, never fabricated. `issuedAt` is the recorded PAID EVENT instant (never
// Date.now); `net` is THIS request's actual net cash; `requestRef` scopes it to one request. The
// descriptor is stable (derived from the request + its paid event), so it survives reload without a
// standalone file store. Future immutable provider evidence stays a documented boundary (scoped,
// source-referenced, verified-only) — not modelled with an invented URL here.
export const WithdrawalProofDocument = z.strictObject({
  documentId: Id,
  kind: z.enum(['system_acknowledgment', 'provider_bank_slip']),
  issuer: z.enum(['labsd', 'provider']),
  title: z.string().min(1).max(140),
  requestRef: Id,
  issuedAt: Instant,
  net: NonNegativeMoney,
  providerReference: Id.nullable(),
});
export type WithdrawalProofDocumentValue = z.infer<typeof WithdrawalProofDocument>;

// Extensible union. `pending` remains for a non-terminal request (no download URL / fake PDF / dead
// link). The additive `available` arm carries the bounded proof descriptors for a paid request; an
// older producer that only knows `pending` still parses (additive union member).
export const WithdrawalDocumentsSection = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending'), reasons }),
  z.strictObject({
    state: z.literal('available'),
    documents: z.array(WithdrawalProofDocument).min(1).max(10),
  }),
]);
export type WithdrawalDocumentsSectionValue = z.infer<typeof WithdrawalDocumentsSection>;

// ---- Durable cancellation operation ---------------------------------------------------
//
// A cancellation is its OWN durable operation, identified by an `operationKey` that is DISTINCT
// from the request's idempotency key. A conflicting payload under the same operationKey is
// rejected; a replay returns the SAME operation. `unknown` never silently retries — the same key
// is recovered. A cancellation-OPERATION failure is distinct from a failed WITHDRAWAL and leaves
// the request's reservation unchanged.
export const CancelRejectCode = z.enum([
  'not_found',
  'scope_mismatch',
  'permission_mismatch',
  'payer_mismatch',
  'scenario_mismatch',
  'not_cancellable', // status is beyond `requested`: too late (never falsely claims cancellation)
  'stale_revision', // expectedRevision != current revision: refresh before retry, no mutation
  'identity_mismatch', // requestRef / requestIdempotencyKey do not identify the same record
  'operation_conflict', // same operationKey replayed with a different payload
  'restore_unread', // store not yet readable: never mutate a reservation blindly
  // The synthetic store's bounded cancellation-receipt log is full; a NEW operation is refused
  // BEFORE any mutation (a replay of an existing operationKey still works). Mirrors the submit
  // `capacity_reached` precedent — an explicitly synthetic dev-store limit, not a live policy.
  'capacity_reached',
]);
export type CancelRejectCodeValue = z.infer<typeof CancelRejectCode>;

// The durable receipt for a cancellation operation. `outcome`:
//  - accepted:         the request is now cancelled (reservation released exactly once).
//  - unknown:          uncertain; the reservation is RETAINED; recover by the SAME operationKey.
//  - operation_failed: the cancel operation failed definitively (reserve UNCHANGED); a NEW,
//                      freshly-reviewed operationKey may be attempted.
//  - rejected:         a validation rejection (see `code`); no money moved, nothing persisted.
export const CancellationOutcome = z.enum([
  'accepted',
  'unknown',
  'operation_failed',
  'rejected',
]);
export type CancellationOutcomeValue = z.infer<typeof CancellationOutcome>;

// `outcome`/`code`/`resolvedAt` are coherent by construction and re-checked by the loader:
//  - accepted        -> code null, resolvedAt set   (reservation released once)
//  - unknown         -> code null, resolvedAt null   (UNRESOLVED: reservation retained)
//  - operation_failed-> code set,  resolvedAt set    (reserve UNCHANGED; a new key may retry)
//  - rejected        -> code set,  resolvedAt set    (validation reject; no money moved)
// `scope` is the FULL six-field scope, so a receipt with no request record (unknown / rejected /
// operation_failed / found-with-null-request) can still be proven in scope.
export const WithdrawalCancellationReceipt = z.strictObject({
  scope: WithdrawalScope,
  operationKey: Id,
  requestRef: Id,
  requestIdempotencyKey: Id,
  expectedRevision: Id,
  outcome: CancellationOutcome,
  code: CancelRejectCode.nullable(),
  detail: z.string().min(1).max(300).nullable(),
  createdAt: Instant,
  resolvedAt: Instant.nullable(),
});
export type WithdrawalCancellationReceiptValue = z.infer<typeof WithdrawalCancellationReceipt>;

// The command the UI submits to cancel. `operationKey` is the durable cancellation identity (NOT
// the request key). `expectedRevision` is the revision the UI last observed (optimistic
// concurrency): a cancel issued against a stale view is rejected without releasing funds.
export const WithdrawalCancelCommand = z.strictObject({
  scope: WithdrawalScope,
  requestRef: Id,
  requestIdempotencyKey: Id,
  operationKey: Id,
  expectedRevision: Id,
});
export type WithdrawalCancelCommandValue = z.infer<typeof WithdrawalCancelCommand>;

// The receipt is echoed on EVERY outcome (including rejected) so the caller can always bind the
// result to its command identity. `cancelled` additionally carries the now-cancelled request
// (reserved == 0); the model loader verifies the release before it can be shown.
export const WithdrawalCancelResult = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('cancelled'),
    receipt: WithdrawalCancellationReceipt,
    request: WithdrawalRequest,
  }),
  z.strictObject({ outcome: z.literal('unknown'), receipt: WithdrawalCancellationReceipt }),
  z.strictObject({ outcome: z.literal('operation_failed'), receipt: WithdrawalCancellationReceipt }),
  z.strictObject({ outcome: z.literal('rejected'), receipt: WithdrawalCancellationReceipt }),
]);
export type WithdrawalCancelResultValue = z.infer<typeof WithdrawalCancelResult>;

// Recover a cancellation operation by the SAME operationKey and/or requestRef. `missing` echoes
// the queried handles (missing is NOT permission to invent a new key). `found` carries the
// receipt and the current request record (when locatable) so the UI can see whether the reserve
// was released (accepted) or is still held (unknown / operation_failed).
export const WithdrawalCancellationRecovery = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('found'),
    receipt: WithdrawalCancellationReceipt,
    request: WithdrawalRequest.nullable(),
  }),
  // `missing` carries the FULL scope and echoes BOTH queried handles (nullable only when a handle
  // was not supplied) so the loader can correlate the answer to this exact query and reject a miss
  // that echoes unrelated handles or a foreign scope.
  z.strictObject({
    state: z.literal('missing'),
    scope: WithdrawalScope,
    operationKey: Id.nullable(),
    requestRef: Id.nullable(),
  }),
]);
export type WithdrawalCancellationRecoveryValue = z.infer<typeof WithdrawalCancellationRecovery>;

// ---- History list (listRequests) ------------------------------------------------------
//
// The list REUSES the full immutable `WithdrawalRequest` as each row (never a second, thinner
// monetary record that lacks deductions yet claims net reconciliation). All rows fit the store's
// 200 bound, newest submitted first, so there is NO per-item pagination. `nextCursor` is a
// forward-compat placeholder constrained to literal null in WU02.
export const WithdrawalList = z.strictObject({
  scope: WithdrawalScope,
  asOf: Instant,
  items: z.array(WithdrawalRequest).max(200),
  nextCursor: z.null(),
  revision: Id,
});
export type WithdrawalListValue = z.infer<typeof WithdrawalList>;

// ---- Detail (getRequest) --------------------------------------------------------------
//
// `request` is the immutable core (gross/net/deductions/masked beneficiary/ref/status/actions),
// reused verbatim. `historyComplete` is false for a v1-upgraded record whose earlier history was
// never recorded (its timeline is the honest single `submitted` entry). `pendingCancellations`
// exposes unresolved cancellation-operation descriptor(s) so a reload/new route can discover an
// in-flight unknown cancel and recover it.
export const WithdrawalRequestDetail = z.strictObject({
  request: WithdrawalRequest,
  timeline: z.array(WithdrawalTimelineEntry).min(1).max(50),
  historyComplete: z.boolean(),
  sourceContext: WithdrawalSourceContext,
  documents: WithdrawalDocumentsSection,
  pendingCancellations: z.array(WithdrawalCancellationReceipt).max(20),
  revision: Id,
});
export type WithdrawalRequestDetailValue = z.infer<typeof WithdrawalRequestDetail>;

export const WithdrawalDetailResult = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('found'), detail: WithdrawalRequestDetail }),
  // `missing` still carries the full scope and the requested reference, so even a not-found answer
  // is bound to this exact six-field scope + ref and can never be a foreign/blank envelope.
  z.strictObject({ state: z.literal('missing'), scope: WithdrawalScope, requestRef: Id }),
]);
export type WithdrawalDetailResultValue = z.infer<typeof WithdrawalDetailResult>;

// ======================================================================================
// WU03 S1 — staff outcome SIMULATION + period preview + gateway status (additive)
//
// Reuse-first: outcomes reuse the WU02 request/transition graph/conservation; periods reuse
// PeriodReference + WithdrawalPeriodLink; the gateway is a static truthful config. No money
// arithmetic, no native approval/schedule fields, no beneficiary config (that slice is separate).
// ======================================================================================

// ---- A4. Staff outcome SIMULATION (explicitly synthetic; scope + money-revision bound) ----
//
// `reconciling` is the "unknown" outcome (reserve retained). The command binds the full scope, the
// request reference and the money (summary) revision; the dev controller additionally fences a reset
// captured across the transport delay so a pre-reset command can never mutate post-reset state.
export const WithdrawalOutcomeTarget = z.enum(['processing', 'paid', 'failed', 'reconciling']);
export type WithdrawalOutcomeTargetValue = z.infer<typeof WithdrawalOutcomeTarget>;

export const WithdrawalOutcomeSimCommand = z.strictObject({
  scope: WithdrawalScope,
  requestRef: Id,
  expectedRevision: Id, // == summary/money revision (seq-based)
  target: WithdrawalOutcomeTarget,
});
export type WithdrawalOutcomeSimCommandValue = z.infer<typeof WithdrawalOutcomeSimCommand>;

export const OutcomeSimRejectCode = z.enum([
  'not_found',
  'scope_mismatch',
  'permission_mismatch',
  'payer_mismatch',
  'scenario_mismatch',
  'stale_revision', // expectedRevision moved, OR the captured reset epoch changed during the delay
  'not_transitionable', // illegal for the current status (terminal / not a legal edge)
  'restore_unread', // store not yet readable: never mutate blindly
  'capacity_reached', // seq/timeline budget exhausted BEFORE any mutation
]);
export type OutcomeSimRejectCodeValue = z.infer<typeof OutcomeSimRejectCode>;

export const WithdrawalOutcomeSimResult = z.discriminatedUnion('outcome', [
  // `applied` carries the transitioned request — the WU02 reserve/settle projection is unchanged
  // (paid settles gross once; failed/cancelled release once; reconciling retains).
  z.strictObject({ outcome: z.literal('applied'), request: WithdrawalRequest }),
  z.strictObject({
    outcome: z.literal('rejected'),
    scope: WithdrawalScope,
    requestRef: Id,
    code: OutcomeSimRejectCode,
    detail: z.string().min(1).max(300),
  }),
]);
export type WithdrawalOutcomeSimResultValue = z.infer<typeof WithdrawalOutcomeSimResult>;

// ---- A5. Period preview view (actual scenario fields only; releasable != released) --------
//
// An eligible prior period that has NOT been released yet: its amount is `eligibleAmount` (never
// mislabeled "released"). Releasing it adds to the accumulated pool ONCE and is NOT a transfer.
export const WithdrawalReleasablePeriod = z.strictObject({
  periodId: Id,
  label: z.string().min(1).max(140),
  eligibleAmount: NonNegativeMoney,
});
export type WithdrawalReleasablePeriodValue = z.infer<typeof WithdrawalReleasablePeriod>;

// Honest release-pool provenance. `released[]` reuses WithdrawalPeriodLink, whose `releasedAt` MAY
// be null (v1-upgraded legacy honesty — the loader must accept null). No generation/approval/review/
// count/schedule placeholders. `currentPeriodPending` may be null (unknown) — never a guessed 0.
export const WithdrawalPeriodsView = z.strictObject({
  scope: WithdrawalScope,
  asOf: Instant,
  currentPeriod: PeriodReference.nullable(),
  currentPeriodPending: Money.nullable(),
  released: z.array(WithdrawalPeriodLink).max(30),
  releasable: z.array(WithdrawalReleasablePeriod).max(30),
  revision: Id,
});
export type WithdrawalPeriodsViewValue = z.infer<typeof WithdrawalPeriodsView>;

// ---- A6. Gateway configuration status (static trusted config; NOT a scope-echoing read) ----
//
// WU03 emits ONLY `not_connected`: no secrets, provider selector, activation, retry-transfer or
// approval layer. It is a global dev config, so it truthfully carries no scope/revision/asOf and is
// exposed as a static value (see the feature model), never via the scope-gated transport.
export const WithdrawalGatewayStatus = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('not_connected'), reasons }),
]);
export type WithdrawalGatewayStatusValue = z.infer<typeof WithdrawalGatewayStatus>;

// ======================================================================================
// WU03 S2 — shared editable payout beneficiary (fixed synthetic catalog; data-minimised)
//
// The actor edits a payee NAME and picks a bank + account from a FIXED synthetic catalog; the seam
// resolves the mask from the catalog. No raw account number / credentials / provider ever exist in
// any command/read/store/URL/snapshot/cache. Save -> pending; only an isolated DEV control enables
// verified. Config has its OWN self-versioned revision (unaffected by money); the quote-binding
// beneficiaryVersion derives from the SAME committed config version (see the dev controller).
// ======================================================================================

// ---- A1. Fixed synthetic bank/account catalog (masked labels only) --------------------
export const BeneficiaryBankOption = z.strictObject({
  bankId: Id,
  bankLabel: z.string().min(1).max(80),
});
export type BeneficiaryBankOptionValue = z.infer<typeof BeneficiaryBankOption>;
export const BeneficiaryAccountOption = z.strictObject({
  accountChoiceId: Id,
  maskedAccount: z.string().min(1).max(40), // e.g. 'XXX-X-X1234-5' — a masked LABEL, never a full number
});
export type BeneficiaryAccountOptionValue = z.infer<typeof BeneficiaryAccountOption>;
export const BeneficiaryCatalog = z.strictObject({
  banks: z.array(BeneficiaryBankOption).min(1).max(20),
  accounts: z.array(BeneficiaryAccountOption).min(1).max(20),
});
export type BeneficiaryCatalogValue = z.infer<typeof BeneficiaryCatalog>;

// ---- A2. Scoped beneficiary configuration read (powers the reusable editor) ------------
//
// DEMO readiness vocabulary. `verified` maps to the summary's `known` (ready masked); the WU01
// PayoutBeneficiary summary union is untouched. `unavailable` is a RUNTIME read state for a
// PRESENT-but-invalid/unreadable/foreign-scope config — it BLOCKS new quotes/submits (fail-closed)
// and is NEVER a fixture fallback. `revision` is the config's OWN version (write concurrency token),
// unaffected by money mutations.
export const PayoutBeneficiaryConfig = z.strictObject({
  scope: WithdrawalScope,
  revision: Id,
  state: z.enum(['missing', 'pending', 'verified', 'unavailable']),
  displayName: z.string().min(1).max(140).nullable(),
  bankId: Id.nullable(),
  bankLabel: z.string().min(1).max(80).nullable(),
  accountChoiceId: Id.nullable(),
  maskedAccount: z.string().min(1).max(40).nullable(), // resolved mask; NEVER a full number
  reasons,
  catalog: BeneficiaryCatalog,
  allowedEdit: z.boolean(),
});
export type PayoutBeneficiaryConfigValue = z.infer<typeof PayoutBeneficiaryConfig>;

// ---- A3. Beneficiary save (catalog choice + payee name; revision-bound; idempotent) ----
export const SetPayoutBeneficiaryCommand = z.strictObject({
  scope: WithdrawalScope,
  expectedRevision: Id, // == PayoutBeneficiaryConfig.revision (late-conflict fence)
  idempotencyKey: Id, // same-key replay -> `unknown` (no write); a fresh key -> `saved` (pending)
  displayName: z.string().min(1).max(140), // whitespace-only is rejected by the controller (invalid_name)
  bankId: Id, // must be in the catalog
  accountChoiceId: Id, // must be in the catalog
});
export type SetPayoutBeneficiaryCommandValue = z.infer<typeof SetPayoutBeneficiaryCommand>;

export const SetBeneficiaryRejectCode = z.enum([
  'scope_mismatch',
  'permission_mismatch',
  'payer_mismatch',
  'scenario_mismatch',
  'stale_revision', // expectedRevision moved OR the captured reset epoch changed during the delay
  'invalid_name', // whitespace-only / blank payee name
  'unknown_bank', // bankId not in the catalog
  'unknown_account', // accountChoiceId not in the catalog
  'restore_unread', // money-store state not yet readable: never write blindly
  'capacity_reached', // config-version budget exhausted BEFORE any write
  'config_unavailable', // present-but-invalid/unreadable/foreign config: never overwrite its bytes
]);
export type SetBeneficiaryRejectCodeValue = z.infer<typeof SetBeneficiaryRejectCode>;

// A save either commits a FRESH `pending` config (saved) or is uncertain (`unknown` — the caller
// re-reads the authoritative config and NEVER assumes success/verified) or `rejected` (no write).
// A same-key replay returns `unknown` (no write); `saved` STRICTLY means a fresh pending mutation.
export const SetPayoutBeneficiaryResult = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('saved'),
    scope: WithdrawalScope,
    idempotencyKey: Id,
    config: PayoutBeneficiaryConfig, // pending, new revision
  }),
  z.strictObject({
    outcome: z.literal('unknown'),
    scope: WithdrawalScope,
    idempotencyKey: Id,
    expectedRevision: Id,
  }),
  z.strictObject({
    outcome: z.literal('rejected'),
    scope: WithdrawalScope,
    idempotencyKey: Id,
    expectedRevision: Id,
    code: SetBeneficiaryRejectCode,
    detail: z.string().min(1).max(300),
  }),
]);
export type SetPayoutBeneficiaryResultValue = z.infer<typeof SetPayoutBeneficiaryResult>;

// Re-export the shared reasons list bound so the model/UI can size fields identically.
export { BalanceScope, BalanceSnapshot, NonNegativeMoney, BlockingReason, WithdrawalReadinessResult };
