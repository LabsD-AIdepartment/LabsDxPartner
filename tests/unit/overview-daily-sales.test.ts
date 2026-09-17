import { describe, expect, it } from 'vitest';
import { Overview } from '@/contracts/overview';
import { overviewFixture, overviewRows } from '../../dev/overview-transport';

const m = (minor: string) => ({ currency: 'THB' as const, minor });
const win = (from: string, toExclusive: string) => ({
  from: `${from}T00:00:00+07:00`,
  toExclusive: `${toExclusive}T00:00:00+07:00`,
  timezone: 'Asia/Bangkok' as const,
});

/** Build a valid ready Overview whose confirmed total reconciles to the supplied trend amounts. */
function overviewWith(trend: unknown[], extra: Record<string, unknown> = {}) {
  const period = win('2026-08-01', '2026-08-03');
  const confirmed = (trend as { amount: { minor: string } }[]).reduce(
    (sum, point) => sum + BigInt(point.amount.minor),
    0n,
  );
  return Overview.safeParse({
    dataState: 'ready',
    generatedAt: '2026-08-03T00:00:00Z',
    dataThrough: '2026-08-03T00:00:00Z',
    reasons: [],
    requestId: 'req-1',
    earnings: {
      generation: '1',
      period,
      coverage: { status: 'complete', periods: [period] },
      estimated: m('0'),
      confirmed: m(confirmed.toString()),
      eligibleSales: m('0'),
      unassignedAmount: m('0'),
      excludedCount: 0,
      trend,
      topContent: [],
      ...extra,
    },
    obligation: { asOf: '2026-08-03T00:00:00Z', confirmedUnpaid: m('0'), nextPayout: null },
  });
}
const point = (extra: Record<string, unknown> = {}) => ({
  date: '2026-08-01',
  amount: m('100'),
  ...extra,
});

describe('Overview daily-sales contract', () => {
  it('accepts a legacy trend point that omits sales/salesByPlatform entirely', () => {
    expect(overviewWith([point()]).success).toBe(true);
  });
  it('accepts explicit null sales with null breakdown (unknown, never zero)', () => {
    expect(overviewWith([point({ sales: null, salesByPlatform: null })]).success).toBe(true);
  });
  it('rejects a platform breakdown when the daily sales figure is unknown (null)', () => {
    expect(
      overviewWith([point({ sales: null, salesByPlatform: [{ platform: 'web', sales: m('1') }] })])
        .success,
    ).toBe(false);
  });
  it('rejects a breakdown that repeats a platform', () => {
    expect(
      overviewWith([
        point({
          sales: m('2'),
          salesByPlatform: [
            { platform: 'web', sales: m('1') },
            { platform: 'web', sales: m('1') },
          ],
        }),
      ]).success,
    ).toBe(false);
  });
  it('rejects a breakdown that does not sum exactly to the daily sales', () => {
    expect(
      overviewWith([
        point({
          sales: m('5'),
          salesByPlatform: [
            { platform: 'web', sales: m('1') },
            { platform: 'tiktok', sales: m('1') },
          ],
        }),
      ]).success,
    ).toBe(false);
  });
  it('accepts a unique breakdown that sums exactly to the daily sales', () => {
    expect(
      overviewWith([
        point({
          sales: m('2'),
          salesByPlatform: [
            { platform: 'web', sales: m('1') },
            { platform: 'tiktok', sales: m('1') },
          ],
        }),
      ]).success,
    ).toBe(true);
  });
  it('preserves signed correction bases: a negative breakdown summing to negative sales is valid', () => {
    expect(
      overviewWith([
        point({
          amount: m('-100'),
          sales: m('-100'),
          salesByPlatform: [
            { platform: 'facebook', sales: m('-60') },
            { platform: 'tiktok', sales: m('-40') },
          ],
        }),
      ]).success,
    ).toBe(true);
  });
  it('accepts a genuine zero: sales 0 with an empty breakdown or an explicit unattributed 0', () => {
    expect(overviewWith([point({ amount: m('0'), sales: m('0'), salesByPlatform: [] })]).success).toBe(
      true,
    );
    expect(
      overviewWith([
        point({ amount: m('0'), sales: m('0'), salesByPlatform: [{ platform: 'unattributed', sales: m('0') }] }),
      ]).success,
    ).toBe(true);
  });
  it('rejects malformed money in the detail without throwing a BigInt exception', () => {
    expect(() =>
      expect(
        overviewWith([
          point({ sales: m('100'), salesByPlatform: [{ platform: 'web', sales: { currency: 'THB', minor: '1.5' } }] }),
        ]).success,
      ).toBe(false),
    ).not.toThrow();
    expect(() =>
      expect(overviewWith([point({ sales: { currency: 'THB', minor: 'x' } })]).success).toBe(false),
    ).not.toThrow();
  });
  it('does NOT cross-check the trend sales total against earnings.eligibleSales', () => {
    // eligibleSales may include estimated current-period sales; the trend is confirmed-only, so a
    // deliberate mismatch between the two totals must still validate.
    expect(
      overviewWith([point({ sales: m('100'), salesByPlatform: [{ platform: 'web', sales: m('100') }] })], {
        eligibleSales: m('999999'),
      }).success,
    ).toBe(true);
  });
});

