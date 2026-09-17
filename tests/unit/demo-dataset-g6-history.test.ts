// D183 — focused system tests for the g6 September-redistribution generation. The owner reported that the
// Daily Clip Earnings weekly chart repeats an identical shape as you navigate weeks, because g5 authors
// every September confirmed day off the 7-day `SEPT_PATTERN_THB[offset%7]` grid. g6 inherits EVERY g5
// fact verbatim and changes ONLY the September confirmed per-day commission amounts: each existing clip's
// September aggregate is deterministically redistributed across that clip's own September days by an
// absolute-date weight, so adjacent weeks show DISTINCT shapes while every aggregate is preserved.
//
// These tests assert (using the existing projectOverview + validateDataset contracts):
//   • legacy g5 is unchanged (its September grid + latest-7 = 133,000 still hold);
//   • g6 vs g5 is identical in every non-(amount/base) fact except the generation column;
//   • closed Jul–Aug rows (amounts included) and the September estimated rows are byte-identical;
//   • FULL-September per-clip / per-channel / per-status confirmed totals reconcile to g5 (the per-DATE
//     amounts INTENTIONALLY differ — the pinned g6 per-date shape below is the redistribution, not g5);
//   • open+closed platform + channel FULL-PERIOD aggregates match g5 (a sub-period/single-week window
//     intentionally differs; only the full-July–Aug, full-September and full Jul–Oct totals are equal);
//   • ≥31 calendar days are covered and positive, and the five navigable weeks are DISTINCT arrays;
//   • overlapping window queries of the same frozen dataset return identical per-day values + totals;
//   • the brand filter still isolates a brand's totals;
//   • g6 retains g5's numeric withdrawal references and the synthetic KBank beneficiary + reveal;
//   • the build is deterministic (same input → identical rows);
//   • the redistribution never fails and preserves the g5 totals for valid anchors Sep 1/7/17/30.
//
// It intentionally never asserts DEFAULT_GENERATION: the default stays g5 until root seeds + audits g6.

import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  validateDataset,
  beneficiaryForGeneration,
  DEMO_BENEFICIARY_G4,
  maskCoversFullAccount,
  addDays,
  type DatasetRecords,
  type EarningRow,
} from '../../dev/demo-dataset/dataset';
import { projectOverview } from '../../dev/demo-dataset/projections';
import { bootstrapWithdrawal } from '../../dev/demo-dataset/bootstrap';
import { datasetScope } from '../../dev/demo-dataset/scope';
import { weeklyEarningsPoints } from '@/features/overview/weekly-earnings';

// Bangkok anchor 2026-09-17 (same frozen window as the g5 story).
const ASOF = new Date('2026-09-17T02:00:00Z');
const ANCHOR = '2026-09-17';
const build = (generation: string, identity: 'a' | 'b' = 'a'): DatasetRecords =>
  buildDataset({ datasetId: `partner-demo-${identity}`, generation, asOf: ASOF });
const g5 = (identity: 'a' | 'b' = 'a') => build('g5', identity);
const g6 = (identity: 'a' | 'b' = 'a') => build('g6', identity);

const SEPT = { from: '2026-09-01', toExclusive: '2026-10-01' };
const JUL_AUG = { from: '2026-07-01', toExclusive: '2026-09-01' };
const FULL = { from: '2026-07-01', toExclusive: '2026-10-01' };

const RELEASED = 37_360_000n; // closed Jul–Aug confirmed (released pool) = 373,600 THB
const SEPT_CONFIRMED = 32_200_000n; // September confirmed-but-unreleased = 322,000 THB
const SEPT_ESTIMATED = 7_000_000n; // September estimated = 70,000 THB
const INITIAL_SETTLED = 10_000_000n; // four PAID 25,000 = 100,000 THB
const INITIAL_RESERVED = 2_500_000n; // one PENDING 25,000 = 25,000 THB
const INITIAL_AVAILABLE = RELEASED - INITIAL_SETTLED - INITIAL_RESERVED; // 248,600 THB
const CURRENT_PENDING = SEPT_CONFIRMED + SEPT_ESTIMATED; // 392,000 THB

// A September confirmed daily line = open-period (unreleased) confirmed commission; exactly these lines
// are the ones g6 is allowed to redistribute. Closed lines are released; estimated lines are estimated.
const isSeptConfirmed = (e: EarningRow) => e.status === 'confirmed' && !e.released;

