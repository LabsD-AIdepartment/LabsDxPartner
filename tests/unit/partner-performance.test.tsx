import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { projectPerformance, sumExact } from '@/server/modules/marketing-ads/partner-performance';
import { AdPerformance } from '@/features/content/AdPerformance';
const period = {
  from: '2026-09-01T00:00:00+07:00',
  toExclusive: '2026-09-03T00:00:00+07:00',
  timezone: 'Asia/Bangkok' as const,
};
const identity = {
  schemaVersion: 2,
  platform: 'facebook',
  capability: 'facebook.ad_insights',
  namespace: 'test',
  connectionId: 'test',
  accountId: '123',
  objectType: 'ad',
  externalId: '789',
};
function report(day = 1, value: string | null = '9007199254740993.01', key = 'spend') {
  const p = {
    ...period,
    from: `2026-09-0${day}T00:00:00+07:00`,
    toExclusive: `2026-09-0${day + 1}T00:00:00+07:00`,
  };
  return {
    schemaVersion: 2,
    identity,
    grain: 'ad-period',
    apiVersion: 'v25.0',
    reportDefinition: 'facebook.ad-period.v1',
    attribution: '7d_click+1d_view',
    actionReportTime: 'impression',
    period: p,
    coveredPeriod: p,
    fetchedAt: '2026-09-10T00:00:00Z',
    dataThrough: null,
    completeness: 'complete',
    nextCursor: null,
    reason: null,
    metrics: [
      {
        schemaVersion: 2,
        key,
        value,
        unit: key === 'spend' ? 'money' : 'count',
        currency: key === 'spend' ? 'THB' : null,
        definition: key,
        unavailableReason: value === null ? 'missing' : null,
        aggregation: key === 'reach' ? 'non-additive' : 'sum-disjoint',
      },
    ],
  };
}
describe('exact partner performance projection', () => {
  it('sums wide exact decimal observations and treats missing data as unknown', () => {
    const p = projectPerformance(period, [report(), report(2)], true);
    expect(p.metrics[0].value).toBe('18014398509481986.02');
    expect(p.coverage.status).toBe('complete');
    expect(sumExact(['100.00', '0.10'])).toBe('100.1');
    expect(
      projectPerformance(period, [report(), report(2, null)], true).metrics[0].value,
    ).toBeNull();
  });
  it('keeps partial ranges inspectable without presenting partial sums as totals', () => {
    const p = projectPerformance(period, [report()], true);
    expect(p).toMatchObject({ state: 'partial', metrics: [{ value: null }] });
    expect(p.series[0].metrics[0].value).toBe('9007199254740993.01');
    expect(projectPerformance(period, [], true)).toMatchObject({
      state: 'unavailable',
      metrics: [],
      series: [],
    });
  });
  it('never sums daily reach but prefers an exact range observation over overlapping daily reports', () => {
    expect(
      projectPerformance(period, [report(1, '12', 'reach'), report(2, '13', 'reach')], true)
        .metrics[0].value,
    ).toBeNull();
    const whole = { ...report(1, '17', 'reach'), period, coveredPeriod: period };
    expect(
      projectPerformance(period, [report(1, '12', 'reach'), whole, report(2, '13', 'reach')], true)
        .metrics[0].value,
    ).toBe('17');
  });
  it('rejects overlap, incompatible definitions and mixed currency', () => {
    expect(() => projectPerformance(period, [report(), report()], true)).toThrow('Overlapping');
    expect(() =>
      projectPerformance(period, [report(), { ...report(2), attribution: 'different' }], true),
    ).toThrow('Incompatible');
    const b = report(2);
    b.metrics[0].currency = 'USD';
    expect(() => projectPerformance(period, [report(), b], true)).toThrow('currencies');
  });
  it('removes spend from both totals and series and preserves stale last-good state', () => {
    const p = projectPerformance(period, [report(), report(2)], false, true);
    expect(p.state).toBe('stale');
    expect(p.metrics).toEqual([]);
    expect(p.series.every((s) => s.metrics.length === 0)).toBe(true);
  });
  it('renders the exact wide amount through the shared metric component', () => {
    const p = projectPerformance(period, [report(), report(2)], true);
    render(
      <AdPerformance
        performance={{ ...p, automaticRefreshFrom: '2026-09-04T00:00:00+07:00' }}
        canViewAdSpend
      />,
    );
    expect(screen.queryByText(/เป็นรายงานย้อนหลังที่เก็บไว้/)).toBeNull();
    expect(screen.getByText('฿18,014,398,509,481,986.02')).toBeInTheDocument();
    expect(screen.queryByText('ดูตัวเลขแยกตามช่วงรายงาน (2)')).toBeNull();
  });
});

