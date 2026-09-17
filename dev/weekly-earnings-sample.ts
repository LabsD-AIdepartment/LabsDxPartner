import { Overview, type OverviewValue, type SalesPlatformName } from '@/contracts/overview';
import type { OverviewTransport } from '@/features/overview/model';
import { addDays, dateNumber } from '@/shared/ui/date-range';
import { overviewFixture } from './overview-transport';

/**
 * Preview-only rolling DAILY sample for the "Daily Clip Earnings" weekly card.
 *
 * This exists solely so the weekly chart shows a visible, coherent line in the partner-demo preview.
 * It is a development artefact: it is NEVER imported by product `src/**` code — the product Overview
 * feature only receives it through the explicit, opt-in `weeklyEarningsOverride` prop wired up in a
 * dev route. It carries NO financial truth: it does not touch the demo withdrawal ledger, statement
 * balances, exports or the general Overview query. Each call returns a fresh response with its own
 * explicit sample generation, its own current watermark and a deliberately empty obligation, so no
 * real full-period confirmed/eligible aggregate or withdrawal figure ever leaks into the sample.
 */

const DAY = 86_400_000;

// A FIXED seven-entry pattern (THB minor units). It is indexed by the calendar day number modulo 7,
// so a given Bangkok date always maps to the same amount regardless of which requested window (this
// week, a previous week, or an overlapping brand-filtered query) contains it. Any window of seven
// consecutive days therefore covers all seven entries exactly once: six varied positive samples plus
// one deliberate zero day (index 2) to exercise the genuine all-zero point rendering.
const DAILY_COMMISSION_MINOR: readonly bigint[] = [
  208_400n,
  356_900n,
  0n,
  142_300n,
  415_600n,
  97_800n,
  271_500n,
];

// Every pattern index is authored to belong to exactly ONE sample brand. This lets a brand-filtered
// request return the SAME date buckets with a zero amount on the days that belong to the other brand,
// while an all-brand request shows every day. Because each index maps to one of exactly these two
// brands, the two brand-specific trends always reconcile to the all-brand trend (day by day and in
// total). Any brand outside this set is an unknown brand: it produces an all-zero sample rather than
// an invented one. The names reuse the existing demo brands; the card still identifies itself as a
// sample via its notice.
const SAMPLE_BRANDS = ['Axtion', 'Tendrix'] as const;
type SampleBrand = (typeof SAMPLE_BRANDS)[number];
const DAILY_BRAND: readonly SampleBrand[] = [
  'Axtion',
  'Tendrix',
  'Axtion',
  'Tendrix',
  'Axtion',
  'Tendrix',
  'Axtion',
];

// Authored, deterministic sales-platform pairs per pattern index. Purely illustrative dev labels —
// they attribute nothing to a real ad or clip. Each pair sums exactly to the day's sample sales.
const PLATFORM_PAIRS: readonly (readonly [SalesPlatformName, SalesPlatformName])[] = [
  ['facebook', 'tiktok'],
  ['tiktok', 'shopee'],
  ['shopee', 'lazada'],
  ['lazada', 'web'],
  ['web', 'facebook'],
  ['facebook', 'shopee'],
  ['tiktok', 'web'],
];

const money = (minor: bigint) => ({ currency: 'THB' as const, minor: minor.toString() });

