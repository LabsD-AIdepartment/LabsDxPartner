// Development-only authored dataset for the cross-page "partner-demo" story. Every amount is
// authored data in integer satang (THB minor). This module produces NORMALIZED raw records only;
// it never states a display total. All totals are computed later by ./projections from these rows.
//
// The story is the accepted ready/demo-financials sample SCALED ×10 so the owner magnitudes hold:
//   • closed Jul–Aug eligible sales  = 5,500,000 THB  (550,000,000 satang)
//   • closed Jul–Aug confirmed comm. =   373,600 THB  ( 37,360,000 satang)  ← the released pool
//   • Organic lines 10% (rate_ppm 100000), Brand-ads lines 3% (rate_ppm 30000) — exact, per line.
//   • September (open) confirmed daily records on EVERY Bangkok day Sep-01..anchor (UNRELEASED, never a
//     zero day — owner steering), plus separate estimated rows (never withdrawable). The 13–25k THB per-day
//     band describes the LEGACY g1..g5 authored grid; g6 redistributes each clip's September aggregate
//     across its own days, so an individual g6 day may fall outside that band (up to ~28k THB) while the
//     full-September per-clip/channel/status/platform totals and eligible bases stay identical to g5.
//   • four prior PAID withdrawals of 25,000 THB (all settled AFTER the Sep-01 statement release)
//     + one pending 25,000 reserved (submitted after the last paid, before the anchor).
//
// Content ids are the STABLE `clip-1`…`clip-6` / `clip-sep-1`/`clip-sep-2` and the statement id is
// `statement-1`, so the verified ad-sample binding (applyAdSample keys clip-3 / clip-sep-2) and the
// notification/statement links never break. a/b and generations are isolated by the datasetId +
// generation COLUMNS (and by a datasetId-prefixed primary-key `id`), never by prefixing content ids.
//
// Nothing here imports product code, so it can never contaminate the app bundle or the live schema.

import { z } from 'zod';

// A unique marker embedded in this development-only module. It is baked into authored data (the meta
// note) AND into the validator's error prefix so that, should this dev module ever be bundled into a
// production browser build, `scripts/verify-no-demo.mjs` (assertNoProductionFixtures) detects the
// leak. Never remove or rename without updating the marker list in that script.
export const DEMO_DATASET_MARKER = 'synthetic-demo-dataset-snapshot';

export type Minor = string; // integer satang, as a decimal string (BigInt-exact)
export interface Money {
  currency: 'THB';
  minor: Minor;
}
export const thb = (n: bigint): Money => ({ currency: 'THB', minor: n.toString() });

export type Channel = 'organic' | 'brand_ads';
export type Platform = 'facebook' | 'tiktok' | 'shopee' | 'lazada' | 'web' | 'unattributed';
export type EarningStatus = 'confirmed' | 'estimated';
export type WithdrawalStatus =
  | 'requested'
  | 'processing'
  | 'reconciling'
  | 'paid'
  | 'failed'
  | 'cancelled';

export interface EarningRow {
  id: string;
  datasetId: string;
  generation: string;
  sourceRef: string;
  contentId: string;
  channel: Channel;
  ratePpm: number;
  earnedDate: string; // YYYY-MM-DD (Bangkok calendar date)
  status: EarningStatus;
  released: boolean; // part of the withdrawable released pool
  eligibleBaseMinor: Minor;
  amountMinor: Minor;
  kind: 'commission';
  attribution: 'content' | 'partner-only';
}
export interface AllocationRow {
  id: string;
  datasetId: string;
  generation: string;
  sourceRef: string;
  platform: Platform;
  weight: number;
}
export interface ClipRow {
  id: string;
  datasetId: string;
  generation: string;
  contentId: string;
  title: string;
  brand: string;
  publishedDate: string; // YYYY-MM-DD
  cover: string;
  coverPosition: string;
  // Audience view counts are never presented publicly. The authored/stored rows carry a real integer,
  // but the dev endpoint masks it to `null` in the serialized copy, so the public schema accepts either.
  views: number | null;
  removed: boolean;
  adBound: boolean;
}
export interface StatementRow {
  id: string;
  datasetId: string;
  generation: string;
  statementId: string;
  version: string;
  periodFrom: string; // ISO
  periodToExcl: string; // ISO
  publishedAt: string; // ISO
  settlementAsOf: string; // ISO
  status: string;
  openingMinor: Minor;
  adjustmentsMinor: Minor;
}
export interface SettlementRow {
  id: string;
  datasetId: string;
  generation: string;
  statementId: string;
  settlementId: string;
  reference: string;
  recordedAt: string; // ISO
  cashMinor: Minor;
  withholdingMinor: Minor;
  otherMinor: Minor;
  obligationSettledMinor: Minor;
  withdrawalRef: string | null;
}
export interface WithdrawalRow {
  id: string;
  datasetId: string;
  generation: string;
  requestRef: string;
  idempotencyKey: string;
  grossMinor: Minor;
  netMinor: Minor;
  status: WithdrawalStatus;
  submittedAt: string; // ISO
  paidAt: string | null; // ISO or null
  beneficiaryName: string;
  bankName: string;
  maskedAccount: string;
}
export interface DeductionRow {
  id: string;
  datasetId: string;
  generation: string;
  requestRef: string;
  kind: string;
  label: string;
  amountMinor: Minor;
}
// D168 — additive synthetic full-account reveal record. It binds a FULL FICTITIOUS account number to a
// masked beneficiary identity (name + bank + mask), for the optional withdrawal-summary eye reveal only.
// It is explicitly marked `synthetic` and is NEVER folded into a withdrawal/quote/CSV/masked field. The
// mask must be mechanically consistent with the full number (see maskCoversFullAccount). Absent for old
// generations/old databases, so those simply expose no reveal (fail-closed, no fake fallback).
export interface BeneficiaryAccountRow {
  id: string;
  datasetId: string;
  generation: string;
  beneficiaryName: string;
  bankName: string;
  maskedAccount: string;
  fullAccount: string; // digits only; a fictitious number for a synthetic demo bank
  synthetic: true;
}
export interface MetaRow {
  datasetId: string;
  generation: string;
  asOf: string; // ISO (Bangkok, second precision, +07:00)
  timezone: 'Asia/Bangkok';
  anchorDate: string; // YYYY-MM-DD (latest-7 anchor = seed clock Bangkok "today")
  note: string;
}

export interface DatasetRecords {
  meta: MetaRow;
  earnings: EarningRow[];
  allocations: AllocationRow[];
  clips: ClipRow[];
  statements: StatementRow[];
  settlements: SettlementRow[];
  withdrawals: WithdrawalRow[];
  deductions: DeductionRow[];
  // Additive/optional (defaults []): old datasets/databases predate it and stay fully compatible.
  beneficiaryAccounts?: BeneficiaryAccountRow[];
}

