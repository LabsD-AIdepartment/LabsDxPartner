import type { z } from 'zod';
import { PartnerAdPerformance } from '@/contracts/partner-ad-performance';
import { ExactCount, ExactDecimal } from '@/contracts/platform-metrics';
import { Period } from '@/contracts/common';
import { coverageMatchesPeriod } from '@/contracts/coverage';

/**
 * ContentDetail hero helper: derive the ad-sourced order COUNT and AOV (average order value) from an
 * already-projected {@link PartnerAdPerformance}. This is a pure, feature-local display helper — it
 * NEVER touches the authoritative financial DTO (eligibleOrders/eligibleSales/earningsStatus), never
 * mixes financial facts with ad facts, and never persists a new metric. It reads only the aggregate
 * `platform_orders`/`platform_value` totals (never the per-day `series`, never any other metric) so a
 * clip's hero can honestly show "orders from ads" and "value / orders" for the same complete window.
 *
 * AOV is computed with exact BigInt integer division rounded half-up to 2 places — the raw money value
 * keeps its full source precision (no Number/parseFloat, no rounding the value to cents first). The
 * order count is returned as an exact string so counts beyond Number.MAX_SAFE_INTEGER stay lossless.
 *
 * Missing vs zero stays distinct: a zero order count shows `orders: '0'` while AOV is unknown (there is
 * no denominator); a known value with zero orders is still no AOV. An unknown count makes AOV unknown
 * too. When the input is missing, fails validation, is unavailable, does not cover the whole window, or
 * describes a different reporting window, ALL outputs are unknown with a concise plain-Thai reason.
 *
 * `sales` is the ad-sourced order value taken verbatim from the SAME validated sole `platform_value`
 * money metric that backs AOV — the raw exact-precision string, never rounded, never re-scaled. Unlike
 * AOV it is INDEPENDENT of the order count: it shows whenever the value is known (including an explicit
 * `'0'`), even when the count is missing or zero, so the hero can honestly pull "sales from the ad"
 * without being coupled to whether orders/AOV are available. It stays subject to the exact same window,
 * coverage, availability, validation and duplicate-metric guards as orders/AOV. It never reads the
 * authoritative financial DTO (commission/eligibleSales), never sums duplicates, never touches `series`.
 */
export type AdOrderSummary = {
  orders: string | null;
  aov: string | null;
  currency: string | null;
  ordersReason: string | null;
  aovReason: string | null;
  sales: string | null;
  salesCurrency: string | null;
  salesReason: string | null;
  stale: boolean;
};

// Plain-Thai, field-name-free reasons the hero can surface verbatim.
const REASON = {
  noAdData: 'ยังไม่มีข้อมูลโฆษณา',
  noOrders: 'ยังไม่มีจำนวนออเดอร์',
  noValue: 'ยังไม่มียอดสั่งซื้อ',
  noOrdersForAov: 'ยังไม่มีออเดอร์สำหรับคำนวณ AOV',
  incompleteCoverage: 'ข้อมูลยังไม่ครบช่วงวันที่เลือก',
  wrongPeriod: 'ข้อมูลไม่ตรงกับช่วงวันที่เลือก',
  aovOverflow: 'ยังไม่สามารถแสดงค่าเฉลี่ยออเดอร์',
} as const;

type Performance = z.infer<typeof PartnerAdPerformance>;
type PeriodValue = z.infer<typeof Period>;
type Metric = Performance['metrics'][number];

const allUnknown = (reason: string): AdOrderSummary => ({
  orders: null,
  aov: null,
  currency: null,
  ordersReason: reason,
  aovReason: reason,
  sales: null,
  salesCurrency: null,
  salesReason: reason,
  stale: false,
});

/** Same instant boundaries AND timezone — compared as instants (full fractional precision), not raw strings. */
function periodMatches(a: PeriodValue, b: PeriodValue): boolean {
  return (
    a.timezone === b.timezone &&
    coverageMatchesPeriod({ status: 'complete', periods: [a] }, b)
  );
}

/**
 * value / count → decimal string with exactly 2 fraction digits, rounded half-up using BigInt integer
 * quotient/remainder only. `value` keeps every source fraction digit (no pre-rounding of the raw value)
 * so there is never a double rounding. Callers guarantee count > 0 and both strings are validated.
 */
