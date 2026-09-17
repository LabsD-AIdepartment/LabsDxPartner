import { money, readyScenario } from './ready';

// ---------------------------------------------------------------------------------------------
// ONE authoritative synthetic financial source for the "partner-demo" story, so the Overview,
// the withdrawal balance and the retained statement all reconcile to the SAME numbers instead of
// each card hard-coding its own. Everything here is authored data in satang (integer THB minor).
//
// The opening balance figures are DERIVED from the existing readyScenario() statement (the single
// source of truth for the closed Jul–Aug window), never re-typed as separate literals:
//   • statement.newEarnings = confirmed commission of the closed window = the released pool.
//   • statement.settled     = the part-paid settlement already recorded (retained provenance).
//   • statement.closing     = released − settled = opening AVAILABLE-to-withdraw balance.
//
// September is the OPEN period: a small amount of commission is still ESTIMATED (not confirmed, not
// withdrawable). It is the Overview "estimated" figure AND the withdrawal current-period pending.
// We deliberately do NOT pre-seed a reserved counter: reserve only ever appears after a real
// submitted withdrawal request (available/reserved then move together through the live controller).
// ---------------------------------------------------------------------------------------------

const readyStatement = readyScenario().statement.statement;

export const DEMO_FINANCIALS = {
  // Statement-1 confirmed commission == released withdrawal pool.
  confirmedReleasedMinor: readyStatement.newEarnings.minor, // 37,360.00
  // Already-settled portion of statement-1 (part-paid). Opening settlement, transparently retained.
  settledMinor: readyStatement.settled.minor, // 11,840.00
  // Opening available-to-withdraw = released − settled = statement closing.
  openingAvailableMinor: readyStatement.closing.minor, // 25,520.00
  statementId: readyStatement.id,
  // Anchor "now" for the demo (matches the task date); the open period ends Oct 1 exclusive (Sep 30).
  asOf: '2026-09-16T12:00:00+07:00',
} as const;

// Reconciliation guard: released − settled must equal the opening available (statement closing).
if (
  BigInt(DEMO_FINANCIALS.confirmedReleasedMinor) - BigInt(DEMO_FINANCIALS.settledMinor) !==
  BigInt(DEMO_FINANCIALS.openingAvailableMinor)
)
  throw new Error('demo-financials: released − settled must equal opening available');

const commonLine = {
  sourceRevision: '1',
  agreementVersion: 'synthetic-agreement-1',
  kind: 'commission' as const,
  status: 'estimated' as const,
  reason: null,
  originalLineId: null,
  attribution: 'content' as const,
};

// September estimated commission lines, keyed to their own September earned dates (all on/before the
// asOf date, none in the future) so they fall outside a Jul–Aug selection and only appear once the
// range includes the open period. Eligible base is derived from the EXACT rate: Organic 10%
// (100000 ppm) and Brand ads 3% (30000 ppm), matching the approved sample rates.
export const septemberEstimatedLines = [
  {
    ...commonLine,
    id: 'earning-sep-1',
    sourceRef: 'synthetic-sale-sep-1',
    earnedAt: '2026-09-12T12:00:00+07:00',
    contentId: 'clip-sep-1',
    eligibleBase: money('4000000'), // 40,000.00 × 10% = 4,000.00
    ratePpm: 100000,
    amount: money('400000'), // 4,000.00
    evidenceRef: 'synthetic-evidence-sep-1',
  },
  {
    ...commonLine,
    id: 'earning-sep-2',
    sourceRef: 'synthetic-sale-sep-2',
    earnedAt: '2026-09-15T12:00:00+07:00',
    contentId: 'clip-sep-2',
    eligibleBase: money('10000000'), // 100,000.00 × 3% = 3,000.00
    ratePpm: 30000,
    amount: money('300000'), // 3,000.00
    evidenceRef: 'synthetic-evidence-sep-2',
  },
];

// September (open period) estimated commission == current-period pending — DERIVED from the lines,
// never a separate literal, so a change to the rows keeps the pending figure honest.
export const currentPeriodPendingMinor = septemberEstimatedLines
  .reduce((sum, line) => sum + BigInt(line.amount.minor), 0n)
  .toString();

// Minimal content cards for the September clips so the Overview aggregation can resolve their brand
// for sales-by-brand. They are estimated-only: `earned` is unknown (null) WITH an explicit reason
// (satisfying the ContentCard "unknown earnings need a reason" refinement), because nothing is
// confirmed for the open period yet — the estimated figure lives in the earnings lines above.
export const septemberClips = [
  {
    id: 'clip-sep-1',
    title: 'พรีวิวคอลใหม่เดือนกันยายน ยังรอยืนยันยอดจากต้นทาง',
    brand: 'Axtion',
    publishedAt: '2026-09-12T12:00:00+07:00',
    cover: '/media/clip-cover-1.png',
    coverPosition: '50% 50%',
    removed: false,
    views: 240000,
    earned: null,
    unavailableReason: 'ประมาณการเดือนกันยายน · ยังไม่ยืนยันยอด',
  },
  {
    id: 'clip-sep-2',
    title: 'แกะกล่องรุ่นลิมิเต็ด รอบกันยายน (ประมาณการ)',
    brand: 'Tendrix',
    publishedAt: '2026-09-15T12:00:00+07:00',
    cover: '/media/clip-cover-3.png',
    coverPosition: '50% 50%',
    removed: false,
    views: 180000,
    earned: null,
    unavailableReason: 'ประมาณการเดือนกันยายน · ยังไม่ยืนยันยอด',
  },
];
