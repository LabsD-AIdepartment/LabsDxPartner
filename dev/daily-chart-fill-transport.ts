import { Overview, type OverviewValue } from '@/contracts/overview';
import { coverageForPeriod } from '@/contracts/coverage';
import { addDays } from '@/shared/ui/date-range';
import type { OverviewTransport } from '@/features/overview/model';
import { DailyFill, type DailyFillValue } from '@/server/hosted-demo/daily-chart-fill/model';

/** Chart-only composition: existing points (including zero) always win over generated rows. */
export function applyDailyChartFill(
  base: OverviewValue,
  fill: DailyFillValue,
  brand: string | null,
) {
  const earnings = base.earnings;
  const from = earnings.period.from.slice(0, 10);
  const to = earnings.period.toExclusive.slice(0, 10);
  const existing = new Set(earnings.trend.map((point) => point.date));
  const additions = new Map<string, bigint>();
  for (const row of fill.rows) {
    if (row.date < from || row.date >= to || row.date > fill.through || existing.has(row.date))
      continue;
    if (
      coverageForPeriod(
        {
          from: row.date + 'T00:00:00+07:00',
          toExclusive: addDays(row.date, 1) + 'T00:00:00+07:00',
          timezone: 'Asia/Bangkok',
        },
        earnings.coverage.periods,
      ).status === 'complete'
    )
      continue;
    if (brand !== null && row.brand !== brand) continue;
    additions.set(row.date, (additions.get(row.date) ?? 0n) + BigInt(row.minor));
  }
  if (!additions.size) return base;
  const money = (minor: bigint) => ({ currency: 'THB' as const, minor: String(minor) });
  const trend = [
    ...earnings.trend,
    ...[...additions].map(([date, minor]) => ({
      date,
      amount: money(minor),
      sales: money(minor * 10n),
      salesByPlatform: [{ platform: 'unattributed' as const, sales: money(minor * 10n) }],
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const coverage = coverageForPeriod(earnings.period, [
    ...earnings.coverage.periods,
    ...[...additions.keys()].map((date) => ({
      from: `${date}T00:00:00+07:00`,
      toExclusive: `${addDays(date, 1)}T00:00:00+07:00`,
      timezone: 'Asia/Bangkok' as const,
    })),
  ]);
  return Overview.parse({
    ...base,
    dataState: 'ready',
    reasons: [],
    earnings: {
      ...earnings,
      generation: `${earnings.generation}-daily-fill-v1`,
      coverage,
      trend,
      confirmed: money(trend.reduce((sum, point) => sum + BigInt(point.amount.minor), 0n)),
      eligibleSales: money(
        BigInt(earnings.eligibleSales?.minor ?? '0') +
          [...additions.values()].reduce((sum, minor) => sum + minor * 10n, 0n),
      ),
      unassignedAmount: earnings.unassignedAmount ?? money(0n),
      // No real clip identity or channel claim for generated samples.
      channelBreakdown: null,
      salesByBrand: null,
    },
  });
}
export function createDailyChartFillTransport(base: OverviewTransport): OverviewTransport {
  return async (input) => {
    const original = await base(input);
    try {
      const response = await fetch('/api/demo/daily-chart-fill?identity=a', {
        signal: input.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) return original;
      const fill = DailyFill.parse(await response.json());
      return applyDailyChartFill(Overview.parse(original), fill, input.filters.brand);
    } catch (error) {
      if (input.signal.aborted) throw error;
      return original; // Missing/disabled sample service never removes original chart data.
    }
  };
}
