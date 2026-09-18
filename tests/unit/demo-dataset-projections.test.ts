import { describe, expect, it } from 'vitest';
import { buildDataset, addDays } from '../../dev/demo-dataset/dataset';
import { datasetScope } from '../../dev/demo-dataset/scope';
import {
  projectOverview,
  projectContent,
  projectTransactions,
  projectDocument,
  getEffectiveDataset,
} from '../../dev/demo-dataset/projections';
import { bootstrapWithdrawal, withdrawalRowsFromRecords } from '../../dev/demo-dataset/bootstrap';
import { createWithdrawalController } from '../../dev/withdrawals/controller';
import { memoryStorage, type DevKeyValueStorage } from '../../dev/withdrawals/store';
import { weeklyEarningsPoints } from '@/features/overview/weekly-earnings';

// D165 — the coherent partner-demo dataset projections + withdrawal bootstrap seam. Every projection
// is validated against the EXISTING product contract inside the projection (so any drift throws at
// `*.parse`); these tests additionally reconcile the money story row-by-row, filter-by-filter, and
// prove the live-controller overlay stays conservative and matches the statement/document projection.

const ASOF = new Date('2026-09-17T09:00:00+07:00');
const ANCHOR = '2026-09-17';
const dataset = buildDataset({ asOf: ASOF });

// Authored money story (satang):
const RELEASED = 37_360_000n; // closed Jul–Aug confirmed commission (the released pool) = 373,600 THB
// September confirmed daily still covers ALL 17 days (Sep 1..17) so NO demo day shows a zero
// commission. Under the g6 default the latest-7 window (Sep 11..17) sums to 135,840; the 17-day
// total is unchanged at 322,000 THB.
const SEPT_CONFIRMED = 32_200_000n; // September confirmed-but-UNRELEASED daily = 322,000 THB
const LATEST_7 = 13_584_000n; // latest-7 window (g6 Sep 11..17) = 135,840 THB
const SEPT_ESTIMATED = 7_000_000n; // September estimated = 70,000 THB
const CURRENT_PENDING = SEPT_CONFIRMED + SEPT_ESTIMATED; // ยอดรอตัดรอบ = 392,000 THB
const INITIAL_SETTLED = 10_000_000n; // four varied PAID withdrawals = 100,000 THB
const INITIAL_RESERVED = 2_500_000n; // one PENDING 25,000 = 25,000 THB
const INITIAL_AVAILABLE = RELEASED - INITIAL_SETTLED - INITIAL_RESERVED; // 248,600 THB
const CLOSED_FROM = '2026-07-01'; // seed coverage floor (start of the closed Jul–Aug period)

const FULL = { from: '2026-07-01', toExclusive: '2026-10-01' };
const JUL_AUG = { from: '2026-07-01', toExclusive: '2026-09-01' };
const SEPT = { from: '2026-09-01', toExclusive: '2026-10-01' };

function counterId() {
  let n = 0;
  return { next: (prefix: string) => `${prefix}-${++n}` };
}

// ---- overview -------------------------------------------------------------------------------------