// Allowlisted dataset ids per preview identity (a/b). The generation is server-owned.
export const DATASET_IDS = { a: 'partner-demo-a', b: 'partner-demo-b' } as const;
export const DEFAULT_DATASET_ID = DATASET_IDS.a;
// g1/g2 are already immutable in SQLite; g3 is the never-zero-commission demo generation; g4 adds the
// synthetic KBank reveal. g5 (D169) keeps ALL of g4's financial facts + KBank account but stores a
// realistic NUMERIC withdrawal reference instead of the legacy code. g6 (D183) inherits EVERY g5 fact
// verbatim (g5 numeric refs + KBank beneficiary/reveal + every closed Jul–Aug row + the September
// estimated rows) and changes ONLY the September confirmed per-day commission amounts: instead of the
// 7-day repeating `SEPT_PATTERN_THB[offset%7]`, each existing clip's September confirmed aggregate is
// deterministically REDISTRIBUTED across that clip's own September days by an absolute-date weight
// (largest-remainder), so the Daily Clip Earnings weekly chart shows a DISTINCT shape per navigated week
// instead of an identical repeat. Per-DATE September confirmed amounts and any sub-period (e.g. single-week)
// projection INTENTIONALLY change versus g5 — that is the whole point of the redistribution. What stays
// preserved is narrower: the FULL-September per-clip / per-channel / per-status / per-platform confirmed
// totals (322,000 THB), the corresponding FULL-PERIOD eligible bases, and every closed Jul–Aug and
// non-earning record (statuses, releases, dates, IDs, sources, rates, withdrawals, statements, settlements,
// beneficiary/reveal). D183: root has independently reviewed the generator, seeded + audited g6 for both
// identities (same 2026-09-17T10:26:10+07:00 seed clock) with old generation row hashes and non-financial
// facts unchanged, so the dev default is now g6. The previous g5 remains seeded/immutable and retained.
// g7 adds Sep-18 to the approved frozen Sep-17 story; g6 remains immutable.
// g8 varies sample withdrawals while preserving paid/reserved totals and all g7 earnings.
export const DEFAULT_GENERATION = 'g8';
// Retained statement id (reconciles the notification/return links and the readyScenario id name).
export const CLOSED_STATEMENT_ID = 'statement-1';
export const CLOSED_PERIOD = {
  from: '2026-07-01T00:00:00+07:00',
  toExclusive: '2026-09-01T00:00:00+07:00',
};
// The OPEN (current) period this dataset narrates. A seed clock outside it is rejected unless the
// caller explicitly authors a different valid current period (correction #4 — no fabricated future
// coverage, no story drift into another month).
export const OPEN_PERIOD = {
  from: '2026-09-01',
  toExclusive: '2026-10-01',
};