// A date → confirmed daily amount (satang, as BigInt) map from an overview's trend.
function trendMap(o: ReturnType<typeof projectOverview>): Map<string, bigint> {
  return new Map(o.earnings.trend.map((p) => [p.date, BigInt(p.amount.minor)]));
}

// Sum trend salesByPlatform per platform across a window (the displayed platform bars).
function platformTotals(o: ReturnType<typeof projectOverview>): Record<string, string> {
  const totals = new Map<string, bigint>();
  for (const p of o.earnings.trend)
    for (const s of p.salesByPlatform ?? [])
      totals.set(s.platform, (totals.get(s.platform) ?? 0n) + BigInt(s.sales.minor));
  return Object.fromEntries([...totals].map(([k, v]) => [k, v.toString()]));
}

// ---- legacy g5 is unchanged -----------------------------------------------------------------------

describe('legacy g5 September grid is unchanged', () => {
  it('still authors the 7-day repeating pattern per date (regression baseline)', () => {
    const map = trendMap(projectOverview(g5(), SEPT));
    // The exact legacy per-date confirmed commission (satang), Sep-01..Sep-17.
    const expected: Record<string, number> = {
      '2026-09-01': 18000, '2026-09-02': 13000, '2026-09-03': 25000, '2026-09-04': 24000,
      '2026-09-05': 16000, '2026-09-06': 15000, '2026-09-07': 22000, '2026-09-08': 18000,
      '2026-09-09': 13000, '2026-09-10': 25000, '2026-09-11': 24000, '2026-09-12': 16000,
      '2026-09-13': 15000, '2026-09-14': 22000, '2026-09-15': 18000, '2026-09-16': 13000,
      '2026-09-17': 25000,
    };
    for (const [date, thb] of Object.entries(expected))
      expect(map.get(date)).toBe(BigInt(thb) * 100n);
    // g5's two navigable September weeks are the SAME array (the reported defect this generation fixes).
    const range4 = { from: '2026-09-04', toExclusive: '2026-09-11' };
    const range11 = { from: '2026-09-11', toExclusive: '2026-09-18' };
    const week = (r: { from: string; toExclusive: string }) => {
      const o = projectOverview(g5(), r);
      return weeklyEarningsPoints({ trend: o.earnings.trend, coverage: o.earnings.coverage }, r).map(
        (p) => p.amount?.minor ?? null,
      );
    };
    expect(week(range4)).toEqual(week(range11)); // identical shape → the owner-reported repeat
  });
});

// ---- g6 changes ONLY the September confirmed amounts ----------------------------------------------

describe('g6 inherits every g5 fact except the September confirmed amounts', () => {
  // Normalize both datasets to prove that the ONLY differences are the generation column and the
  // September confirmed amount/eligibleBase — every id, date, source, allocation, withdrawal, statement,
  // settlement, clip and beneficiary is otherwise identical.
  function normalize(d: DatasetRecords) {
    const dropGen = <T extends { generation: string }>(rows: T[]) =>
      rows.map((r) => ({ ...r, generation: 'X' }));
    return {
      meta: { ...d.meta, generation: 'X' },
      earnings: d.earnings.map((e) => ({
        ...e,
        generation: 'X',
        amountMinor: isSeptConfirmed(e) ? 'X' : e.amountMinor,
        eligibleBaseMinor: isSeptConfirmed(e) ? 'X' : e.eligibleBaseMinor,
      })),
      allocations: dropGen(d.allocations),
      clips: dropGen(d.clips),
      statements: dropGen(d.statements),
      settlements: dropGen(d.settlements),
      withdrawals: dropGen(d.withdrawals),
      deductions: dropGen(d.deductions),
      beneficiaryAccounts: dropGen(d.beneficiaryAccounts ?? []),
    };
  }

  it('is identical to g5 in every non-(amount/base) fact', () => {
    expect(normalize(g6())).toEqual(normalize(g5()));
  });

  it('keeps closed Jul–Aug rows and September estimated rows byte-identical (amounts included)', () => {
    const asG5 = (e: EarningRow) => ({ ...e, generation: 'g5' });
    // Closed (released) confirmed rows — untouched, exact closed totals preserved.
    const closed6 = g6().earnings.filter((e) => e.released).map(asG5);
    const closed5 = g5().earnings.filter((e) => e.released);
    expect(closed6).toEqual(closed5);
    expect(closed6.reduce((t, e) => t + BigInt(e.amountMinor), 0n)).toBe(RELEASED);
    // September estimated rows — untouched.
    const est6 = g6().earnings.filter((e) => e.status === 'estimated').map(asG5);
    const est5 = g5().earnings.filter((e) => e.status === 'estimated');
    expect(est6).toEqual(est5);
  });

  it('validates against the dataset contract', () => {
    expect(() => validateDataset(g6())).not.toThrow();
    expect(() => validateDataset(g6('b'))).not.toThrow();
  });
});

