import { Overview, type SalesPlatformName } from '@/contracts/overview';
import type { FilterValue } from '@/shared/ui/FilterBar';
import type { OverviewTransport } from '@/features/overview/model';
import { scenario, type ScenarioName } from './scenarios';
import { money } from './scenarios/ready';
import { septemberEstimatedLines, septemberClips, DEMO_FINANCIALS } from './scenarios/demo-financials';
import { coverageForPeriod } from '@/contracts/coverage';
import { applyAdSample } from './ad-sample-media';
export type OverviewScenario =
  | ScenarioName
  | 'partial-period'
  | 'confirmed-only'
  // Current-inclusive demo: the closed Jul–Aug confirmed rows PLUS September estimated rows, so a
  // range that reaches the open period (e.g. Jul 1 – Oct 1) shows a nonzero estimated/pending
  // figure while a Jul–Aug selection stays estimated 0. Reconciles with the partner-demo withdrawal.
  | 'partner-demo';
// Fixed display order so a day's platform breakdown is deterministic.
const PLATFORM_ORDER: SalesPlatformName[] = [
  'facebook',
  'tiktok',
  'shopee',
  'lazada',
  'web',
  'unattributed',
];
// Explicit synthetic sales-platform allocation per sourceRef. The product earning payload carries
// NO authoritative sales platform, so this authored split lives ONLY in the fixture — it is never a
// product-side attribution guess. Each source may span several platforms; a source with no mapping
// here falls back to a single 'unattributed' subtotal. The default `ready` sample deliberately
// exercises all five named platforms plus the unattributed fallback.
const PLATFORM_SHARES: Record<string, { platform: SalesPlatformName; weight: bigint }[]> = {
  'synthetic-sale-1': [
    { platform: 'facebook', weight: 3n },
    { platform: 'tiktok', weight: 2n },
  ],
  'synthetic-sale-2': [
    { platform: 'tiktok', weight: 1n },
    { platform: 'shopee', weight: 1n },
  ],
  'synthetic-sale-3': [
    { platform: 'shopee', weight: 2n },
    { platform: 'lazada', weight: 1n },
  ],
  'synthetic-sale-4': [
    { platform: 'lazada', weight: 3n },
    { platform: 'web', weight: 2n },
  ],
  'synthetic-sale-5': [
    { platform: 'web', weight: 1n },
    { platform: 'facebook', weight: 1n },
  ],
  // synthetic-sale-6 is intentionally unmapped -> unattributed.
};
/**
 * Split a single source's eligible-sales base across its authored platform shares, assigning the
 * rounding residual to the first share so the split sums EXACTLY to `base` (in a synthetic fixture
 * an authored residual is acceptable). Negative correction bases keep their sign. An unmapped source
 * returns the whole base as 'unattributed'.
 */
function allocatePlatforms(
  sourceRef: string,
  base: bigint,
): { platform: SalesPlatformName; minor: bigint }[] {
  const shares = PLATFORM_SHARES[sourceRef];
  if (!shares) return [{ platform: 'unattributed', minor: base }];
  const totalWeight = shares.reduce((sum, share) => sum + share.weight, 0n);
  const parts = shares.map((share) => ({
    platform: share.platform,
    minor: (base * share.weight) / totalWeight,
  }));
  parts[0].minor += base - parts.reduce((sum, part) => sum + part.minor, 0n);
  return parts;
}
/** Synthetic upstream aggregation. Never imported by the product Overview feature. */
export function overviewRows(filters: FilterValue, name: OverviewScenario = 'ready') {
  const s = scenario(
    name === 'partial-period' || name === 'confirmed-only' || name === 'partner-demo'
      ? 'ready'
      : name,
  );
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
  // partner-demo resolves the September clips' brand for sales-by-brand aggregation.
  if (name === 'partner-demo')
    for (const line of septemberEstimatedLines) {
      const clip = septemberClips.find((c) => c.id === line.contentId);
      if (clip) bySource.set(line.sourceRef, clip);
    }
  const remapped = (name === 'empty' ? [] : s.earnings.data.items).map((line, i) =>
    // partner-demo preserves the ready line earnedAt so the daily chart, clip earnings and the
    // retained statement stay consistent; legacy modes keep the deliberate earned-date remap.
    name === 'partner-demo'
      ? { ...line }
      : {
          ...line,
          // Deliberately different from publication date: prove earned-date chart semantics.
          earnedAt: `2026-08-${String(i === 6 ? 29 : 30 - i * 3).padStart(2, '0')}T12:00:00+07:00`,
        },
  );
  // Append the September ESTIMATED rows with their own (unremapped) open-period earned dates.
  const rows = (name === 'partner-demo' ? [...remapped, ...septemberEstimatedLines] : remapped)
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
    // Rates are derived from CONFIRMED lines only, matching the confirmed channel sums below, so an
    // open-period estimated line never contaminates (or nulls out) a published channel rate.
    const rates = new Set(
      confirmed
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
  // Daily confirmed sales (eligible base) and its synthetic platform split, derived from the SAME
  // confirmed rows/dates/brand filtering as the commission trend above.
  const daySales = new Map<string, bigint>();
  const dayPlatforms = new Map<string, Map<SalesPlatformName, bigint>>();
  for (const line of confirmed) {
    const date = line.earnedAt.slice(0, 10);
    dates.set(date, (dates.get(date) ?? 0n) + BigInt(line.amount.minor));
    const base = BigInt(line.eligibleBase?.minor ?? '0');
    daySales.set(date, (daySales.get(date) ?? 0n) + base);
    const bucket = dayPlatforms.get(date) ?? new Map<SalesPlatformName, bigint>();
    for (const part of allocatePlatforms(line.sourceRef, base))
      bucket.set(part.platform, (bucket.get(part.platform) ?? 0n) + part.minor);
    dayPlatforms.set(date, bucket);
  }
  const content = s.content.data.items
    .filter((clip) => confirmed.some((line) => line.contentId === clip.id))
    .map((clip) => ({
      // Same shared overlay as the content list/detail so top-content titles/covers never drift.
      ...(name === 'partner-demo' ? applyAdSample(clip) : clip),
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
    // partner-demo includes September rows, so its watermark must not predate them.
    generatedAt: name === 'partner-demo' ? DEMO_FINANCIALS.asOf : s.overview.generatedAt,
    // The stale watermark must still cover every included earned-date row.
    dataThrough:
      name === 'stale'
        ? '2026-08-31T00:00:00+07:00'
        : name === 'partner-demo'
          ? DEMO_FINANCIALS.asOf
          : s.overview.dataThrough,
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
        .map(([date, amount]) => {
          const sales = daySales.get(date) ?? 0n;
          const bucket = dayPlatforms.get(date) ?? new Map<SalesPlatformName, bigint>();
          return {
            date,
            amount: money(amount.toString()),
            sales: money(sales.toString()),
            // Drop exact-zero platforms (net corrections can cancel a platform out); the remaining
            // nonzero shares still sum exactly to the day's sales.
            salesByPlatform: PLATFORM_ORDER.filter((p) => (bucket.get(p) ?? 0n) !== 0n).map((p) => ({
              platform: p,
              sales: money((bucket.get(p) ?? 0n).toString()),
            })),
          };
        }),
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