// ---- Bangkok date/instant helpers (no client-side date shifting: fixed from the seed clock) ------

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
/** The Bangkok calendar date (YYYY-MM-DD) for an absolute instant. */
export function bangkokDate(ms: number): string {
  return new Date(ms + BKK_OFFSET_MS).toISOString().slice(0, 10);
}
/** A Bangkok second-precision instant (YYYY-MM-DDTHH:MM:SS+07:00) — never `.mmmZ` (correction #3). */
export function bangkokInstant(ms: number): string {
  return new Date(ms + BKK_OFFSET_MS).toISOString().slice(0, 19) + '+07:00';
}
/** Add (or subtract) whole days to a YYYY-MM-DD date string, staying on calendar days. */
export function addDays(date: string, delta: number): string {
  const ms = Date.parse(date + 'T00:00:00Z') + delta * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
/** Noon-Bangkok ISO for a calendar date (a stable within-day instant for authored rows). */
function bkkNoon(date: string): string {
  return `${date}T12:00:00+07:00`;
}

// ---- Authored story constants (satang) -----------------------------------------------------------

// Closed Jul–Aug confirmed commission clips (ready sample × 10). Even index = Organic (10%), odd =
// Brand ads (3%). Each clip's commission TOTAL (satang) is redistributed across every assigned daily
// date in Jul-01..Aug-31 (62 days, round-robin dayIndex % 6), so NO calendar day is ever a
// zero-earning day (owner steering). Per-clip totals, channels, and the 373,600 THB released pool are
// unchanged. Organic splits in 1-satang units; Brand-ads in 3-satang units so eligibleBase =
// amount × 1e6 / rate stays an exact integer on every single day.
const CLOSED = [
  { total: 12_800_000n, channel: 'organic' as Channel, brand: 'Axtion' },
  { total: 3_120_000n, channel: 'brand_ads' as Channel, brand: 'Axtion' },
  { total: 9_600_000n, channel: 'organic' as Channel, brand: 'Tendrix' },
  { total: 2_580_000n, channel: 'brand_ads' as Channel, brand: 'Rusiren' },
  { total: 7_400_000n, channel: 'organic' as Channel, brand: 'Melura' },
  { total: 1_860_000n, channel: 'brand_ads' as Channel, brand: 'Zenova' },
];

// The closed Jul–Aug daily grid: Jul-01 is dayIndex 0; 62 consecutive calendar days reach Aug-31.
const CLOSED_START = '2026-07-01';
const CLOSED_DAYS = 62; // July (31) + August (31)
// Split-unit per channel so every daily amount keeps eligibleBase = amount×1e6/rate integral:
// organic (rate 100000) → base = amount×10 for any 1-satang amount; brand_ads (rate 30000) → base =
// amount×100/3, integral only when amount is a multiple of 3 satang.
const CHANNEL_UNIT: Record<Channel, bigint> = { organic: 1n, brand_ads: 3n };

// September (open period) confirmed daily commission in THB, keyed by day-offset back from the anchor
// ("today") and repeating every 7 days as [offset % 7]. NO entry is zero (offset 5 = 16,000), so the
// latest-7 view and every earlier September day both stay strictly positive. All Organic (10%) so the
// base stays integral and the Organic rate remains exactly 100000. Latest-7 (offsets 0..6) = 133,000;
// Sep-01..Sep-17 (17 days) = 322,000 THB.
const SEPT_PATTERN_THB = [25000, 13000, 18000, 22000, 15000, 16000, 24000];

// D183 — generations whose September confirmed daily amounts are REDISTRIBUTED (per clip) off the
// repeating 7-day `SEPT_PATTERN_THB` grid so the weekly Daily Clip Earnings chart shows a distinct shape
// per navigated week. The redistribution NEVER touches the closed Jul–Aug rows, the September estimated
// rows, or any non-earning fact — only the per-day confirmed `amount` (and its derived eligibleBase).
const SEPT_REDISTRIBUTED_GENERATIONS = new Set<string>(['g6']);

// A fixed, authored weight per Bangkok day-of-month (1..31), used ONLY by the September redistribution.
// It is an ABSOLUTE-date function (never window-relative), so the same frozen dataset yields the same day
// amounts under every overlapping query. The values form a deterministic non-7-periodic wave, so two
// adjacent weeks (e.g. Sep 4–10 vs Sep 11–17) receive genuinely different daily shapes rather than a
// repeat. Every entry is a positive integer, so a clip day can never be weighted to zero.
const SEPT_DAY_WEIGHT: Record<number, number> = {
  1: 12, 2: 15, 3: 11, 4: 17, 5: 13, 6: 19, 7: 10, 8: 16, 9: 14, 10: 20,
  11: 12, 12: 18, 13: 15, 14: 11, 15: 17, 16: 13, 17: 19, 18: 14, 19: 16, 20: 12,
  21: 20, 22: 15, 23: 11, 24: 18, 25: 13, 26: 17, 27: 14, 28: 19, 29: 12, 30: 16, 31: 15,
};

/**
 * The September confirmed daily commission amount (SATANG) keyed by anchor-relative day offset
 * (0..septSpanDays). For legacy generations this is exactly `SEPT_PATTERN_THB[offset%7] × 100`.
 *
 * For a redistributed generation (g6) the SAME per-clip grouping (offset % 6) and the SAME per-clip
 * September aggregate are preserved, but each clip's whole-baht aggregate is spread across ITS OWN
 * September days by an absolute-date weight using exact-integer largest-remainder allocation:
 *   • the aggregate is preserved EXACTLY (Σ redistributed == Σ legacy) per clip and overall (322,000 THB
 *     at the Sep-17 anchor), so eligible bases, allocation-platform totals and every downstream projection
 *     are unchanged for the same input;
 *   • every day is strictly positive whole baht (the floor of a large aggregate over ≤5 modest weights
 *     never rounds to zero), so no calendar day is ever a zero-earning day;
 *   • it is deterministic and absolute-date-only — no randomness, no window-relative math — so overlapping
 *     window queries of the same frozen dataset always return identical per-day values;
 *   • a clip with a single September day (e.g. early anchors) simply keeps that day's whole aggregate.
 */
function septemberDailyAmountsSatang(
  generation: string,
  septSpanDays: number,
  anchorDate: string,
): Map<number, bigint> {
  const legacySatang = (offset: number): bigint => BigInt(SEPT_PATTERN_THB[offset % 7]) * 100n;
  const result = new Map<number, bigint>();
  if (!SEPT_REDISTRIBUTED_GENERATIONS.has(generation)) {
    for (let offset = 0; offset <= septSpanDays; offset++) result.set(offset, legacySatang(offset));
    return result;
  }

  // Group offsets by their existing clip (offset % 6) — the redistribution stays WITHIN each clip.
  const offsetsByClip = new Map<number, number[]>();
  for (let offset = 0; offset <= septSpanDays; offset++) {
    const clip = offset % 6;
    const list = offsetsByClip.get(clip);
    if (list) list.push(offset);
    else offsetsByClip.set(clip, [offset]);
  }

  for (const offsets of offsetsByClip.values()) {
    // The clip's September aggregate in WHOLE BAHT (legacy amounts are exact whole-THB grid values).
    const totalTHB = offsets.reduce((t, o) => t + BigInt(SEPT_PATTERN_THB[o % 7]), 0n);
    // Weight each of the clip's days by the ABSOLUTE calendar day-of-month (earnedDate = anchor − offset).
    const days = offsets.map((offset) => {
      const date = addDays(anchorDate, -offset);
      return { offset, date, weight: BigInt(SEPT_DAY_WEIGHT[Number(date.slice(8, 10))]) };
    });
    const weightSum = days.reduce((t, d) => t + d.weight, 0n);
    // Exact-integer largest-remainder: base = floor(total × w / Σw); the whole-baht remainder is handed
    // out 1 THB at a time to the largest fractional parts (ties → earlier absolute date), so Σ == totalTHB.
    const parts = days.map((d) => {
      const numer = totalTHB * d.weight;
      return { ...d, baseTHB: numer / weightSum, rem: numer % weightSum };
    });
    let leftover = totalTHB - parts.reduce((t, p) => t + p.baseTHB, 0n);
    const bumpOrder = [...parts].sort((a, b) =>
      a.rem !== b.rem ? (a.rem > b.rem ? -1 : 1) : a.date < b.date ? -1 : 1,
    );
    const bumped = new Set<number>();
    for (let i = 0; i < bumpOrder.length && leftover > 0n; i++, leftover -= 1n)
      bumped.add(bumpOrder[i].offset);
    for (const p of parts)
      result.set(p.offset, (p.baseTHB + (bumped.has(p.offset) ? 1n : 0n)) * 100n); // THB → satang
  }
  return result;
}

// September estimated commission (never withdrawable), keyed anchor-relative so it is ALWAYS on/before
// the anchor (never future) and inside the open period for a September seed. clip-sep-2 (Tendrix)
// carries the verified graphic ad sample via applyAdSample.
const SEPT_ESTIMATED = [
  { offset: 5, amount: 4_000_000n, channel: 'organic' as Channel, brand: 'Axtion' }, // 40,000 base
  { offset: 2, amount: 3_000_000n, channel: 'brand_ads' as Channel, brand: 'Tendrix' }, // 100,000 base
];

const RATE_PPM: Record<Channel, number> = { organic: 100000, brand_ads: 30000 };
const eligibleBase = (amount: bigint, channel: Channel): bigint =>
  (amount * 1_000_000n) / BigInt(RATE_PPM[channel]);

// Closed-source synthetic platform allocation (mirrors the accepted overview weights). Every source
// carries a fully NAMED platform allocation so no earnings source falls back to an 'unattributed'
// subtotal — matching the accepted UI, which excludes unattributed rows (owner D142, preserved).
const CLOSED_ALLOC: Platform[][] = [
  ['facebook', 'facebook', 'facebook', 'tiktok', 'tiktok'], // 3:2
  ['tiktok', 'shopee'], // 1:1
  ['shopee', 'shopee', 'lazada'], // 2:1
  ['lazada', 'lazada', 'lazada', 'web', 'web'], // 3:2
  ['web', 'facebook'], // 1:1
  ['web'], // closed source 6 → named 'web' allocation (no unattributed fallback)
];
const SEPT_PLATFORM: Platform[] = ['facebook', 'tiktok', 'shopee', 'lazada', 'web', 'facebook'];
// September estimated sources carry a named allocation too: sale-sep-1 + sale-sep-2 → facebook.
const SEPT_ESTIMATED_PLATFORM: Platform[] = ['facebook', 'facebook'];

const CLIP_META = [
  { title: 'พูดตรง ๆ ตัวนี้ช่วยให้เช้าวันทำงานง่ายขึ้น', cover: '/media/clip-cover-1.png' },
  { title: '3 นาทีหลังตื่นนอน กับ routine ที่ทำให้สดชื่น', cover: '/media/clip-cover-2.png' },
  { title: 'ลองให้ดูแบบไม่สปอนเซอร์ ถ้าไม่ดีก็ไม่พูด', cover: '/media/clip-cover-3.png' },
  { title: 'ของดีบอกต่อ เปิดกล่องแล้วชอบตรงไหน', cover: '/media/clip-cover-4.png' },
  { title: 'รีวิวแบบคนใช้จริง ดูผิวในแสงธรรมชาติ', cover: '/media/clip-cover-5.png' },
  { title: 'ตัวเดียวจบสำหรับวันที่ต้องออกกอง', cover: '/media/clip-cover-6.png' },
];

// The approved synthetic beneficiary, consistent across every request snapshot (never a real bank).
// This is the DEFAULT (used by g1–g3); the effective beneficiary is chosen PER GENERATION below so an
// old generation keeps its old bank even if the default later moves (data ownership, not one global const).
export const DEMO_BENEFICIARY = {
  beneficiaryName: 'บริษัท ตัวอย่าง จำกัด',
  bankName: 'ธนาคารตัวอย่าง',
  maskedAccount: 'XXX-X-X1234-5',
} as const;

// D168 — g4 uses a realistic named bank plus a FULL FICTITIOUS account number for the eye reveal. The
// mask 'XXX-X-X1234-5' is mechanically consistent with the full number (its visible trailing digits are
// 1-2-3-4-5, i.e. the last five of 1234512345). Synthetic only — never a real ธนาคารกสิกรไทย account.
export const DEMO_BENEFICIARY_G4 = {
  beneficiaryName: 'บริษัท ตัวอย่าง จำกัด',
  bankName: 'ธนาคารกสิกรไทย',
  maskedAccount: 'XXX-X-X1234-5',
  fullAccount: '1234512345',
} as const;

// Per-generation beneficiary ownership. A generation that carries a `fullAccount` ALSO authors one
// synthetic reveal record; every other generation authors none (no eye there).
interface GenerationBeneficiary {
  beneficiaryName: string;
  bankName: string;
  maskedAccount: string;
  fullAccount?: string;
}
const GENERATION_BENEFICIARY: Record<string, GenerationBeneficiary> = {
  g4: DEMO_BENEFICIARY_G4,
  // D169 — g5 is the numeric-reference generation. It intentionally reuses g4's synthetic KBank
  // beneficiary AND full account verbatim, so the beneficiary summary, request snapshots and the eye
  // reveal are identical to g4; only the stored withdrawal requestRef scheme differs (see requestRefFor).
  g5: DEMO_BENEFICIARY_G4,
  // D183 — g6 is the September-redistribution generation. It inherits g5's synthetic KBank beneficiary +
  // full account + reveal verbatim (identical bank/mask/number on every withdrawal + the reveal record).
  g6: DEMO_BENEFICIARY_G4,
};
export function beneficiaryForGeneration(generation: string): GenerationBeneficiary {
  return GENERATION_BENEFICIARY[generation] ?? DEMO_BENEFICIARY;
}

const WITHDRAWAL_GROSS = 2_500_000n; // 25,000.00 THB — no WHT/fee, so net == gross

// D169 — generations that store a realistic NUMERIC withdrawal reference instead of the legacy
// `${datasetId}-wr-...` code. The stored reference is `YYYYMMDD` (of the submitted Bangkok day) plus a
// 4-digit sequence that is unique across identities (a → 1001.., b → 2001..), so the same numeric ref
// can never collide across a/b. The withdrawal row.id keeps the legacy stable value, so an old bookmark
// (e.g. `partner-demo-a-wr-pending-1`) still resolves to the current stored ref via the dev alias.
// Every derived field (settlement.withdrawalRef, deductions, quoteId, idempotency) reads the STORED
// requestRef exactly as before — there is no display-side mapping.
// g6 (D183) inherits g5's numeric withdrawal-reference scheme verbatim (same YYYYMMDD + per-identity
// 4-digit sequence), so a g5→g6 activation never changes a stored reference or a bookmarked deep link.
const NUMERIC_REQUEST_REF_GENERATIONS = new Set<string>(['g5', 'g6']);
const NUMERIC_REQUEST_REF_BASE: Record<string, number> = {
  [DATASET_IDS.a]: 1001,
  [DATASET_IDS.b]: 2001,
};
function requestRefFor(
  generation: string,
  datasetId: string,
  legacyLocalId: string,
  submittedAt: string,
  seqIndex: number,
): string {
  // Legacy generations (g1–g4): the reference IS the stable local row id (datasetId-prefixed).
  if (!NUMERIC_REQUEST_REF_GENERATIONS.has(generation)) return `${datasetId}-${legacyLocalId}`;
  const day = submittedAt.slice(0, 10).replace(/-/g, ''); // YYYY-MM-DD → YYYYMMDD
  const base = NUMERIC_REQUEST_REF_BASE[datasetId] ?? 9001; // deterministic per-identity 4-digit base
  return `${day}${base + seqIndex}`;
}

export interface BuildOptions {
  datasetId?: string;
  generation?: string;
  /** The seed command clock. Its Bangkok calendar date anchors the latest-7 window. */
  asOf: Date;
  /** Override the latest-7 anchor date (tests); defaults to the Bangkok date of asOf. */
  anchorDate?: string;
  /**
   * Allow an anchor outside the authored OPEN_PERIOD (September 2569). Off by default so an unsafe
   * seed clock is rejected rather than silently narrating a stale/future period (correction #4).
   */
  allowOutOfPeriod?: boolean;
}

/**
 * Author the full normalized record set for one dataset generation. Pure: same inputs → same rows.
 */
export function buildDataset(options: BuildOptions): DatasetRecords {
  const datasetId = options.datasetId ?? DEFAULT_DATASET_ID;
  const generation = options.generation ?? DEFAULT_GENERATION;
  const asOfIso = bangkokInstant(options.asOf.getTime());
  const anchorDate = options.anchorDate ?? bangkokDate(options.asOf.getTime());

  if (generation === 'g8') {
    const previous = buildDataset({ ...options, generation: 'g7' });
    const next: DatasetRecords = {
      ...previous,
      meta: { ...previous.meta, generation },
      earnings: previous.earnings.map((row) => ({ ...row, generation })),
      allocations: previous.allocations.map((row) => ({ ...row, generation })),
      clips: previous.clips.map((row) => ({ ...row, generation })),
      statements: previous.statements.map((row) => ({ ...row, generation })),
      settlements: previous.settlements.map((row) => ({ ...row, generation })),
      withdrawals: previous.withdrawals.map((row) => ({ ...row, generation })),
      deductions: previous.deductions.map((row) => ({ ...row, generation })),
      beneficiaryAccounts: previous.beneficiaryAccounts?.map((row) => ({ ...row, generation })),
    };
    // Authored sample activity, never randomized or applied to real withdrawals.
    // Paid total remains 100,000 THB; the pending reservation remains 25,000 THB.
    const activity = [
      { amount: '1250000', submitted: '10:18', paid: '11:32' },
      { amount: '3200000', submitted: '14:42', paid: '15:18' },
      { amount: '1875000', submitted: '09:26', paid: '10:47' },
      { amount: '3675000', submitted: '16:05', paid: '13:24' },
      { amount: '2500000', submitted: '11:36', paid: null },
    ];
    next.withdrawals = next.withdrawals.map((row, index) => {
      const sample = activity[index];
      return {
        ...row,
        grossMinor: sample.amount,
        netMinor: sample.amount,
        submittedAt: `${row.submittedAt.slice(0, 10)}T${sample.submitted}:00+07:00`,
        paidAt:
          row.paidAt && sample.paid ? `${row.paidAt.slice(0, 10)}T${sample.paid}:00+07:00` : null,
      };
    });
    next.settlements = next.settlements.map((row) => {
      const withdrawal = next.withdrawals.find((item) => item.requestRef === row.withdrawalRef)!;
      return {
        ...row,
        cashMinor: withdrawal.netMinor,
        obligationSettledMinor: withdrawal.grossMinor,
        recordedAt: withdrawal.paidAt!,
      };
    });
    return next;
  }

  if (generation === 'g7') {
    // Extend the approved story rather than re-seeding its relative dates and redistributing history.
    // Earlier test/seed clocks retain their own date; the Sep-18 generation deliberately stops there.
    const extend = anchorDate >= '2026-09-18';
    if (extend && anchorDate !== '2026-09-18')
      throw new Error('g7 is authored through 2026-09-18; a later day requires a new generation');
    const previous = buildDataset({
      ...options,
      generation: 'g6',
      ...(extend ? { asOf: new Date('2026-09-17T10:26:10+07:00'), anchorDate: '2026-09-17' } : {}),
    });
    const next: DatasetRecords = {
      ...previous,
      meta: { ...previous.meta, generation, asOf: asOfIso, anchorDate },
      earnings: previous.earnings.map((row) => ({ ...row, generation })),
      allocations: previous.allocations.map((row) => ({ ...row, generation })),
      clips: previous.clips.map((row) => ({ ...row, generation })),
      statements: previous.statements.map((row) => ({ ...row, generation })),
      settlements: previous.settlements.map((row) => ({ ...row, generation })),
      withdrawals: previous.withdrawals.map((row) => ({ ...row, generation })),
      deductions: previous.deductions.map((row) => ({ ...row, generation })),
      beneficiaryAccounts: previous.beneficiaryAccounts?.map((row) => ({ ...row, generation })),
    };
    if (extend) {
      const sourceRef = 'sale-20260918';
      next.earnings.push({
        datasetId, generation, id: `${datasetId}-earning-20260918`, sourceRef,
        contentId: 'clip-2', channel: 'organic', ratePpm: RATE_PPM.organic,
        earnedDate: '2026-09-18', status: 'confirmed', released: false,
        eligibleBaseMinor: '21450000', amountMinor: '2145000',
        kind: 'commission', attribution: 'content',
      });
      next.allocations.push({
        datasetId, generation, id: `${datasetId}-alloc-20260918`, sourceRef,
        platform: SEPT_PLATFORM[1], weight: 1,
      });
    }
    return next;
  }

  // Correction #4 — reject a seed clock outside the narrated open period (unless explicitly allowed).
  if (
    !options.allowOutOfPeriod &&
    !(anchorDate >= OPEN_PERIOD.from && anchorDate < OPEN_PERIOD.toExclusive)
  )
    throw new Error(
      `buildDataset: anchor ${anchorDate} is outside the open period ${OPEN_PERIOD.from}..${OPEN_PERIOD.toExclusive}. ` +
        'Seed inside the authored current period, or author a valid current period explicitly.',
    );

  const scope = { datasetId, generation };
  const rid = (local: string) => `${datasetId}-${local}`; // datasetId-prefixed unique primary key

  const earnings: EarningRow[] = [];
  const allocations: AllocationRow[] = [];
  const clips: ClipRow[] = [];

  // Closed Jul–Aug confirmed lines (RELEASED) + their clips + platform allocations. Each day index
  // 0..61 is round-robin assigned to a clip (dayIndex % 6); a clip's commission total is spread
  // positively across ITS assigned days so no calendar day is ever zero.
  const closedDaysByClip: number[][] = [[], [], [], [], [], []];
  for (let d = 0; d < CLOSED_DAYS; d++) closedDaysByClip[d % 6].push(d);

  CLOSED.forEach((row, i) => {
    const contentId = `clip-${i + 1}`;
    const dayIdxs = closedDaysByClip[i];
    const unit = CHANNEL_UNIT[row.channel];
    const totalUnits = row.total / unit; // authored totals are exact multiples of the unit
    const n = BigInt(dayIdxs.length);
    const baseUnits = totalUnits / n; // ≥ 1 for every authored clip, so every day is positive
    const remainder = totalUnits % n; // spread the leftover 1-unit-at-a-time; total is preserved
    const alloc = CLOSED_ALLOC[i] ?? [];

    dayIdxs.forEach((d, j) => {
      const units = baseUnits + (BigInt(j) < remainder ? 1n : 0n);
      const amount = units * unit;
      const earnedDate = addDays(CLOSED_START, d);
      const sourceRef = `sale-${i + 1}-${earnedDate}`;
      earnings.push({
        ...scope,
        id: rid(`earning-${i + 1}-${earnedDate}`),
        sourceRef,
        contentId,
        channel: row.channel,
        ratePpm: RATE_PPM[row.channel],
        earnedDate,
        status: 'confirmed',
        released: true,
        eligibleBaseMinor: eligibleBase(amount, row.channel).toString(),
        amountMinor: amount.toString(),
        kind: 'commission',
        attribution: 'content',
      });
      // Every day's source carries the clip's fully NAMED platform weights (no unattributed fallback).
      alloc.forEach((platform, w) =>
        allocations.push({
          ...scope,
          id: rid(`alloc-${i + 1}-${earnedDate}-${w + 1}`),
          sourceRef,
          platform,
          weight: 1,
        }),
      );
    });

    clips.push({
      ...scope,
      id: rid(`clip-row-${i + 1}`),
      contentId,
      title: CLIP_META[i].title,
      brand: row.brand,
      // Published on the clip's EARLIEST assigned date, so no earning ever precedes publication.
      publishedDate: addDays(CLOSED_START, dayIdxs[0]),
      cover: CLIP_META[i].cover,
      coverPosition: '50% 50%',
      views: 812_000 - i * 75_000, // realistic authored counts (not inflated)
      removed: false,
      adBound: i === 2, // clip-3 (Tendrix) carries the verified ad-sample binding
    });
  });

  // September confirmed daily lines (UNRELEASED) for EVERY Bangkok day Sep-01..anchor inclusive,
  // attached to the existing clips in rotation. Emitted oldest→newest for a deterministic order.
  const septSpanDays = Math.round(
    (Date.parse(anchorDate + 'T00:00:00Z') - Date.parse(OPEN_PERIOD.from + 'T00:00:00Z')) / 86400000,
  );
  // Per-day September confirmed amounts (satang): the legacy 7-day grid, or — for a redistributed
  // generation (g6) — the per-clip absolute-date redistribution that preserves each clip's aggregate.
  // The emission order/ids/sources/dates/allocations below are IDENTICAL to legacy; only the looked-up
  // amount (and its derived eligibleBase) differ, so g6 stays byte-identical to g5 in every other fact.
  const septAmountByOffset = septemberDailyAmountsSatang(generation, septSpanDays, anchorDate);
  for (let offset = septSpanDays; offset >= 0; offset--) {
    const amount = septAmountByOffset.get(offset)!; // satang (never zero)
    const clipIndex = offset % 6;
    const contentId = `clip-${clipIndex + 1}`;
    const sourceRef = `sale-sd${offset}`;
    earnings.push({
      ...scope,
      id: rid(`earning-sd${offset}`),
      sourceRef,
      contentId,
      channel: 'organic',
      ratePpm: RATE_PPM.organic,
      earnedDate: addDays(anchorDate, -offset),
      status: 'confirmed',
      released: false, // open-period confirmed is NOT yet in the withdrawable pool
      eligibleBaseMinor: eligibleBase(amount, 'organic').toString(),
      amountMinor: amount.toString(),
      kind: 'commission',
      attribution: 'content',
    });
    allocations.push({
      ...scope,
      id: rid(`alloc-sd${offset}`),
      sourceRef,
      platform: SEPT_PLATFORM[clipIndex],
      weight: 1,
    });
  }

  // September estimated lines + their open-period clips (earnings estimated → clip earned unknown).
  SEPT_ESTIMATED.forEach((row, i) => {
    const contentId = `clip-sep-${i + 1}`;
    const sourceRef = `sale-sep-${i + 1}`;
    earnings.push({
      ...scope,
      id: rid(`earning-sep-${i + 1}`),
      sourceRef,
      contentId,
      channel: row.channel,
      ratePpm: RATE_PPM[row.channel],
      earnedDate: addDays(anchorDate, -row.offset),
      status: 'estimated',
      released: false,
      eligibleBaseMinor: eligibleBase(row.amount, row.channel).toString(),
      amountMinor: row.amount.toString(),
      kind: 'commission',
      attribution: 'content',
    });
    clips.push({
      ...scope,
      id: rid(`clip-row-sep-${i + 1}`),
      contentId,
      title:
        i === 0
          ? 'พรีวิวคอลใหม่เดือนกันยายน ยังรอยืนยันยอดจากต้นทาง'
          : 'แกะกล่องรุ่นลิมิเต็ด รอบกันยายน (ประมาณการ)',
      brand: row.brand,
      publishedDate: addDays(anchorDate, -row.offset),
      cover: i === 0 ? '/media/clip-cover-1.png' : '/media/clip-cover-3.png',
      coverPosition: '50% 50%',
      views: i === 0 ? 240_000 : 180_000,
      removed: false,
      adBound: false,
    });
    allocations.push({
      ...scope,
      id: rid(`alloc-sep-${i + 1}`),
      sourceRef,
      platform: SEPT_ESTIMATED_PLATFORM[i],
      weight: 1,
    });
  });

  // ---- Withdrawals: four prior PAID at 25,000 (ALL settled after the Sep-01 release), then one
  // pending (requested) reserved 25,000, submitted after the last paid and before the anchor. ------
  // The beneficiary (name/bank/mask) is chosen PER GENERATION and is DATA on every seeded row, so a
  // request snapshot's bank always matches the beneficiary summary + any reveal record for the same gen.
  const gb = beneficiaryForGeneration(generation);
  const wben = {
    beneficiaryName: gb.beneficiaryName,
    bankName: gb.bankName,
    maskedAccount: gb.maskedAccount,
  };
  const paidDays = ['2026-09-02', '2026-09-05', '2026-09-09', '2026-09-12'];
  // A single global withdrawal sequence (paid 1..4 then the pending row) feeds the numeric reference
  // 4-digit suffix, so every generation's rows stay uniquely and deterministically numbered.
  const withdrawals: WithdrawalRow[] = paidDays.map((day, i) => {
    const submittedAt = bkkNoon(addDays(day, -1));
    return {
      ...scope,
      id: rid(`wr-paid-${i + 1}`),
      requestRef: requestRefFor(generation, datasetId, `wr-paid-${i + 1}`, submittedAt, i),
      idempotencyKey: `${datasetId}-idem-paid-${i + 1}`,
      grossMinor: WITHDRAWAL_GROSS.toString(),
      netMinor: WITHDRAWAL_GROSS.toString(),
      status: 'paid',
      submittedAt,
      paidAt: bkkNoon(day),
      ...wben,
    };
  });
  // One pending (active) request that reserves 25,000 against the released pool.
  const pendingDay = addDays(anchorDate, -3);
  const pendingSubmittedAt = bkkNoon(pendingDay);
  withdrawals.push({
    ...scope,
    id: rid('wr-pending-1'),
    requestRef: requestRefFor(generation, datasetId, 'wr-pending-1', pendingSubmittedAt, 4),
    idempotencyKey: `${datasetId}-idem-pending-1`,
    grossMinor: WITHDRAWAL_GROSS.toString(),
    netMinor: WITHDRAWAL_GROSS.toString(),
    status: 'requested',
    submittedAt: pendingSubmittedAt,
    paidAt: null,
    ...wben,
  });

  // Optional synthetic reveal record: only a generation with an authored full number carries one, so
  // g1–g3 (no fullAccount) author [] and expose no eye. Marked `synthetic` and never a withdrawal field.
  const beneficiaryAccounts: BeneficiaryAccountRow[] = gb.fullAccount
    ? [
        {
          ...scope,
          id: rid('beneficiary-account-1'),
          beneficiaryName: gb.beneficiaryName,
          bankName: gb.bankName,
          maskedAccount: gb.maskedAccount,
          fullAccount: gb.fullAccount,
          synthetic: true,
        },
      ]
    : [];

  // Settlements: one per PAID withdrawal, obligationSettled == that withdrawal's gross (netgross
  // matches). Their sum IS the closed statement's settled amount (no separate opening literal).
  const settlements: SettlementRow[] = withdrawals
    .filter((w) => w.status === 'paid')
    .map((w, i) => ({
      ...scope,
      id: rid(`settle-${i + 1}`),
      statementId: CLOSED_STATEMENT_ID,
      settlementId: `${datasetId}-payment-${i + 1}`,
      reference: `${datasetId}-transfer-${i + 1}`,
      recordedAt: bangkokInstant(Date.parse(w.paidAt!)),
      cashMinor: w.netMinor,
      withholdingMinor: '0',
      otherMinor: '0',
      obligationSettledMinor: w.grossMinor,
      withdrawalRef: w.requestRef,
    }));

  const statements: StatementRow[] = [
    {
      ...scope,
      id: rid('stmt-row-1'),
      statementId: CLOSED_STATEMENT_ID,
      version: '1',
      periodFrom: CLOSED_PERIOD.from,
      periodToExcl: CLOSED_PERIOD.toExclusive,
      // Published on Sep-01 morning: strictly AFTER the closed period ends (Sep-01 00:00) and strictly
      // BEFORE the first paid withdrawal is submitted (Sep-01 noon), so the release→submit→paid
      // timeline is unambiguous.
      publishedAt: `${OPEN_PERIOD.from}T09:00:00+07:00`,
      settlementAsOf: asOfIso,
      status: 'part-paid',
      openingMinor: '0',
      adjustmentsMinor: '0',
    },
  ];

  const deductions: DeductionRow[] = []; // explicit no-WHT / no-fee decision

  const meta: MetaRow = {
    ...scope,
    asOf: asOfIso,
    timezone: 'Asia/Bangkok',
    anchorDate,
    note: `${DEMO_DATASET_MARKER}: coherent cross-page partner-demo sample; totals are computed from rows, never hardcoded`,
  };

  return {
    meta,
    earnings,
    allocations,
    clips,
    statements,
    settlements,
    withdrawals,
    deductions,
    beneficiaryAccounts,
  };
}

// Mechanical mask/full-number consistency: strip every non `[0-9X]` char from the mask, then require the
// remaining template to be the same length as the full number and to agree on every REVEALED digit (the
// non-X positions). e.g. 'XXX-X-X1234-5' → 'XXXXX12345' must match the tail of '1234512345'.
export function maskCoversFullAccount(mask: string, fullAccount: string): boolean {
  const template = mask.replace(/[^0-9X]/g, '');
  if (template.length !== fullAccount.length) return false;
  for (let i = 0; i < template.length; i++)
    if (template[i] !== 'X' && template[i] !== fullAccount[i]) return false;
  return true;
}

// ---- Validation (browser-safe; imported by both the dev read path and Astra's client for reuse) ---
//
// A raw dataset read out of SQLite is UNTRUSTED until it passes this gate: corrupt money/rate/scope/
// date/reference/sum values must NEVER be cast into a fake-but-valid DTO and displayed. `validateDataset`
// runs a strict Zod shape parse first, then the cross-row financial invariants, and throws
// `DatasetValidationError` (marker-prefixed) on the first problem. It imports no node builtins.

export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(`${DEMO_DATASET_MARKER}: ${message}`);
    this.name = 'DatasetValidationError';
  }
}