describe('projectOverview', () => {
  it('reconciles confirmed/estimated/eligible by filter window (parses the Overview contract)', () => {
    const julAug = projectOverview(dataset, JUL_AUG);
    expect(julAug.earnings.confirmed?.minor).toBe(RELEASED.toString());
    expect(julAug.earnings.estimated?.minor).toBe('0');

    const sept = projectOverview(dataset, SEPT);
    expect(sept.earnings.confirmed?.minor).toBe(SEPT_CONFIRMED.toString());
    expect(sept.earnings.estimated?.minor).toBe(SEPT_ESTIMATED.toString());

    const full = projectOverview(dataset, FULL);
    expect(full.earnings.confirmed?.minor).toBe((RELEASED + SEPT_CONFIRMED).toString());
    expect(full.earnings.estimated?.minor).toBe(SEPT_ESTIMATED.toString());
  });

  it('derives exact channel rates and platform/brand splits from rows', () => {
    const o = projectOverview(dataset, JUL_AUG);
    const ch = o.earnings.channelBreakdown!;
    expect(ch.organicRatePpm).toBe(100000);
    expect(ch.brandAdsRatePpm).toBe(30000);
    expect(BigInt(ch.organic.minor) + BigInt(ch.brandAds.minor)).toBe(RELEASED);
    // Sales-by-brand is sorted descending and every label resolves to a real clip brand.
    const brands = new Set(dataset.clips.map((c) => c.brand));
    for (const row of o.earnings.salesByBrand!) expect(brands.has(row.label)).toBe(true);
    // Each daily platform breakdown sums exactly to that day's sales (also enforced by the contract).
    for (const p of o.earnings.trend)
      if (p.salesByPlatform?.length)
        expect(p.salesByPlatform.reduce((t, s) => t + BigInt(s.sales.minor), 0n)).toBe(
          BigInt(p.sales!.minor),
        );
  });

  it('every commission clears the 3% floor with an exact rate; aggregates use corresponding bases', () => {
    // Owner steering: each commission is >= 3% of its OWN eligible sales, at the exact authored rate
    // (organic 10% / brand ads 3%). Checked per row as an integer relation (no float drift).
    for (const e of dataset.earnings) {
      expect(e.kind).toBe('commission');
      expect(BigInt(e.amountMinor) * 100n >= BigInt(e.eligibleBaseMinor) * 3n).toBe(true);
      expect(BigInt(e.amountMinor) * 1_000_000n).toBe(BigInt(e.eligibleBaseMinor) * BigInt(e.ratePpm));
      expect([100000, 30000]).toContain(e.ratePpm);
    }

    // Closed aggregate blends organic + brand ads → 373,600 / 5,500,000 ≈ 6.79% (not a single rate),
    // still clearing the floor and staying under the 10% organic ceiling.
    const julAug = projectOverview(dataset, JUL_AUG);
    const closedBase = BigInt(julAug.earnings.eligibleSales!.minor);
    expect(closedBase).toBe(550_000_000n);
    expect(BigInt(julAug.earnings.confirmed!.minor)).toBe(RELEASED);
    expect(RELEASED * 100n >= closedBase * 3n).toBe(true);
    expect(Number(RELEASED) / Number(closedBase)).toBeCloseTo(0.0679, 4);

    // Displayed confirmed sales pair with confirmed commission: eligibleSales is now the base of
    // CONFIRMED commission ONLY (matching the UI's 'ยอดขายที่ยืนยันแล้ว' label), so the confirmed
    // amount clears 3% of the confirmed base with NO estimated-base contamination. Estimated bases stay
    // on the estimated lines (checked per raw earning line above, both statuses).
    const sept = projectOverview(dataset, SEPT);
    const septBase = BigInt(sept.earnings.eligibleSales!.minor);
    expect(septBase).toBe(322_000_000n); // 3,220,000 THB confirmed sales
    const septAmt = BigInt(sept.earnings.confirmed!.minor);
    expect(septAmt).toBe(SEPT_CONFIRMED);
    expect(septAmt * 100n >= septBase * 3n).toBe(true);
    // Estimated bases (1,400,000 THB) are NOT folded into the confirmed sales figure.
    expect(BigInt(sept.earnings.estimated!.minor)).toBe(SEPT_ESTIMATED);
  });

  it('named platform sales reconcile to eligibleSales for every window and each brand', () => {
    // The UI excludes 'unattributed' (owner D142); the g2 dataset is fully NAMED, so the named platform
    // subtotals sum EXACTLY to eligibleSales (CONFIRMED base only, the displayed confirmed sales) for
    // every scope — the platform bars reconcile to the confirmed headline, no estimated base leaks in.
    const namedTotal = (o: ReturnType<typeof projectOverview>) =>
      o.earnings.trend.reduce(
        (t, p) =>
          t +
          (p.salesByPlatform ?? [])
            .filter((s) => s.platform !== 'unattributed')
            .reduce((u, s) => u + BigInt(s.sales.minor), 0n),
        0n,
      );
    for (const window of [JUL_AUG, SEPT, FULL]) {
      const o = projectOverview(dataset, window);
      expect(namedTotal(o)).toBe(BigInt(o.earnings.eligibleSales!.minor));
    }
    for (const brand of new Set(dataset.clips.map((c) => c.brand))) {
      const o = projectOverview(dataset, { ...FULL, brand });
      expect(namedTotal(o)).toBe(BigInt(o.earnings.eligibleSales!.minor));
    }
  });

  it('a confirmed day pairs its commission with the confirmed base ONLY (estimated never contaminates)', () => {
    // 2026-09-12 carries BOTH a confirmed daily line AND a September estimated line. The displayed daily
    // sales are the sale paired with the confirmed daily amount ('ยอดขายที่ยืนยันแล้ว'), so the sale
    // equals the CONFIRMED base exactly (amount × 10 at the organic 10% rate) — the estimated commission
    // is exposed on the estimated earning lines, NEVER folded into this confirmed daily sale/amount.
    const day = projectOverview(dataset, SEPT).earnings.trend.find((p) => p.date === '2026-09-12')!;
    expect(BigInt(day.amount.minor)).toBeGreaterThan(0n);
    const confirmedBase = BigInt(day.amount.minor) * 10n; // organic 10% → eligible base = amount × 10
    expect(BigInt(day.sales!.minor)).toBe(confirmedBase);
    // Sep-12 confirmed pair: commission 15,081 THB, sale 150,810 THB.
    expect(day.amount.minor).toBe('1508100');
    expect(day.sales!.minor).toBe('15081000');
  });

  it('every displayed confirmed day pairs commission with confirmed sales >= 3% (regression Sep-15 / Sep-12)', () => {
    const sept = projectOverview(dataset, SEPT).earnings;
    // Regression: the two authored September days that also carry an estimated line still display ONLY
    // the confirmed pair — commission and its confirmed base — never the estimated base.
    const sep15 = sept.trend.find((p) => p.date === '2026-09-15')!;
    expect(sep15.amount.minor).toBe('2266600'); // 22,666 THB confirmed commission
    expect(sep15.sales!.minor).toBe('22666000'); // 226,660 THB confirmed sale
    const sep12 = sept.trend.find((p) => p.date === '2026-09-12')!;
    expect(sep12.amount.minor).toBe('1508100'); // 15,081 THB confirmed commission
    expect(sep12.sales!.minor).toBe('15081000'); // 150,810 THB confirmed sale
    // EVERY displayed day with a positive confirmed commission clears the owner's 3% floor on its
    // displayed confirmed sale, and no displayed day carries a sale without a paired confirmed amount.
    for (const p of sept.trend) {
      expect(BigInt(p.amount.minor)).toBeGreaterThan(0n);
      expect(BigInt(p.sales!.minor)).toBeGreaterThan(0n);
      expect(BigInt(p.amount.minor) * 100n >= BigInt(p.sales!.minor) * 3n).toBe(true);
    }
  });

  it('brand filter narrows totals to that brand only', () => {
    const all = projectOverview(dataset, JUL_AUG);
    const axtion = projectOverview(dataset, { ...JUL_AUG, brand: 'Axtion' });
    expect(BigInt(axtion.earnings.confirmed!.minor)).toBeLessThan(
      BigInt(all.earnings.confirmed!.minor),
    );
    // Axtion closed lines: 12,800 (organic) + 3,120 (brand ads) = 15,920 THB.
    expect(axtion.earnings.confirmed!.minor).toBe('15920000');
  });

  it('latest-7 window renders 7 positive daily points summing to 135,840 (no zero day)', () => {
    const range = { from: addDays(ANCHOR, -6), toExclusive: addDays(ANCHOR, 1) };
    const o = projectOverview(dataset, range);
    // The demo window is fully seeded, so its coverage is complete.
    expect(o.earnings.coverage.status).toBe('complete');
    const points = weeklyEarningsPoints(
      { trend: o.earnings.trend, coverage: o.earnings.coverage },
      range,
    );
    expect(points).toHaveLength(7);
    // Owner steering: NO demo day shows a zero commission — every one of the 7 days is positive.
    const positive = points.filter((p) => p.amount && BigInt(p.amount.minor) > 0n);
    expect(positive).toHaveLength(7);
    // The 7 points reconcile to the latest-7 confirmed total (g6 Sep 11..17 = 135,840 THB).
    const sum = points.reduce((t, p) => t + BigInt(p.amount?.minor ?? '0'), 0n);
    expect(sum).toBe(LATEST_7);
  });

  it('every weekly window inside the seed period is fully positive; a prior window is unknown', () => {
    // Walk each aligned 7-day window across the whole authored seed period. Every covered day now
    // carries a confirmed commission, so no point is a fully-covered zero and none is a gap.
    for (
      let from = CLOSED_FROM;
      addDays(from, 7) <= addDays(ANCHOR, 1);
      from = addDays(from, 7)
    ) {
      const range = { from, toExclusive: addDays(from, 7) };
      const o = projectOverview(dataset, range);
      const points = weeklyEarningsPoints(
        { trend: o.earnings.trend, coverage: o.earnings.coverage },
        range,
      );
      expect(points).toHaveLength(7);
      for (const p of points) {
        expect(p.amount).not.toBeNull();
        expect(BigInt(p.amount!.minor)).toBeGreaterThan(0n);
      }
    }

    // A window entirely BEFORE the seed floor is genuinely unknown: unavailable coverage, null
    // confirmed projection (never a fabricated zero), and every weekly point is a null gap.
    const prior = { from: '2026-06-01', toExclusive: '2026-06-08' };
    const outside = projectOverview(dataset, prior);
    expect(outside.earnings.coverage.status).toBe('unavailable');
    expect(outside.earnings.confirmed).toBeNull();
    expect(outside.earnings.trend).toHaveLength(0);
    const priorPoints = weeklyEarningsPoints(
      { trend: outside.earnings.trend, coverage: outside.earnings.coverage },
      prior,
    );
    for (const p of priorPoints) expect(p.amount).toBeNull();
  });

  it('obligation reflects the released pool minus settled, independent of the date filter', () => {
    const a = projectOverview(dataset, JUL_AUG).obligation;
    const b = projectOverview(dataset, SEPT).obligation;
    // statement-1 closing = released − settled(initial 4 paid) = 273,600 THB.
    expect(a.confirmedUnpaid?.minor).toBe((RELEASED - INITIAL_SETTLED).toString());
    expect(b.confirmedUnpaid?.minor).toBe(a.confirmedUnpaid?.minor);
    expect(a.nextPayout?.statementId).toBe('statement-1');
  });

  it('TopContent equals the same clips shown in Content for the same scope', () => {
    const o = projectOverview(dataset, FULL);
    const list = projectContent(dataset, { resource: 'list', context: { ...FULL, q: '' } }) as {
      data: { items: { id: string }[] };
    };
    const listIds = new Set(list.data.items.map((c) => c.id));
    for (const top of o.earnings.topContent) expect(listIds.has(top.id)).toBe(true);
  });
});