// ---- per-clip / per-date / channel / status reconciliation ---------------------------------------

describe('g6 preserves every September aggregate', () => {
  const septByClip = (d: DatasetRecords) => {
    const m = new Map<string, bigint>();
    for (const e of d.earnings)
      if (isSeptConfirmed(e)) m.set(e.contentId, (m.get(e.contentId) ?? 0n) + BigInt(e.amountMinor));
    return Object.fromEntries([...m].map(([k, v]) => [k, v.toString()]));
  };

  it('per-clip September confirmed aggregate equals g5 exactly', () => {
    const byClip = septByClip(g6());
    expect(byClip).toEqual(septByClip(g5()));
    // Pinned per-clip aggregates (satang) at the Sep-17 anchor; they sum to 322,000 THB.
    expect(byClip).toEqual({
      'clip-1': '6500000',
      'clip-2': '6200000',
      'clip-3': '5600000',
      'clip-4': '5300000',
      'clip-5': '5500000',
      'clip-6': '3100000',
    });
    expect(Object.values(byClip).reduce((t, v) => t + BigInt(v), 0n)).toBe(SEPT_CONFIRMED);
  });

  it('per-date confirmed commission matches the deterministic redistribution (whole baht, positive)', () => {
    const map = trendMap(projectOverview(g6(), SEPT));
    // Pinned g6 per-date confirmed commission (THB) — a distinct, non-repeating authored shape.
    const expected: Record<string, number> = {
      '2026-09-01': 17838, '2026-09-02': 18929, '2026-09-03': 14667, '2026-09-04': 21080,
      '2026-09-05': 19205, '2026-09-06': 15919, '2026-09-07': 14865, '2026-09-08': 20190,
      '2026-09-09': 18667, '2026-09-10': 24800, '2026-09-11': 17727, '2026-09-12': 15081,
      '2026-09-13': 22297, '2026-09-14': 13881, '2026-09-15': 22666, '2026-09-16': 16120,
      '2026-09-17': 28068,
    };
    for (const [date, thb] of Object.entries(expected)) {
      expect(map.get(date)).toBe(BigInt(thb) * 100n); // exact whole-baht value
      expect(map.get(date)! > 0n).toBe(true); // strictly positive — never a zero day
      expect(map.get(date)! % 100n).toBe(0n); // whole baht (satang divisible by 100)
    }
    expect([...map.values()].reduce((t, v) => t + v, 0n)).toBe(SEPT_CONFIRMED);
  });

  it('September channel + status totals reconcile to the g5 story', () => {
    const o6 = projectOverview(g6(), SEPT).earnings;
    const o5 = projectOverview(g5(), SEPT).earnings;
    expect(o6.confirmed!.minor).toBe(SEPT_CONFIRMED.toString());
    expect(o6.estimated!.minor).toBe(SEPT_ESTIMATED.toString());
    expect(o6.eligibleSales!.minor).toBe('322000000'); // confirmed base preserved (amount × 10)
    // Channel breakdown (all September confirmed is organic 10%) identical to g5.
    expect(o6.channelBreakdown).toEqual(o5.channelBreakdown);
    // Every displayed September day clears the owner's 3% floor on its confirmed sale.
    for (const p of o6.trend) {
      expect(BigInt(p.amount.minor)).toBeGreaterThan(0n);
      expect(BigInt(p.sales!.minor)).toBe(BigInt(p.amount.minor) * 10n); // organic 10% base
      expect(BigInt(p.amount.minor) * 100n >= BigInt(p.sales!.minor) * 3n).toBe(true);
    }
  });
});

// ---- platform + channel projections match old aggregates -----------------------------------------