const UNSIGNED_MINOR = z.string().regex(/^\d+$/, 'money must be an unsigned integer satang string');
const SIGNED_MINOR = z.string().regex(/^-?\d+$/, 'money must be an integer satang string');
const DATE_ONLY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD calendar date');
// Bangkok, SECOND precision, explicit +07:00 offset — never a `.mmmZ` UTC millisecond instant.
const BKK_INSTANT = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/, 'expected a YYYY-MM-DDTHH:MM:SS+07:00 instant');

const channelSchema = z.enum(['organic', 'brand_ads']);
const platformSchema = z.enum(['facebook', 'tiktok', 'shopee', 'lazada', 'web', 'unattributed']);
const withdrawalStatusSchema = z.enum([
  'requested',
  'processing',
  'reconciling',
  'paid',
  'failed',
  'cancelled',
]);

const scopeShape = { id: z.string().min(1), datasetId: z.string().min(1), generation: z.string().min(1) };

const metaSchema = z.object({
  datasetId: z.string().min(1),
  generation: z.string().min(1),
  asOf: BKK_INSTANT,
  timezone: z.literal('Asia/Bangkok'),
  anchorDate: DATE_ONLY,
  note: z.string().min(1),
});
const earningSchema = z.object({
  ...scopeShape,
  sourceRef: z.string().min(1),
  contentId: z.string().min(1),
  channel: channelSchema,
  ratePpm: z.number().int().positive(),
  earnedDate: DATE_ONLY,
  status: z.enum(['confirmed', 'estimated']),
  released: z.boolean(),
  eligibleBaseMinor: UNSIGNED_MINOR,
  amountMinor: UNSIGNED_MINOR,
  kind: z.literal('commission'),
  attribution: z.enum(['content', 'partner-only']),
});
const allocationSchema = z.object({
  ...scopeShape,
  sourceRef: z.string().min(1),
  platform: platformSchema,
  weight: z.number().int().positive(),
});
const clipSchema = z.object({
  ...scopeShape,
  contentId: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().min(1),
  publishedDate: DATE_ONLY,
  cover: z.string().min(1),
  coverPosition: z.string().min(1),
  // Public/masked-safe: a stored integer count OR the endpoint's masked `null` both validate.
  views: z.number().int().nonnegative().nullable(),
  removed: z.boolean(),
  adBound: z.boolean(),
});
const statementSchema = z.object({
  ...scopeShape,
  statementId: z.string().min(1),
  version: z.string().min(1),
  periodFrom: z.string().min(1),
  periodToExcl: z.string().min(1),
  publishedAt: BKK_INSTANT,
  settlementAsOf: BKK_INSTANT,
  status: z.string().min(1),
  openingMinor: SIGNED_MINOR,
  adjustmentsMinor: SIGNED_MINOR,
});
const settlementSchema = z.object({
  ...scopeShape,
  statementId: z.string().min(1),
  settlementId: z.string().min(1),
  reference: z.string().min(1),
  recordedAt: BKK_INSTANT,
  cashMinor: UNSIGNED_MINOR,
  withholdingMinor: UNSIGNED_MINOR,
  otherMinor: UNSIGNED_MINOR,
  obligationSettledMinor: UNSIGNED_MINOR,
  withdrawalRef: z.string().min(1).nullable(),
});
const withdrawalSchema = z.object({
  ...scopeShape,
  requestRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
  grossMinor: UNSIGNED_MINOR,
  netMinor: UNSIGNED_MINOR,
  status: withdrawalStatusSchema,
  submittedAt: BKK_INSTANT,
  paidAt: BKK_INSTANT.nullable(),
  beneficiaryName: z.string().min(1),
  bankName: z.string().min(1),
  maskedAccount: z.string().min(1),
});
const deductionSchema = z.object({
  ...scopeShape,
  requestRef: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
  amountMinor: UNSIGNED_MINOR,
});
const beneficiaryAccountSchema = z.object({
  ...scopeShape,
  beneficiaryName: z.string().min(1),
  bankName: z.string().min(1),
  maskedAccount: z.string().min(1),
  fullAccount: z.string().regex(/^\d{6,20}$/, 'full account must be 6–20 digits'),
  synthetic: z.literal(true),
});