// ---- content --------------------------------------------------------------------------------------

describe('projectContent', () => {
  const ctx = { ...FULL, q: '' };

  it('list/detail/earnings/ads/ad all parse and preserve applyAdSample ids', () => {
    const list = projectContent(dataset, { resource: 'list', context: ctx }) as {
      data: { items: { id: string; adReferences?: unknown }[] };
    };
    const clip3 = list.data.items.find((c) => c.id === 'clip-3')!;
    // clip-3 carries the verified Tendrix ad references via the shared overlay.
    expect(clip3.adReferences).toEqual([{ platform: 'facebook', externalId: '52513673563767' }]);

    const detail = projectContent(dataset, {
      resource: 'detail',
      context: ctx,
      contentId: 'clip-3',
    }) as { data: { content: { id: string }; earningsStatus: string } };
    expect(detail.data.content.id).toBe('clip-3');
    expect(detail.data.earningsStatus).toBe('confirmed');

    const earnings = projectContent(dataset, {
      resource: 'earnings',
      context: ctx,
      contentId: 'clip-3',
    }) as { data: { items: { contentId: string; earnedAt: string }[] } };
    expect(earnings.data.items.length).toBeGreaterThan(0);
    for (const line of earnings.data.items) {
      expect(line.contentId).toBe('clip-3');
      expect(line.earnedAt >= '2026-07-01').toBe(true);
      expect(line.earnedAt < '2026-10-01').toBe(true);
    }

    const ads = projectContent(dataset, { resource: 'ads', context: ctx, contentId: 'clip-3' }) as {
      data: { items: { id: string }[]; totalCount: number | null; nextCursor: string | null };
    };
    // Three ads per clip, paginated (limit 2) exactly like the accepted transport: the first page holds
    // two and advertises the next page — pagination is preserved, not collapsed to return all three.
    expect(ads.data.totalCount).toBe(3);
    expect(ads.data.items).toHaveLength(2);
    expect(ads.data.nextCursor).toBe('offset-2');
    const ad = projectContent(dataset, {
      resource: 'ad',
      context: ctx,
      contentId: 'clip-3',
      adId: 'clip-3-ad-1',
    }) as { data: { id: string; metrics: { key: string; value: number | null; unavailableReason: string | null }[] } };
    expect(ad.data.id).toBe('clip-3-ad-1');
    // Every monetary ad metric is explicitly UNKNOWN — never an old hardcoded 128000/9000 constant.
    for (const key of ['platform_value', 'spend', 'roas']) {
      const metric = ad.data.metrics.find((m) => m.key === key)!;
      expect(metric.value).toBeNull();
      expect(metric.unavailableReason).toBeTruthy();
    }
  });

  it('earnings pagination walks many daily lines that reconcile to the clip total at the exact rate', () => {
    // New seed: the closed period spreads one clip/day in rotation, so clip-3 now has MANY daily lines
    // across the window (well beyond the 2-per-page limit). Page through EVERY page and reconcile.
    const list = projectContent(dataset, { resource: 'list', context: ctx }) as {
      data: { items: { id: string; earned: { minor: string } | null }[] };
    };
    const card = list.data.items.find((c) => c.id === 'clip-3')!;

    type Line = { contentId: string; amount: { minor: string }; eligibleBase: { minor: string }; ratePpm: number; earnedAt: string };
    const lines: Line[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let totalCount = 0;
    do {
      const page = projectContent(dataset, {
        resource: 'earnings',
        context: ctx,
        contentId: 'clip-3',
        cursor,
      }) as { data: { items: Line[]; nextCursor: string | null; totalCount: number } };
      expect(page.data.items.length).toBeLessThanOrEqual(2); // pagination preserved (limit 2)
      lines.push(...page.data.items);
      totalCount = page.data.totalCount;
      cursor = page.data.nextCursor;
      pages += 1;
    } while (cursor);

    // Many line items spanning multiple pages, fully collected.
    expect(pages).toBeGreaterThan(1);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.length).toBe(totalCount);
    for (const line of lines) {
      expect(line.contentId).toBe('clip-3');
      expect(line.earnedAt >= '2026-07-01').toBe(true);
      expect(line.earnedAt < '2026-10-01').toBe(true);
      // Every line's amount is EXACT at its authored rate: amount × 1e6 == eligibleBase × ratePpm.
      expect(BigInt(line.amount.minor) * 1_000_000n).toBe(
        BigInt(line.eligibleBase.minor) * BigInt(line.ratePpm),
      );
    }
    // Summed across ALL pages, the lines reconcile to the clip's confirmed card total (clip-3 carries
    // no estimated line, so summed line amounts equal the confirmed card earned).
    const summed = lines.reduce((t, l) => t + BigInt(l.amount.minor), 0n);
    expect(summed.toString()).toBe(card.earned!.minor);
  });

  it('every clip detail with positive confirmed commission pairs it with confirmed sales >= 3% (no estimated base)', () => {
    // Detail eligibleSales is now the sale paired with the clip's CONFIRMED commission label
    // ('ยอดขายที่ยืนยันแล้ว'); a clip's card earned is likewise confirmed-only. So every clip that shows
    // a positive confirmed commission also shows a positive confirmed sale clearing the 3% floor, with
    // no estimated base folded into the displayed sale.
    const list = projectContent(dataset, { resource: 'list', context: ctx }) as {
      data: { items: { id: string; earned: { minor: string } | null }[] };
    };
    for (const card of list.data.items) {
      const commission = BigInt(card.earned?.minor ?? '0');
      const detail = projectContent(dataset, {
        resource: 'detail',
        context: ctx,
        contentId: card.id,
      }) as { data: { eligibleSales: { minor: string } | null } };
      if (commission > 0n) {
        const sales = BigInt(detail.data.eligibleSales!.minor);
        expect(sales).toBeGreaterThan(0n);
        expect(commission * 100n >= sales * 3n).toBe(true);
      }
    }
  });

  it('search + brand filter scope the list; unknown clip throws not_found', () => {
    const tendrix = projectContent(dataset, {
      resource: 'list',
      context: { ...ctx, brand: 'Tendrix' },
    }) as { data: { items: { brand: string }[] } };
    for (const c of tendrix.data.items) expect(c.brand).toBe('Tendrix');
    expect(() =>
      projectContent(dataset, { resource: 'detail', context: ctx, contentId: 'clip-does-not-exist' }),
    ).toThrow();
  });
});

