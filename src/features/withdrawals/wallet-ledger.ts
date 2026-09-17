import type { MoneyValue } from '@/contracts/common';
import type {
  WithdrawalPeriodLinkValue,
  WithdrawalRequestValue,
} from '@/contracts/withdrawal-journey';

// Feature-local, PRESENTATION-ONLY wallet ledger helper. It maps the two AUTHORITATIVE reads —
// `WithdrawalPeriodsView.released[]` (money-in release credits) and `WithdrawalList.items[]`
// (money-out withdrawals) — into a single discriminated, stably-identified, date-descending list a
// bank-style history card can render. It performs NO money arithmetic and NEVER derives a balance:
// the withdrawable balance stays the authoritative `summary.balance.available`. It also never
// fabricates a credit row or a zero — an absent lane simply contributes nothing (each lane can be
// independently unavailable and the UI decides how to render that).
//
// Identities are stable and kind-prefixed so they survive refetches: a release is `release:${periodId}`
// and a withdrawal is `withdrawal:${requestRef}`. Release and withdrawal ids live in disjoint
// namespaces, so a released credit and a withdrawal that spent it can never collapse into one row.

export interface WalletReleaseEntry {
  kind: 'release';
  id: string;
  periodId: string;
  label: string;
  // MAY be null for a v1-migrated release — kept UNKNOWN (never coerced to today), and such a row is
  // routed to the `undatedReleases` bucket rather than dropped or forced into a dated range.
  releasedAt: string | null;
  // MAY be null (unknown) — never a fabricated 0.
  releasedAmount: MoneyValue | null;
  // Provenance only. The removed partner statement page is gone; the UI must NOT deep-link this.
  statementId: string | null;
}

export interface WalletWithdrawalEntry {
  kind: 'withdrawal';
  id: string;
  // submittedAt — a withdrawal always carries a submission instant, so it is always dated.
  at: string;
  request: WithdrawalRequestValue;
}

export type WalletLedgerEntry = WalletReleaseEntry | WalletWithdrawalEntry;

export interface WalletLedgerInput {
  // Omit or pass null for a lane that is currently unavailable (a read error / not-yet-loaded). The
  // helper then simply produces no rows for that lane; it never invents an empty "no credits" claim.
  released?: readonly WithdrawalPeriodLinkValue[] | null;
  withdrawals?: readonly WithdrawalRequestValue[] | null;
}

export interface WalletLedgerResult {
  // Entries with a KNOWN effective date, sorted date DESCENDING. Ties break by a stable secondary key
  // (kind, then id) so identities are stable across refetches of the same data.
  dated: WalletLedgerEntry[];
  // Release credits whose `releasedAt` is null (unknown date). Preserved and stable (ordered by id),
  // shown by the UI in a distinct "no date from source" bucket — never date-filtered away.
  undatedReleases: WalletReleaseEntry[];
}

function releaseEntryOf(link: WithdrawalPeriodLinkValue): WalletReleaseEntry {
  return {
    kind: 'release',
    id: `release:${link.periodId}`,
    periodId: link.periodId,
    label: link.label,
    releasedAt: link.releasedAt,
    releasedAmount: link.releasedAmount,
    statementId: link.statementId,
  };
}

function withdrawalEntryOf(request: WithdrawalRequestValue): WalletWithdrawalEntry {
  return {
    kind: 'withdrawal',
    id: `withdrawal:${request.requestRef}`,
    at: request.submittedAt,
    request,
  };
}

// The effective ordering instant of a dated entry (a withdrawal's submittedAt or a release's
// releasedAt). Only dated entries reach this comparator.
function effectiveMs(entry: WalletLedgerEntry): number {
  const at = entry.kind === 'withdrawal' ? entry.at : entry.releasedAt;
  const ms = at === null ? NaN : Date.parse(at);
  return Number.isFinite(ms) ? ms : NaN;
}

// Stable descending compare: later date first; equal dates break by kind (release before withdrawal)
// then by id, so a same-scope refetch always yields the identical order.
function compareDatedDesc(a: WalletLedgerEntry, b: WalletLedgerEntry): number {
  const am = effectiveMs(a);
  const bm = effectiveMs(b);
  if (am !== bm) return bm - am;
  if (a.kind !== b.kind) return a.kind === 'release' ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildWalletLedger(input: WalletLedgerInput): WalletLedgerResult {
  const dated: WalletLedgerEntry[] = [];
  const undatedReleases: WalletReleaseEntry[] = [];

  for (const link of input.released ?? []) {
    const entry = releaseEntryOf(link);
    // Unknown release date stays unknown and is preserved in its own bucket (never coerced to today).
    if (entry.releasedAt === null || !Number.isFinite(Date.parse(entry.releasedAt)))
      undatedReleases.push(entry);
    else dated.push(entry);
  }
  for (const request of input.withdrawals ?? []) dated.push(withdrawalEntryOf(request));

  dated.sort(compareDatedDesc);
  undatedReleases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { dated, undatedReleases };
}

// ---- Bangkok date range -------------------------------------------------------------

export interface WalletDateRange {
  from: string; // Instant (Bangkok midnight, inclusive lower bound)
  toExclusive: string; // Instant (Bangkok midnight, exclusive upper bound)
}

export interface WalletDefaultRange extends WalletDateRange {
  displayedFromDate: string; // 'YYYY-MM-DD' Bangkok, inclusive start
  displayedToInclusiveDate: string; // 'YYYY-MM-DD' Bangkok, inclusive end (== today)
}

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

// Format a UTC-day (Date.UTC value) as a Bangkok wall-clock midnight Instant string.
function bangkokMidnight(dayUtcMs: number): string {
  const d = new Date(dayUtcMs);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${mo}-${day}T00:00:00+07:00`;
}
function bangkokDate(dayUtcMs: number): string {
  const d = new Date(dayUtcMs);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// The default displayed range: today back 7 Bangkok calendar days through today INCLUSIVE (8 calendar
// dates). Internally the inclusive end is expressed as a half-open `toExclusive` = tomorrow
// 00:00+07:00. `now` is injected (never Date.now internally) so callers/tests stay deterministic.
export function defaultWalletDateRange(now: Date): WalletDefaultRange {
  const shifted = new Date(now.getTime() + BKK_OFFSET_MS);
  const todayUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const fromUtc = todayUtc - 7 * 86_400_000;
  const tomorrowUtc = todayUtc + 86_400_000;
  return {
    from: bangkokMidnight(fromUtc),
    toExclusive: bangkokMidnight(tomorrowUtc),
    displayedFromDate: bangkokDate(fromUtc),
    displayedToInclusiveDate: bangkokDate(todayUtc),
  };
}

// Half-open Bangkok filter over DATED entries only: keep `from <= at < toExclusive`. Undated releases
// are never passed here (they carry no date to compare) — the UI keeps them in their own bucket.
export function filterWalletLedgerByRange(
  entries: readonly WalletLedgerEntry[],
  range: WalletDateRange,
): WalletLedgerEntry[] {
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.toExclusive);
  return entries.filter((entry) => {
    const ms = effectiveMs(entry);
    if (!Number.isFinite(ms)) return false; // an undated entry is never forced into a dated range
    return ms >= fromMs && ms < toMs;
  });
}