const dayStart = (day: number) => `2026-09-0${day}T00:00:00+07:00`;
const countMetric = (key: string, value: string | null) => ({
  schemaVersion: 2,
  key,
  value,
  unit: 'count' as const,
  currency: null,
  definition: key,
  unavailableReason: value === null ? 'missing' : null,
  aggregation: 'sum-disjoint' as const,
});
function convReport(from: string, toExclusive: string, metrics: unknown[]) {
  const p = { from, toExclusive, timezone: 'Asia/Bangkok' as const };
  return {
    schemaVersion: 2,
    identity,
    grain: 'ad-period',
    apiVersion: 'v25.0',
    reportDefinition: 'facebook.ad-snapshot.v1',
    attribution: '7d_click+1d_view',
    actionReportTime: 'impression',
    period: p,
    coveredPeriod: p,
    fetchedAt: '2026-09-10T00:00:00Z',
    dataThrough: null,
    completeness: 'complete',
    nextCursor: null,
    reason: null,
    metrics,
  };
}
const rate = (p: { metrics: { key: string }[] }) =>
  p.metrics.find((m) => m.key === 'purchase_conversion_rate') as
    | { value: string | null; unit: string; currency: string | null; aggregation: string; unavailableReason: string | null }
    | undefined;
const seriesRate = (s: { metrics: { key: string; value: string | null }[] }) =>
  s.metrics.find((m) => m.key === 'purchase_conversion_rate');