// ---- transactions + documents ---------------------------------------------------------------------

describe('projectTransactions / projectDocument', () => {
  it('lists only statement-1 (no fake previous) and reconciles the bridge', () => {
    const list = projectTransactions(dataset, { resource: 'list' }) as {
      data: { items: { id: string; status: string }[] };
      confirmedUnpaid: { minor: string };
    };
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0].id).toBe('statement-1');
    expect(list.data.items[0].status).toBe('part-paid');

    const detail = projectTransactions(dataset, {
      resource: 'detail',
      statementId: 'statement-1',
    }) as {
      data: {
        statement: { newEarnings: { minor: string }; settled: { minor: string }; closing: { minor: string } };
        lines: { items: unknown[] };
        settlements: { items: unknown[] };
        documents: { id: string }[];
      };
    };
    expect(detail.data.statement.newEarnings.minor).toBe(RELEASED.toString());
    expect(detail.data.statement.settled.minor).toBe(INITIAL_SETTLED.toString());
    expect(detail.data.statement.closing.minor).toBe((RELEASED - INITIAL_SETTLED).toString());
    // The released pool spreads one confirmed line per closed day (62 = Jul 31 + Aug 31); the line
    // amounts sum EXACTLY to the released newEarnings (373,600 THB), never restated.
    expect(detail.data.lines.items).toHaveLength(62);
    const summedReleased = (detail.data.lines.items as { amount: { minor: string } }[]).reduce(
      (t, l) => t + BigInt(l.amount.minor),
      0n,
    );
    expect(summedReleased).toBe(RELEASED);
    expect(detail.data.settlements.items).toHaveLength(4);
  });

  it('unknown statement id throws', () => {
    expect(() => projectTransactions(dataset, { resource: 'detail', statementId: 'statement-2' })).toThrow();
    expect(() => projectDocument(dataset, 'statement-2', 'statement-document')).toThrow();
  });

  it('statement + payment-evidence CSV documents carry exact satang', () => {
    const statementCsv = projectDocument(dataset, 'statement-1', 'statement-document');
    expect(statementCsv).toContain(`newEarnings_satang,${RELEASED}`);
    expect(statementCsv).toContain(`settled_satang,${INITIAL_SETTLED}`);
    const detail = projectTransactions(dataset, { resource: 'detail', statementId: 'statement-1' }) as {
      data: { documents: { id: string; kind: string }[] };
    };
    const evidence = detail.data.documents.find((d) => d.kind === 'payment-evidence')!;
    const evidenceCsv = projectDocument(dataset, 'statement-1', evidence.id);
    expect(evidenceCsv).toContain('payment_reference,');
    expect(evidenceCsv).toContain('cash_satang,1250000');
  });
});