const platforms = (data: ReturnType<typeof overviewFixture>) =>
  data.earnings.trend.flatMap((p) => (p.salesByPlatform ?? []).map((e) => e.platform));

describe('dev overviewFixture derives daily sales + a synthetic platform split that reconciles', () => {
  const readyFilters = { from: '2026-08-01', toExclusive: '2026-09-01', brand: null };
  it('every day: breakdown platforms are unique and sum exactly to the day sales', () => {
    const data = overviewFixture(readyFilters, 'ready');
    expect(data.earnings.trend.length).toBeGreaterThan(0);
    for (const p of data.earnings.trend) {
      expect(p.sales).not.toBeNull();
      const names = (p.salesByPlatform ?? []).map((e) => e.platform);
      expect(new Set(names).size).toBe(names.length);
      const sum = (p.salesByPlatform ?? []).reduce((n, e) => n + BigInt(e.sales.minor), 0n);
      expect(sum).toBe(BigInt(p.sales!.minor));
    }
  });
  it('exercises all five named platforms plus the unattributed fallback across the default sample', () => {
    const seen = new Set(platforms(overviewFixture(readyFilters, 'ready')));
    for (const name of ['facebook', 'tiktok', 'shopee', 'lazada', 'web', 'unattributed'] as const)
      expect(seen.has(name)).toBe(true);
  });
  it('day reconciliation: the trend sales total equals the confirmed eligible-base of the same rows', () => {
    const { rows } = overviewRows(readyFilters, 'ready');
    const expected = rows
      .filter((line) => line.status !== 'estimated')
      .reduce((n, line) => n + BigInt(line.eligibleBase?.minor ?? '0'), 0n);
    const trendSales = overviewFixture(readyFilters, 'ready').earnings.trend.reduce(
      (n, p) => n + BigInt(p.sales!.minor),
      0n,
    );
    expect(trendSales).toBe(expected);
    expect(trendSales).toBe(55000000n);
  });
  it('brand filter narrows both the daily sales total and the platforms that appear', () => {
    const ax = overviewFixture({ from: '2026-08-01', toExclusive: '2026-09-01', brand: 'Axtion' }, 'ready');
    const sum = ax.earnings.trend.reduce((n, p) => n + BigInt(p.sales!.minor), 0n);
    expect(sum).toBe(23200000n);
    expect([...new Set(platforms(ax))].sort()).toEqual(['facebook', 'shopee', 'tiktok']);
  });
  it('partner-demo trend sales are confirmed-only and intentionally below eligibleSales (estimated)', () => {
    const demo = overviewFixture({ from: '2026-07-01', toExclusive: '2026-10-01', brand: null }, 'partner-demo');
    const trendSales = demo.earnings.trend.reduce((n, p) => n + BigInt(p.sales!.minor), 0n);
    expect(trendSales).toBe(55000000n);
    expect(demo.earnings.eligibleSales?.minor).toBe('69000000');
    expect(trendSales).not.toBe(BigInt(demo.earnings.eligibleSales!.minor));
  });
});