/** A second-precision offset-bearing Instant for the sample's own watermark and obligation clock. */
function toInstant(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Stable pattern index for a validated ISO date, anchored to the absolute calendar day. */
export function sampleDayIndex(date: string): number {
  const dayNumber = Math.round(dateNumber(date)! / DAY);
  return ((dayNumber % 7) + 7) % 7;
}

/** The single sample brand that owns a given calendar date, for tests and callers. */
export function sampleDayBrand(date: string): SampleBrand {
  return DAILY_BRAND[sampleDayIndex(date)];
}

function samplePlatformSplit(index: number, sales: bigint) {
  const [first, second] = PLATFORM_PAIRS[index];
  const firstShare = (sales * 3n) / 5n;
  return [
    { platform: first, sales: money(firstShare) },
    { platform: second, sales: money(sales - firstShare) },
  ];
}

/**
 * Build a fresh, schema-valid Overview whose weekly earnings are the deterministic daily sample for
 * the requested window and brand. `overviewFixture(filters, 'empty')` is reused ONLY as a valid
 * envelope template (period/coverage shell); every sample-related field below — the monetary
 * aggregates, the explicit sample `generation`, the current watermark and the empty obligation — is
 * authored here so nothing carries over from the fixture's own figures or withdrawal obligation.
 *
 * Brand semantics: an all-brand request (`brand === null`) shows every day. A known sample-brand
 * request keeps all seven date buckets but zeroes the days that belong to the other brand, so the
 * two brand trends reconcile exactly to the all-brand trend. An unknown brand yields an all-zero
 * sample. This mirrors what a real brand-scoped transport would do; the product currently strips the
 * brand at `loadOverview`, but the direct fixture contract stays correct if that flag is enabled.
 */
export function generateWeeklyEarningsSample(
  filters: Parameters<OverviewTransport>[0]['filters'],
  now: Date = new Date(),
): OverviewValue {
  const template = overviewFixture(filters, 'empty');
  const brand = filters.brand;
  const knownBrand = brand === null || (SAMPLE_BRANDS as readonly string[]).includes(brand);
  let confirmedTotal = 0n;
  let salesTotal = 0n;
  const trend: OverviewValue['earnings']['trend'] = [];
  for (let date = filters.from; date < filters.toExclusive; date = addDays(date, 1)) {
    const index = sampleDayIndex(date);
    // A day contributes its authored amount only when it belongs to the requested (known) brand.
    // Every other day still appears in the trend, at zero — never dropped and never invented.
    const dayIsBrand = brand === null || DAILY_BRAND[index] === brand;
    const amount = knownBrand && dayIsBrand ? DAILY_COMMISSION_MINOR[index] : 0n;
    // Coherent daily sales base at a fixed 10% commission rate for the illustrative split.
    const sales = amount * 10n;
    confirmedTotal += amount;
    salesTotal += sales;
    trend.push({
      date,
      amount: money(amount),
      sales: money(sales),
      // A zero day has no sales to split; keep its breakdown absent rather than a zero-only list.
      ...(sales > 0n ? { salesByPlatform: samplePlatformSplit(index, sales) } : {}),
    });
  }
  const earnings: OverviewValue['earnings'] = {
    ...template.earnings,
    // Explicit, unmistakable sample identity — never the fixture's real generation id.
    generation: 'weekly-sample-v1',
    confirmed: money(confirmedTotal),
    eligibleSales: money(salesTotal),
    unassignedAmount: money(0n),
    estimated: money(0n),
    excludedCount: 0,
    channelBreakdown: null,
    salesByBrand: null,
    // No authored clip identities exist for the sample, so the clip count stays honestly unknown and
    // top-content is empty — the card shows daily commission only, never a fake clip link.
    contentCount: null,
    topContent: [],
    trend,
  };
  const asOf = toInstant(now);
  // Re-parse so the returned sample is guaranteed to satisfy every Overview invariant (period match,
  // trend↔confirmed reconciliation, platform-split sums) exactly like a real transport response.
  return Overview.parse({
    ...template,
    requestId: 'weekly-earnings-sample-request',
    dataState: 'ready',
    reasons: [],
    // The sample's own current watermark, not the fixture's August template values.
    generatedAt: asOf,
    dataThrough: asOf,
    earnings,
    // No withdrawal truth: an unknown obligation with no next payout.
    obligation: {
      asOf,
      confirmedUnpaid: null,
      nextPayoutReason: null,
      nextPayout: null,
    },
  });
}

/**
 * OverviewTransport that serves the weekly sample. Mirrors the fixture transport's abort/period
 * semantics so `loadOverview` validation, abort handling and coverage checks all run unchanged.
 * An optional clock keeps the sample watermark deterministic in tests.
 */
export function createWeeklyEarningsSampleTransport(now?: Date): OverviewTransport {
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
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 120);
      signal.addEventListener('abort', abort, { once: true });
    });
    return generateWeeklyEarningsSample(filters, now ?? new Date());
  };
}