// ---- bootstrap + controller -----------------------------------------------------------------------

describe('bootstrapWithdrawal / controller seam', () => {
  it('builds a scenario override with settled 0, released pool and full current pending', () => {
    const scope = datasetScope(dataset, 'a');
    const { scenarioOverride, initialState } = bootstrapWithdrawal(dataset, scope);
    expect(scenarioOverride.base.released).toBe(RELEASED.toString());
    expect(scenarioOverride.base.settled).toBe('0');
    // ยอดรอตัดรอบ = confirmed-unreleased + estimated (NOT only estimated).
    expect(scenarioOverride.currentPeriodPending).toBe(CURRENT_PENDING.toString());
    expect(initialState.requests).toHaveLength(5);
    expect(initialState.requests.filter((r) => r.status === 'paid')).toHaveLength(4);
  });

  it('seeds a fresh namespace to settled 100,000 / reserved 25,000 / available 248,600', () => {
    const scope = datasetScope(dataset, 'a');
    const controller = createWithdrawalController({
      scope,
      storage: memoryStorage(),
      idGen: counterId(),
      clock: { now: () => ASOF },
      bootstrap: bootstrapWithdrawal(dataset, scope),
    });
    const summary = controller.summary();
    expect(summary.balance.state).toBe('known');
    if (summary.balance.state !== 'known') throw new Error('unreachable');
    expect(summary.balance.settled.minor).toBe(INITIAL_SETTLED.toString());
    expect(summary.balance.reserved.minor).toBe(INITIAL_RESERVED.toString());
    expect(summary.balance.available.minor).toBe(INITIAL_AVAILABLE.toString());
    expect(summary.currentPeriodPending?.minor).toBe(CURRENT_PENDING.toString());
    // Last withdrawal = the newest genuinely PAID row (Sep-12), its ACTUAL net cash — not an aggregate.
    expect(summary.lastWithdrawal?.net.minor).toBe('3675000');
    expect(summary.lastWithdrawal?.paidAt).toBe('2026-09-12T13:24:00+07:00');
  });

  it('existing stored state wins on restore (the seed never overwrites a live session)', () => {
    const scope = datasetScope(dataset, 'a');
    const storage = memoryStorage();
    const boot = bootstrapWithdrawal(dataset, scope);
    const first = createWithdrawalController({ scope, storage, idGen: counterId(), clock: { now: () => ASOF }, bootstrap: boot });
    const before = first.summary();
    if (before.balance.state !== 'known') throw new Error('unreachable');
    const second = createWithdrawalController({ scope, storage, idGen: counterId(), clock: { now: () => ASOF }, bootstrap: boot });
    const after = second.summary();
    if (after.balance.state !== 'known') throw new Error('unreachable');
    expect(after.balance.available.minor).toBe(before.balance.available.minor);
    expect(second.list().items).toHaveLength(5);
  });

  it('quote → submit → cancel → paid conserves money and matches the statement/document projection', () => {
    const scope = datasetScope(dataset, 'a');
    const controller = createWithdrawalController({
      scope,
      storage: memoryStorage(),
      idGen: counterId(),
      clock: { now: () => ASOF },
      bootstrap: bootstrapWithdrawal(dataset, scope),
    });
    // This test cancels a freshly-submitted request; automatic initiation now advances a NEW submit
    // to `processing` (not cancellable). Seed a legacy `requested` record via the explicit test-only
    // initiation seam to preserve the cancel→paid conservation coverage without weakening it.
    controller.setSubmitInitiationMode('legacy_manual');
    const overlayNow = () => collectOverlay(controller);

    // Submit a NEW 25,000 request → reserved grows, available shrinks by the gross.
    const submitted = submit(controller, scope, 'idem-new-1');
    let summary = controller.summary();
    if (summary.balance.state !== 'known') throw new Error('unreachable');
    expect(summary.balance.reserved.minor).toBe((INITIAL_RESERVED + 2_500_000n).toString());
    expect(summary.balance.available.minor).toBe((INITIAL_AVAILABLE - 2_500_000n).toString());

    // Overlay stays conservative and the statement settled is unchanged (nothing new is paid yet).
    const rows1 = overlayNow();
    const eff1 = getEffectiveDataset(dataset, rows1);
    const st1 = projectTransactions(dataset, { resource: 'detail', statementId: 'statement-1' }, rows1) as {
      data: { statement: { settled: { minor: string } } };
    };
    expect(st1.data.statement.settled.minor).toBe(INITIAL_SETTLED.toString());
    expect(eff1.withdrawals.filter((w) => w.status === 'paid')).toHaveLength(4);

    // Cancel it → reserve released exactly once (back to the initial figures).
    const cancel = controller.cancel({
      scope,
      requestRef: submitted.requestRef,
      requestIdempotencyKey: 'idem-new-1',
      operationKey: 'op-cancel-1',
      expectedRevision: controller.summary().revision,
    });
    expect(cancel.outcome).toBe('cancelled');
    summary = controller.summary();
    if (summary.balance.state !== 'known') throw new Error('unreachable');
    expect(summary.balance.available.minor).toBe(INITIAL_AVAILABLE.toString());

    // Submit + mark PAID → settled grows by the gross; the statement + document projection agree.
    const paidReq = submit(controller, scope, 'idem-new-2');
    controller.markPaid(paidReq.requestRef);
    const rows2 = overlayNow();
    const st2 = projectTransactions(dataset, { resource: 'detail', statementId: 'statement-1' }, rows2) as {
      data: { statement: { settled: { minor: string }; closing: { minor: string } }; settlements: { items: { evidenceRef: string }[] } };
    };
    expect(st2.data.statement.settled.minor).toBe((INITIAL_SETTLED + 2_500_000n).toString());
    expect(st2.data.settlements.items).toHaveLength(5);
    const doc = projectDocument(dataset, 'statement-1', st2.data.settlements.items.at(-1)!.evidenceRef, rows2);
    expect(doc).toContain('cash_satang,2500000');

    // Conservation: released == available + settled + reserved + held (held 0).
    const finalSummary = controller.summary();
    if (finalSummary.balance.state !== 'known') throw new Error('unreachable');
    expect(
      BigInt(finalSummary.balance.available.minor) +
        BigInt(finalSummary.balance.settled.minor) +
        BigInt(finalSummary.balance.reserved.minor),
    ).toBe(RELEASED);
  });

  it('isolates A/B and generations; a submit on one never leaks into another', () => {
    // The default generation is server-owned and separate, so build BOTH generations EXPLICITLY — a g1
    // baseline and the g2 other — independent of the default (relying on it would collide storage scopes).
    const datasetG1 = buildDataset({ generation: 'g1', asOf: ASOF });
    const datasetG2 = buildDataset({ generation: 'g2', asOf: ASOF });
    const datasetB = buildDataset({ datasetId: 'partner-demo-b', asOf: ASOF });
    const scopeG1 = datasetScope(datasetG1, 'a');
    const scopeG2 = datasetScope(datasetG2, 'a');
    const scopeB = datasetScope(datasetB, 'b');
    const storage = memoryStorage();
    const g1 = createWithdrawalController({ scope: scopeG1, storage, idGen: counterId(), clock: { now: () => ASOF }, bootstrap: bootstrapWithdrawal(datasetG1, scopeG1) });
    const b = createWithdrawalController({ scope: scopeB, storage, idGen: counterId(), clock: { now: () => ASOF }, bootstrap: bootstrapWithdrawal(datasetB, scopeB) });
    const g2 = createWithdrawalController({ scope: scopeG2, storage, idGen: counterId(), clock: { now: () => ASOF }, bootstrap: bootstrapWithdrawal(datasetG2, scopeG2) });

    submit(g1, scopeG1, 'idem-a');
    expect(g1.list().items).toHaveLength(6);
    // The g2 generation and the b side keep their own seeded five, untouched.
    expect(b.list().items).toHaveLength(5);
    expect(g2.list().items).toHaveLength(5);
  });

  it('rejects a bootstrap aimed at a non-partner-demo scenario', () => {
    const scope = { ...datasetScope(dataset, 'a'), scenario: 'golden' };
    expect(() =>
      createWithdrawalController({
        scope,
        storage: memoryStorage(),
        bootstrap: bootstrapWithdrawal(dataset, datasetScope(dataset, 'a')),
      }),
    ).toThrow();
  });

  it('an unreadable fresh restore throws (never an empty overlay that fakes availability)', () => {
    const scope = datasetScope(dataset, 'a');
    const inner = memoryStorage();
    const faulted: DevKeyValueStorage = {
      getItem: () => {
        throw new Error('read outage');
      },
      setItem: (k, v) => inner.setItem(k, v),
      removeItem: (k) => inner.removeItem(k),
    };
    const controller = createWithdrawalController({
      scope,
      storage: faulted,
      idGen: counterId(),
      clock: { now: () => ASOF },
      bootstrap: bootstrapWithdrawal(dataset, scope),
    });
    expect(() => controller.list()).toThrow();
  });
});

