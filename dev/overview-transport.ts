import { Overview } from '@/contracts/overview';
import type { FilterValue } from '@/shared/ui/FilterBar';
import type { OverviewTransport } from '@/features/overview/model';
import { scenario, type ScenarioName } from './scenarios';
import { money } from './scenarios/ready';
import { coverageForPeriod } from '@/contracts/coverage';
export type OverviewScenario = ScenarioName | 'partial-period' | 'confirmed-only';
/** Synthetic upstream aggregation. Never imported by the product Overview feature. */
export function overviewRows(filters: FilterValue, name: OverviewScenario = 'ready') {
  const s = scenario(name === 'partial-period' || name === 'confirmed-only' ? 'ready' : name);
  const period = {
    from: filters.from + 'T00:00:00+07:00',
    toExclusive: filters.toExclusive + 'T00:00:00+07:00',
    timezone: 'Asia/Bangkok' as const,
  };
  // Explicit synthetic coverage, never inferred from a last earning date.
  const coverage = coverageForPeriod(
    period,
    name === 'unavailable'
      ? []
      : name === 'partial-period'
        ? [
            {
              from: '2026-08-01T00:00:00+07:00',
              toExclusive: '2026-08-25T00:00:00+07:00',
              timezone: 'Asia/Bangkok',
            },
          ]
        : [period],
  );
  const base = scenario('ready');
  const bySource = new Map(
    base.earnings.data.items.map((line) => [
      line.sourceRef,
      base.content.data.items.find((c) => c.id === line.contentId)!,
    ]),
  );
  const rows = (name === 'empty' ? [] : s.earnings.data.items)
    .map((line, i) => ({
      ...line,
      // Deliberately different from publication date: prove earned-date chart semantics.
      earnedAt: `2026-08-${String(i === 6 ? 29 : 30 - i * 3).padStart(2, '0')}T12:00:00+07:00`,
    }))
    .filter(
      (line) =>
        line.earnedAt.slice(0, 10) >= filters.from &&
        line.earnedAt.slice(0, 10) < filters.toExclusive &&
        (!filters.brand || bySource.get(line.sourceRef)?.brand === filters.brand) &&
        coverage.periods.some(
          (p) =>
            Date.parse(line.earnedAt) >= Date.parse(p.from) &&
            Date.parse(line.earnedAt) < Date.parse(p.toExclusive),
        ),
    );
  return { s, rows, bySource, period, coverage };
}
export function overviewFixture(
  filters: FilterValue,
  name: OverviewScenario = 'ready',
  paid = false,
) {
  const { s, rows, bySource, period, coverage } = overviewRows(filters, name);
  const sum = (selected: typeof rows) =>
    money(selected.reduce((total, line) => total + BigInt(line.amount.minor), 0n).toString());
  const confirmed = rows.filter((line) => line.status !== 'estimated');
  // Explicit synthetic channel mapping, not a product-side attribution guess.
  const organicSources = new Set(['synthetic-sale-1', 'synthetic-sale-3', 'synthetic-sale-5']);
  const channelRate = (organic: boolean) => {
    const rates = new Set(
      rows
        .filter(
          (line) => line.kind === 'commission' && organicSources.has(line.sourceRef) === organic,
        )
        .map((line) => line.ratePpm),
    );
    return rates.size === 1 ? [...rates][0] : null;
  };
  const brandSales = [
    ...new Set(
      rows
        .map((line) => bySource.get(line.sourceRef)?.brand)
        .filter((x): x is string => Boolean(x)),
    ),
  ]
    .map((label) => ({
      label,
      value: money(
        rows
          .filter(
            (line) => line.kind === 'commission' && bySource.get(line.sourceRef)?.brand === label,
          )
          .reduce((n, line) => n + BigInt(line.eligibleBase?.minor ?? '0'), 0n)
          .toString(),
      ),
    }))
    .sort((a, b) =>
      BigInt(a.value.minor) > BigInt(b.value.minor)
        ? -1
        : BigInt(a.value.minor) < BigInt(b.value.minor)
          ? 1
          : a.label.localeCompare(b.label),
    );
  const dates = new Map<string, bigint>();
  for (const line of confirmed) {
    const date = line.earnedAt.slice(0, 10);
    dates.set(date, (dates.get(date) ?? 0n) + BigInt(line.amount.minor));
  }
  const content = s.content.data.items
    .filter((clip) => confirmed.some((line) => line.contentId === clip.id))
    .map((clip) => ({
      ...clip,
      earned: sum(confirmed.filter((line) => line.contentId === clip.id)),
    }))
    .sort((a, b) =>
      BigInt(a.earned.minor) > BigInt(b.earned.minor)
        ? -1
        : BigInt(a.earned.minor) < BigInt(b.earned.minor)
          ? 1
          : a.id.localeCompare(b.id),
    )
    .slice(0, 3);
  const result = Overview.parse({
    ...s.overview,
    requestId: 'synthetic-overview-request',
    // The stale watermark must still cover every included earned-date row.
    dataThrough: name === 'stale' ? '2026-08-31T00:00:00+07:00' : s.overview.dataThrough,
    earnings: {
      ...s.overview.earnings,
      period,
      coverage,
      confirmed: sum(confirmed),
      salesByBrand: brandSales,
      channelBreakdown: {
        organic: sum(confirmed.filter((line) => organicSources.has(line.sourceRef))),
        brandAds: sum(confirmed.filter((line) => !organicSources.has(line.sourceRef))),
        other: money('0'),
        organicRatePpm: channelRate(true),
        brandAdsRatePpm: channelRate(false),
      },
      contentCount: new Set(confirmed.map((line) => line.contentId).filter(Boolean)).size,
      estimated: sum(rows.filter((line) => line.status === 'estimated')),
      eligibleSales: money(
        rows
          .filter((line) => line.kind === 'commission')
          .reduce((n, line) => n + BigInt(line.eligibleBase?.minor ?? '0'), 0n)
          .toString(),
      ),
      unassignedAmount: sum(confirmed.filter((line) => line.attribution === 'partner-only')),
      trend: [...dates]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amount: money(amount.toString()) })),
      topContent: content,
      ...(coverage.status === 'unavailable'
        ? {
            confirmed: null,
            eligibleSales: null,
            unassignedAmount: null,
            excludedCount: null,
            channelBreakdown: null,
            contentCount: null,
            salesByBrand: null,
            trend: [],
            topContent: [],
          }
        : {}),
      ...(['unavailable', 'confirmed-only', 'partial-period'].includes(name)
        ? { estimated: null }
        : {}),
    },
    ...(name === 'partial-period'
      ? { dataState: 'partial', reasons: ['มีข้อมูลเฉพาะงวดที่เผยแพร่แล้ว'] }
      : {}),
  });
  if (
    paid &&
    result.obligation.nextPayout &&
    result.obligation.confirmedUnpaid &&
    BigInt(result.obligation.confirmedUnpaid.minor) >= 1000000n
  ) {
    result.obligation.asOf = '2026-09-02T12:00:00+07:00';
    result.obligation.confirmedUnpaid = money(
      (BigInt(result.obligation.confirmedUnpaid.minor) - 1000000n).toString(),
    );
    result.obligation.nextPayout.amount = money(
      (BigInt(result.obligation.nextPayout.amount.minor) - 1000000n).toString(),
    );
  }
  return result;
}
export function createOverviewTransport(
  mode: OverviewScenario | 'loading' | 'error',
  paid = false,
): OverviewTransport {
  return async ({ filters, signal }) => {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener('abort', abort);
          resolve();
        },
        mode === 'loading' ? 60_000 : 160,
      );
      signal.addEventListener('abort', abort, { once: true });
    });
    if (mode === 'error') throw new Error('Synthetic upstream unavailable');
    return overviewFixture(filters, mode === 'loading' ? 'ready' : mode, paid);
  };
}