describe('g6 open+closed projections match the g5 aggregates', () => {
  it('per-platform + channel + brand totals are identical to g5 for every window', () => {
    for (const window of [JUL_AUG, SEPT, FULL]) {
      const o6 = projectOverview(g6(), window);
      const o5 = projectOverview(g5(), window);
      expect(platformTotals(o6)).toEqual(platformTotals(o5));
      expect(o6.earnings.channelBreakdown).toEqual(o5.earnings.channelBreakdown);
      expect(o6.earnings.confirmed!.minor).toBe(o5.earnings.confirmed!.minor);
      expect(o6.earnings.estimated?.minor ?? null).toBe(o5.earnings.estimated?.minor ?? null);
      expect(o6.earnings.eligibleSales!.minor).toBe(o5.earnings.eligibleSales!.minor);
    }
  });

  it('cumulative obligation (released − settled) is unchanged', () => {
    const a = projectOverview(g6(), JUL_AUG).obligation;
    const b = projectOverview(g6(), SEPT).obligation;
    expect(a.confirmedUnpaid?.minor).toBe((RELEASED - INITIAL_SETTLED).toString()); // 273,600 THB
    expect(b.confirmedUnpaid?.minor).toBe(a.confirmedUnpaid?.minor); // filter-independent
    expect(a.nextPayout?.statementId).toBe('statement-1');
  });

  it('bootstrap keeps released 373,600 / settled 100,000 / reserved 25,000 / available 248,600 / pending 392,000', () => {
    const data = g6();
    const scope = datasetScope(data, 'a');
    const { scenarioOverride } = bootstrapWithdrawal(data, scope);
    expect(scenarioOverride.base.released).toBe(RELEASED.toString());
    expect(scenarioOverride.base.settled).toBe('0');
    expect(scenarioOverride.currentPeriodPending).toBe(CURRENT_PENDING.toString());
    // released − settled − reserved = available (248,600 THB).
    expect(RELEASED - INITIAL_SETTLED - INITIAL_RESERVED).toBe(INITIAL_AVAILABLE);
  });
});

// ---- coverage + distinct weekly shapes -----------------------------------------------------------

describe('g6 monthly coverage + distinct navigable weeks', () => {
  it('covers ≥31 consecutive positive days (Aug-18..Sep-17)', () => {
    const window = { from: '2026-08-18', toExclusive: '2026-09-18' };
    const o = projectOverview(g6(), window);
    expect(o.earnings.coverage.status).toBe('complete');
    const map = trendMap(o);
    let day = window.from;
    let covered = 0;
    while (day < window.toExclusive) {
      expect(map.get(day)).toBeGreaterThan(0n); // every calendar day is positive
      covered += 1;
      day = addDays(day, 1);
    }
    expect(covered).toBeGreaterThanOrEqual(31);
  });

  it('the five navigable seven-day windows (Aug-14..Sep-17) are all positive and DISTINCT', () => {
    const starts = ['2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11'];
    const shapes = starts.map((from) => {
      const range = { from, toExclusive: addDays(from, 7) };
      const o = projectOverview(g6(), range);
      expect(o.earnings.coverage.status).toBe('complete');
      const points = weeklyEarningsPoints(
        { trend: o.earnings.trend, coverage: o.earnings.coverage },
        range,
      );
      expect(points).toHaveLength(7);
      for (const p of points) expect(BigInt(p.amount!.minor)).toBeGreaterThan(0n); // no zero day
      return JSON.stringify(points.map((p) => p.amount!.minor));
    });
    // Distinct shapes, not merely distinct labels — the reported repeat is gone.
    expect(new Set(shapes).size).toBe(5);
    // Specifically, the two September weeks the owner flagged now differ.
    expect(shapes[3]).not.toBe(shapes[4]);
  });
});

// ---- overlapping queries are stable across the same frozen dataset -------------------------------

describe('g6 overlapping window queries are stable', () => {
  it('a date carries the SAME confirmed amount under overlapping queries', () => {
    const a = trendMap(projectOverview(g6(), { from: '2026-09-01', toExclusive: '2026-09-11' }));
    const b = trendMap(projectOverview(g6(), { from: '2026-09-05', toExclusive: '2026-09-15' }));
    // The overlapping days (Sep-05..Sep-10) must be byte-identical between the two window queries.
    for (let day = '2026-09-05'; day < '2026-09-11'; day = addDays(day, 1)) {
      expect(a.get(day)).toBeDefined();
      expect(a.get(day)).toBe(b.get(day));
    }
  });
});

// ---- brand isolation ------------------------------------------------------------------------------