describe('derived purchase conversion rate', () => {
  it('derives the exact percent orders/clicks*100 (51/753 → 6.772908) as a non-additive ratio', () => {
    const p = projectPerformance(
      period,
      [
        convReport(dayStart(1), dayStart(3), [
          countMetric('platform_orders', '51'),
          countMetric('link_clicks', '753'),
        ]),
      ],
      true,
    );
    expect(rate(p)).toMatchObject({
      value: '6.772908',
      unit: 'ratio',
      currency: null,
      aggregation: 'non-additive',
      unavailableReason: null,
    });
  });

  it('yields a real zero for positive clicks with zero orders', () => {
    const p = projectPerformance(
      period,
      [
        convReport(dayStart(1), dayStart(3), [
          countMetric('platform_orders', '0'),
          countMetric('link_clicks', '753'),
        ]),
      ],
      true,
    );
    expect(rate(p)?.value).toBe('0');
    expect(rate(p)?.unavailableReason).toBeNull();
  });

  it('is unknown (never zero) when a needed count is missing or the denominator is zero', () => {
    const missingDenominator = projectPerformance(
      period,
      [convReport(dayStart(1), dayStart(3), [countMetric('platform_orders', '51')])],
      true,
    );
    expect(rate(missingDenominator)?.value).toBeNull();
    expect(rate(missingDenominator)?.unavailableReason).not.toBeNull();

    const zeroDenominator = projectPerformance(
      period,
      [
        convReport(dayStart(1), dayStart(3), [
          countMetric('platform_orders', '51'),
          countMetric('link_clicks', '0'),
        ]),
      ],
      true,
    );
    expect(rate(zeroDenominator)?.value).toBeNull();
    expect(rate(zeroDenominator)?.unavailableReason).not.toBeNull();
  });

  it('is absent entirely for a spend-only report so empty outputs are preserved', () => {
    const p = projectPerformance(period, [report(), report(2)], true);
    expect(rate(p)).toBeUndefined();
    expect(p.series.every((s) => seriesRate(s) === undefined)).toBe(true);
  });

  it('computes exact big-count ratios with BigInt (beyond Number.MAX_SAFE_INTEGER)', () => {
    // 9007199254740991 / 27021597764222973 = 1/3 → 33.333333 at fixed scale 6 (round half up).
    const p = projectPerformance(
      period,
      [
        convReport(dayStart(1), dayStart(3), [
          countMetric('platform_orders', '9007199254740991'),
          countMetric('link_clicks', '27021597764222973'),
        ]),
      ],
      true,
    );
    expect(rate(p)?.value).toBe('33.333333');
  });

  it('recomputes from authoritative counts and ignores/deduplicates a supplied stale rate', () => {
    const stale = {
      schemaVersion: 2,
      key: 'purchase_conversion_rate',
      value: '99.999999',
      unit: 'ratio',
      currency: null,
      definition: 'จำนวนการซื้อเทียบกับคลิกลิงก์ของโฆษณา',
      unavailableReason: null,
      aggregation: 'non-additive',
    };
    const p = projectPerformance(
      period,
      [
        convReport(dayStart(1), dayStart(3), [
          countMetric('platform_orders', '51'),
          countMetric('link_clicks', '753'),
          stale,
        ]),
      ],
      true,
    );
    const totals = p.metrics.filter((m) => m.key === 'purchase_conversion_rate');
    expect(totals).toHaveLength(1);
    expect(totals[0].value).toBe('6.772908');
    const inSeries = p.series[0].metrics.filter((m) => m.key === 'purchase_conversion_rate');
    expect(inSeries).toHaveLength(1);
    expect(inSeries[0].value).toBe('6.772908');
  });

  it('keeps a totals rate unknown on incomplete coverage while a partial-window series rate stays valid', () => {
    const p = projectPerformance(
      period,
      [
        convReport(dayStart(1), dayStart(2), [
          countMetric('platform_orders', '51'),
          countMetric('link_clicks', '753'),
        ]),
      ],
      true,
    );
    expect(p.coverage.status).not.toBe('complete');
    expect(rate(p)?.value).toBeNull();
    expect(rate(p)?.unavailableReason).not.toBeNull();
    expect(seriesRate(p.series[0])?.value).toBe('6.772908');
  });

  it('is unknown with a reason when a present required count is explicitly null (not just absent)', () => {
    const p = projectPerformance(
      period,
      [
        convReport(dayStart(1), dayStart(3), [
          countMetric('platform_orders', null),
          countMetric('link_clicks', '753'),
        ]),
      ],
      true,
    );
    expect(rate(p)?.value).toBeNull();
    expect(rate(p)?.unavailableReason).not.toBeNull();
  });

  it('marks a max-width (40-digit) orders / 1 click ratio unknown (out of wire range) without throwing', () => {
    const orders = '9'.repeat(40); // valid ExactCount, but orders*100 overflows the ExactDecimal wire range
    let p!: ReturnType<typeof projectPerformance>;
    expect(() => {
      p = projectPerformance(
        period,
        [
          convReport(dayStart(1), dayStart(3), [
            countMetric('platform_orders', orders),
            countMetric('link_clicks', '1'),
          ]),
        ],
        true,
      );
    }).not.toThrow();
    expect(rate(p)?.value).toBeNull();
    expect(rate(p)?.unavailableReason).not.toBeNull();
  });

  it('aggregates two unequal periods as a ratio of summed counts, never an average of rates', () => {
    const p = projectPerformance(
      period,
      [
        convReport(dayStart(1), dayStart(2), [
          countMetric('platform_orders', '51'),
          countMetric('link_clicks', '753'),
        ]),
        convReport(dayStart(2), dayStart(3), [
          countMetric('platform_orders', '12'),
          countMetric('link_clicks', '121'),
        ]),
      ],
      true,
    );
    expect(p.coverage.status).toBe('complete');
    // 63 / 874 * 100 = 7.208238 — NOT the average of the per-period rates (6.772908, 9.917355 → 8.345…).
    expect(rate(p)?.value).toBe('7.208238');
    expect(p.series.map((s) => seriesRate(s)?.value)).toEqual(['6.772908', '9.917355']);
  });
});