const datasetSchema = z.object({
  meta: metaSchema,
  earnings: z.array(earningSchema),
  allocations: z.array(allocationSchema),
  clips: z.array(clipSchema),
  statements: z.array(statementSchema),
  settlements: z.array(settlementSchema),
  withdrawals: z.array(withdrawalSchema),
  deductions: z.array(deductionSchema),
  // Additive + backward compatible: absent in old JSON/DB rows, so it defaults to [].
  beneficiaryAccounts: z.array(beneficiaryAccountSchema).default([]),
});

const bkkDayOf = (instant: string): string => instant.slice(0, 10);

/**
 * Validate a raw dataset (shape + financial invariants) and return it strongly typed. Throws
 * `DatasetValidationError` on the first violation. Pure and browser-safe (no node builtins).
 */
export function validateDataset(input: unknown): DatasetRecords {
  const parsed = datasetSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new DatasetValidationError(
      `shape invalid at ${first.path.map(String).join('.') || '(root)'}: ${first.message}`,
    );
  }
  const data = parsed.data as DatasetRecords;
  assertDatasetIntegrity(data);
  return data;
}

/** Cross-row financial/reference invariants on an already shape-valid dataset. */
export function assertDatasetIntegrity(data: DatasetRecords): void {
  const { meta } = data;
  const fail = (message: string): never => {
    throw new DatasetValidationError(message);
  };

  const asOfMs = Date.parse(meta.asOf);
  if (Number.isNaN(asOfMs)) fail(`meta.asOf ${meta.asOf} is not a parseable instant`);
  if (bangkokInstant(asOfMs) !== meta.asOf) fail('meta.asOf must be second precision Bangkok time');

  // Scope: every row belongs to exactly this dataset generation (compound-key isolation contract).
  const scopedGroups: [string, { id: string; datasetId: string; generation: string }[]][] = [
    ['earnings', data.earnings],
    ['allocations', data.allocations],
    ['clips', data.clips],
    ['statements', data.statements],
    ['settlements', data.settlements],
    ['withdrawals', data.withdrawals],
    ['deductions', data.deductions],
    ['beneficiaryAccounts', data.beneficiaryAccounts ?? []],
  ];
  const seen = new Set<string>();
  for (const [group, rows] of scopedGroups)
    for (const row of rows) {
      if (row.datasetId !== meta.datasetId || row.generation !== meta.generation)
        fail(`${group} row ${row.id} is out of scope (${row.datasetId}/${row.generation})`);
      const key = `${group}:${row.id}`;
      if (seen.has(key)) fail(`${group} row id ${row.id} is duplicated`);
      seen.add(key);
    }

  // Earnings: rate matches channel, amount reconciles to eligibleBase exactly, no future earned date.
  for (const e of data.earnings) {
    const expected = RATE_PPM[e.channel];
    if (e.ratePpm !== expected)
      fail(`earning ${e.id} rate ${e.ratePpm} != ${expected} for channel ${e.channel}`);
    // amount = eligibleBase * ratePpm / 1e6, checked as an exact integer relationship.
    if (BigInt(e.amountMinor) * 1_000_000n !== BigInt(e.eligibleBaseMinor) * BigInt(e.ratePpm))
      fail(`earning ${e.id} amount does not reconcile to eligibleBase × rate`);
    if (e.earnedDate > meta.anchorDate)
      fail(`earning ${e.id} earnedDate ${e.earnedDate} is after anchor ${meta.anchorDate}`);
  }
  for (const c of data.clips)
    if (c.publishedDate > meta.anchorDate)
      fail(`clip ${c.id} publishedDate ${c.publishedDate} is after anchor ${meta.anchorDate}`);

  // Reference integrity.
  const sourceRefs = new Set(data.earnings.map((e) => e.sourceRef));
  for (const a of data.allocations)
    if (!sourceRefs.has(a.sourceRef)) fail(`allocation ${a.id} references unknown source ${a.sourceRef}`);
  const statementIds = new Set(data.statements.map((s) => s.statementId));
  const withdrawalsByRef = new Map(data.withdrawals.map((w) => [w.requestRef, w]));
  for (const s of data.settlements) {
    if (!statementIds.has(s.statementId))
      fail(`settlement ${s.id} references unknown statement ${s.statementId}`);
    // cash + withholding + other must reconcile to the obligation settled.
    if (
      BigInt(s.cashMinor) + BigInt(s.withholdingMinor) + BigInt(s.otherMinor) !==
      BigInt(s.obligationSettledMinor)
    )
      fail(`settlement ${s.id} cash+withholding+other != obligationSettled`);
    if (s.withdrawalRef !== null) {
      const w = withdrawalsByRef.get(s.withdrawalRef);
      if (!w) fail(`settlement ${s.id} references unknown withdrawal ${s.withdrawalRef}`);
      else {
        if (BigInt(s.obligationSettledMinor) !== BigInt(w.grossMinor))
          fail(`settlement ${s.id} obligation != withdrawal ${w.requestRef} gross`);
        if (BigInt(s.cashMinor) !== BigInt(w.netMinor))
          fail(`settlement ${s.id} cash != withdrawal ${w.requestRef} net`);
      }
    }
    if (Date.parse(s.recordedAt) > asOfMs)
      fail(`settlement ${s.id} recordedAt ${s.recordedAt} is after asOf`);
  }
  for (const d of data.deductions)
    if (!withdrawalsByRef.has(d.requestRef))
      fail(`deduction ${d.id} references unknown withdrawal ${d.requestRef}`);

  // Synthetic reveal records: the mask must be mechanically consistent with the full number, and the
  // beneficiary identity (name/bank/mask) must match a seeded withdrawal beneficiary so the eye reveal
  // can never expose a number for a beneficiary the summary/quotes never show. (`synthetic` is enforced
  // as the literal true by the shape schema above.)
  const withdrawalBeneficiaries = new Set(
    data.withdrawals.map((w) => JSON.stringify([w.beneficiaryName, w.bankName, w.maskedAccount])),
  );
  for (const acct of data.beneficiaryAccounts ?? []) {
    if (!maskCoversFullAccount(acct.maskedAccount, acct.fullAccount))
      fail(
        `beneficiary account ${acct.id} mask ${acct.maskedAccount} is not mechanically consistent with its full number`,
      );
    const key = JSON.stringify([acct.beneficiaryName, acct.bankName, acct.maskedAccount]);
    if (data.withdrawals.length > 0 && !withdrawalBeneficiaries.has(key))
      fail(`beneficiary account ${acct.id} does not match any seeded withdrawal beneficiary`);
  }

  // Withdrawal timeline + settlement completeness.
  const settledRefs = new Set(
    data.settlements.map((s) => s.withdrawalRef).filter((r): r is string => r !== null),
  );
  for (const w of data.withdrawals) {
    if (BigInt(w.netMinor) > BigInt(w.grossMinor))
      fail(`withdrawal ${w.requestRef} net exceeds gross`);
    if (Date.parse(w.submittedAt) > asOfMs)
      fail(`withdrawal ${w.requestRef} submittedAt is after asOf`);
    if (w.status === 'paid') {
      if (w.paidAt === null) fail(`paid withdrawal ${w.requestRef} has no paidAt`);
      else {
        if (Date.parse(w.paidAt) < Date.parse(w.submittedAt))
          fail(`withdrawal ${w.requestRef} paidAt precedes submittedAt`);
        if (Date.parse(w.paidAt) > asOfMs) fail(`withdrawal ${w.requestRef} paidAt is after asOf`);
      }
      if (!settledRefs.has(w.requestRef))
        fail(`paid withdrawal ${w.requestRef} has no matching settlement`);
    } else if (w.paidAt !== null) {
      fail(`non-paid withdrawal ${w.requestRef} must not carry a paidAt`);
    }
  }

  // Statements must publish before/at asOf and reference within the dataset's day range.
  for (const s of data.statements) {
    if (Date.parse(s.publishedAt) > asOfMs)
      fail(`statement ${s.statementId} publishedAt is after asOf`);
    if (bkkDayOf(s.settlementAsOf) > meta.anchorDate)
      fail(`statement ${s.statementId} settlementAsOf is after anchor`);
  }
}