function averageOrderValue(value: string, count: string): string {
  const [whole, fraction = ''] = value.split('.');
  const scale = BigInt(fraction.length);
  // value * 10^fraction.length as an exact integer, then * 100 to carry the 2 display decimals.
  const numerator = BigInt(whole + fraction) * 100n;
  const denominator = BigInt(count) * 10n ** scale;
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  // Counts and money totals are non-negative here, so a simple half-up on the remainder is exact.
  if (remainder * 2n >= denominator) quotient += 1n;
  const digits = quotient.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** The single metric for a key, or null when it is absent OR duplicated (duplicates are never summed). */
function soleMetric(metrics: readonly Metric[], key: Metric['key']): Metric | null {
  const found = metrics.filter((m) => m.key === key);
  return found.length === 1 ? found[0] : null;
}

/**
 * The sole `platform_value` money metric as a validated {value, currency}, or null when it is absent,
 * duplicated, unknown, or structurally invalid. `value` is the RAW source string (full precision, an
 * explicit `'0'` preserved) — never rounded here. Both AOV and `sales` read from this single source so
 * they can never diverge on which value/currency they trust.
 */
function soleMoneyValue(
  metrics: readonly Metric[],
  key: Metric['key'],
): { value: string; currency: string } | null {
  const metric = soleMetric(metrics, key);
  if (
    metric &&
    metric.unit === 'money' &&
    metric.currency !== null &&
    metric.value !== null &&
    ExactDecimal.safeParse(metric.value).success
  ) {
    return { value: metric.value, currency: metric.currency };
  }
  return null;
}

export function getAdOrderSummary(
  performance: Performance | undefined,
  period: PeriodValue,
): AdOrderSummary {
  if (performance === undefined) return allUnknown(REASON.noAdData);

  // Trust only validated input. An invalid/tampered payload is unknown — never displayed as "stale".
  const parsed = PartnerAdPerformance.safeParse(performance);
  if (!parsed.success) return allUnknown(REASON.noAdData);
  const data = parsed.data;

  const requested = Period.safeParse(period);
  if (!requested.success) return allUnknown(REASON.wrongPeriod);

  // A performance for a different reporting window is not evidence for this clip's selected period.
  if (!periodMatches(data.period, requested.data)) return allUnknown(REASON.wrongPeriod);

  // Unavailable outranks coverage: there is simply no ad data to show for the window.
  if (data.state === 'unavailable') return allUnknown(REASON.noAdData);

  // Only complete coverage may display totals; a partial WINDOW cannot back a whole-period headline.
  if (data.coverage.status !== 'complete') return allUnknown(REASON.incompleteCoverage);

  // Complete-but-stale facts may display, but the flag lets the UI mark them as last-known.
  const stale = data.state === 'stale';

  // --- Order count (independent of the money value) ---
  const orderMetric = soleMetric(data.metrics, 'platform_orders');
  let orders: string | null = null;
  let ordersReason: string | null = null;
  if (
    orderMetric &&
    orderMetric.unit === 'count' &&
    orderMetric.value !== null &&
    ExactCount.safeParse(orderMetric.value).success
  ) {
    orders = orderMetric.value;
  } else {
    ordersReason = REASON.noOrders;
  }

  // The single validated money metric that backs BOTH sales and AOV (never summed if duplicated).
  const money = soleMoneyValue(data.metrics, 'platform_value');

  // --- Sales (raw ad-sourced value; INDEPENDENT of the order count) ---
  // Shows verbatim whenever the value is known — including an explicit '0' — regardless of whether the
  // order count is missing or zero. Full source precision is preserved; nothing is rounded here.
  let sales: string | null = null;
  let salesCurrency: string | null = null;
  let salesReason: string | null = null;
  if (money) {
    sales = money.value;
    salesCurrency = money.currency;
  } else {
    salesReason = REASON.noValue;
  }

  // --- Average order value (needs a known count and a known money value) ---
  let aov: string | null = null;
  let currency: string | null = null;
  let aovReason: string | null = null;
  if (orders === null) {
    // Unknown count ⇒ AOV is unknown for the same reason.
    aovReason = REASON.noOrders;
  } else if (BigInt(orders) === 0n) {
    // Known zero orders: count shows "0" but there is no denominator to average over.
    aovReason = REASON.noOrdersForAov;
  } else if (money) {
    // A valid value can still round to an out-of-bounds AOV (e.g. carry adds a 41st integer digit).
    // Guard before returning so the UI's formatExactDecimal never receives an invalid ExactDecimal.
    const computed = averageOrderValue(money.value, orders);
    if (ExactDecimal.safeParse(computed).success) {
      aov = computed;
      currency = money.currency;
    } else {
      aovReason = REASON.aovOverflow;
    }
  } else {
    aovReason = REASON.noValue;
  }

  return {
    orders,
    aov,
    currency,
    ordersReason,
    aovReason,
    sales,
    salesCurrency,
    salesReason,
    stale,
  };
}