// ---- getEffectiveDataset overlay is complete + authoritative --------------------------------------

describe('getEffectiveDataset overlay semantics', () => {
  it('an empty overlay withdraws all seeded rows (no seed resurrection)', () => {
    const eff = getEffectiveDataset(dataset, []);
    expect(eff.withdrawals).toHaveLength(0);
    expect(eff.settlements).toHaveLength(0);
    // The statement therefore shows nothing settled and closing == the full released pool.
    const st = projectTransactions(dataset, { resource: 'detail', statementId: 'statement-1' }, []) as {
      data: { statement: { settled: { minor: string }; closing: { minor: string } }; settlements: { items: unknown[] } };
    };
    expect(st.data.statement.settled.minor).toBe('0');
    expect(st.data.statement.closing.minor).toBe(RELEASED.toString());
    expect(st.data.settlements.items).toHaveLength(0);
  });

  it('undefined overlay leaves the initial seeded story untouched', () => {
    // No overlay ⇒ dataset verbatim: the four seeded PAID settlements still stand.
    const eff = getEffectiveDataset(dataset);
    expect(eff.withdrawals).toHaveLength(5);
    expect(eff.settlements).toHaveLength(4);
  });

  it('rejects a foreign-scope overlay row and a duplicate requestRef', () => {
    const [seed] = dataset.withdrawals;
    expect(() => getEffectiveDataset(dataset, [{ ...seed, generation: 'g1' }])).toThrow(/out of scope/);
    expect(() =>
      getEffectiveDataset(dataset, [{ ...seed, datasetId: 'partner-demo-b' }]),
    ).toThrow(/out of scope/);
    expect(() => getEffectiveDataset(dataset, [seed, { ...seed }])).toThrow(/duplicate/);
  });
});