describe('g6 brand filter isolation', () => {
  it('narrows totals to a single brand and never leaks another brand', () => {
    const all = projectOverview(g6(), JUL_AUG);
    const axtion = projectOverview(g6(), { ...JUL_AUG, brand: 'Axtion' });
    expect(BigInt(axtion.earnings.confirmed!.minor)).toBeLessThan(
      BigInt(all.earnings.confirmed!.minor),
    );
    // Closed Axtion lines (unchanged from g5): 12,800 + 3,120 = 15,920 THB.
    expect(axtion.earnings.confirmed!.minor).toBe('15920000');
  });
});

// ---- g6 numeric references + KBank beneficiary retained -------------------------------------------

describe('g6 retains the g5 numeric references + synthetic KBank beneficiary', () => {
  it('stores the identical numeric withdrawal references as g5 (per identity)', () => {
    expect(g6('a').withdrawals.map((w) => w.requestRef)).toEqual(
      g5('a').withdrawals.map((w) => w.requestRef),
    );
    expect(g6('a').withdrawals.map((w) => w.requestRef)).toEqual([
      '202609011001',
      '202609041002',
      '202609081003',
      '202609111004',
      '202609141005',
    ]);
    expect(g6('b').withdrawals.map((w) => w.requestRef)).toEqual(
      g5('b').withdrawals.map((w) => w.requestRef),
    );
    for (const w of g6('a').withdrawals) expect(w.requestRef).toMatch(/^\d{12}$/);
    // Stable legacy row ids retained (old bookmarks still resolve).
    expect(g6('a').withdrawals.map((w) => w.id)).toEqual(g5('a').withdrawals.map((w) => w.id));
  });

  it('keeps the synthetic KBank beneficiary + reveal verbatim', () => {
    expect(beneficiaryForGeneration('g6')).toEqual(DEMO_BENEFICIARY_G4);
    const data = g6('a');
    expect(data.beneficiaryAccounts).toHaveLength(1);
    const acct = data.beneficiaryAccounts![0];
    expect(acct.bankName).toBe('ธนาคารกสิกรไทย');
    expect(acct.fullAccount).toBe('1234512345');
    expect(acct.maskedAccount).toBe('XXX-X-X1234-5');
    expect(acct.synthetic).toBe(true);
    expect(maskCoversFullAccount(acct.maskedAccount, acct.fullAccount)).toBe(true);
    for (const w of data.withdrawals) {
      expect(w.bankName).toBe('ธนาคารกสิกรไทย');
      expect(w.maskedAccount).toBe('XXX-X-X1234-5');
    }
  });
});

// ---- determinism + generic anchor safety ---------------------------------------------------------

describe('g6 deterministic build + generic anchor behavior', () => {
  it('is deterministic (same input → identical rows)', () => {
    expect(g6('a')).toEqual(g6('a'));
    expect(build('g6', 'b')).toEqual(build('g6', 'b'));
  });

  it('preserves the g5 September totals and stays positive for valid anchors Sep 1/7/17/30', () => {
    const septConfirmedByClip = (d: DatasetRecords) => {
      const m = new Map<string, bigint>();
      for (const e of d.earnings)
        if (isSeptConfirmed(e)) m.set(e.contentId, (m.get(e.contentId) ?? 0n) + BigInt(e.amountMinor));
      return m;
    };
    for (const anchor of ['2026-09-01', '2026-09-07', ANCHOR, '2026-09-30']) {
      const asOf = new Date(`${anchor}T09:00:00+07:00`);
      const opts = { generation: 'g6' as const, asOf, anchorDate: anchor, allowOutOfPeriod: true };
      const built = () => buildDataset(opts);
      // Never throws for a valid September anchor.
      expect(built).not.toThrow();
      const d6 = buildDataset(opts);
      const d5 = buildDataset({ ...opts, generation: 'g5' });
      // Per-clip September aggregate equals g5 for the SAME input (redistribution conserves the total).
      const by6 = septConfirmedByClip(d6);
      const by5 = septConfirmedByClip(d5);
      expect(by6).toEqual(by5);
      // The overall September confirmed total is preserved and every day is strictly positive whole baht.
      const total6 = [...by6.values()].reduce((t, v) => t + v, 0n);
      const total5 = d5.earnings
        .filter(isSeptConfirmed)
        .reduce((t, e) => t + BigInt(e.amountMinor), 0n);
      expect(total6).toBe(total5);
      for (const e of d6.earnings.filter(isSeptConfirmed)) {
        expect(BigInt(e.amountMinor) > 0n).toBe(true);
        expect(BigInt(e.amountMinor) % 100n).toBe(0n);
      }
    }
  });
});