// ---- shared submit helper -------------------------------------------------------------------------

function submit(
  controller: ReturnType<typeof createWithdrawalController>,
  scope: ReturnType<typeof datasetScope>,
  idempotencyKey: string,
) {
  const quote = controller.quote('2500000');
  if (quote.state !== 'quoted') throw new Error(`quote unavailable: ${JSON.stringify(quote)}`);
  const result = controller.submit({
    scope,
    idempotencyKey,
    quoteId: quote.quoteId,
    gross: quote.gross,
    net: quote.net,
    bindings: quote.bindings,
  });
  if (result.outcome !== 'accepted') throw new Error(`submit not accepted: ${JSON.stringify(result)}`);
  return result.request;
}

// Rebuild the full persisted records from the PUBLIC controller surface (list() cores + detail(ref)
// timeline/history/source context), then map them to dataset overlay rows — the sanctioned overlay
// path. This is exactly what the UI wiring does to feed the monetary projections live settlements.
type OverlayRecord = Parameters<typeof withdrawalRowsFromRecords>[0][number];
function collectOverlay(controller: ReturnType<typeof createWithdrawalController>) {
  const records: OverlayRecord[] = controller.list().items.map((core) => {
    const d = controller.detail(core.requestRef);
    if (d.state !== 'found') throw new Error(`detail missing for ${core.requestRef}`);
    return {
      ...core,
      timeline: d.detail.timeline,
      historyComplete: d.detail.historyComplete,
      sourceContext: d.detail.sourceContext,
    } as OverlayRecord;
  });
  return withdrawalRowsFromRecords(records);
}
