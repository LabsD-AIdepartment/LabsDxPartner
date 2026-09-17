import { z } from 'zod';
import { ExactDecimal, SourceReportV2, type PlatformMetricValue } from '@/contracts/platform-metrics';
import { PartnerAdPerformance } from '@/contracts/partner-ad-performance';
import { coverageForPeriod } from '@/contracts/coverage';
import { isCelebSafeMetricKey } from '@/contracts/celeb-safe-metrics';
import type { Period } from '@/contracts/common';
type Report = z.infer<typeof SourceReportV2>;
type Performance = z.infer<typeof PartnerAdPerformance>;

/**
 * Enforce the Celeb-visible metric policy on an already-projected performance object. Still-prohibited
 * audience counts (impressions/video_views/reach) are dropped from BOTH the totals and every series
 * regardless of spend permission; `spend` is dropped unless the viewer is authorized. (The
 * owner-authorized `link_clicks` count and the derived `purchase_conversion_rate` are Celeb-safe and
 * kept.) This is the privacy gate for any Celeb-facing surface (native read + dev snapshot endpoint).
 * It never touches reasons/metadata, so no underlying count can leak through them.
 */
export function celebSafeAdPerformance(
  performance: Performance,
  canViewSpend: boolean,
): Performance {
  const keep = (m: { key: string }) => isCelebSafeMetricKey(m.key, { canViewSpend });
  return {
    ...performance,
    metrics: performance.metrics.filter(keep),
    series: performance.series.map((s) => ({ ...s, metrics: s.metrics.filter(keep) })),
  };
}
export function sumExact(values: string[]) {
  const scale = Math.max(...values.map((v) => v.split('.')[1]?.length ?? 0), 0);
  const total = values
    .reduce((sum, v) => {
      const [whole, part = ''] = v.split('.');
      return sum + BigInt(whole + part.padEnd(scale, '0'));
    }, 0n)
    .toString()
    .padStart(scale + 1, '0');
  return scale ? (total.slice(0, -scale) + '.' + total.slice(-scale)).replace(/\.?0+$/, '') : total;
}
// The sales conversion rate is a DERIVED, non-additive percent owned by this projection so it works
// identically for native reports and dev snapshots. It is NEVER trusted from an input report and is
// NEVER summed/averaged across periods: it is recomputed from the authoritative order/click counts.
const PURCHASE_CONVERSION_RATE_KEY = 'purchase_conversion_rate';
const PURCHASE_CONVERSION_RATE_DEFINITION = 'จำนวนการซื้อเทียบกับคลิกลิงก์ของโฆษณา';

/**
 * orders / clicks * 100 as an EXACT percent at fixed scale 6, rounded half-up with BigInt only (never
 * lossy Number math), with trailing fractional zeros stripped. Returns null when clicks is zero.
 */
function purchaseConversionRatePercent(orders: string, clicks: string): string | null {
  const numerator = BigInt(orders),
    denominator = BigInt(clicks);
  if (denominator === 0n) return null;
  const scale = 6n;
  const scaled = numerator * 100n * 10n ** scale;
  let quotient = scaled / denominator;
  const remainder = scaled % denominator;
  if (remainder * 2n >= denominator) quotient += 1n; // round half up (counts are non-negative)
  const digits = quotient.toString().padStart(7, '0');
  const whole = digits.slice(0, -6);
  const fraction = digits.slice(-6).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Derive the Celeb-safe purchase_conversion_rate from a set of already-projected metrics (a totals set
 * or a single-period series). Returns null when NEITHER input count exists (so spend-only/empty
 * reports keep their outputs). When an input exists but a needed value is missing/null, or clicks are
 * zero, or the exact result falls outside the wire range, the metric is emitted as unknown (value null
 * with a plain-Thai short reason) — a positive click count with zero orders yields a real 0.
 */
function derivePurchaseConversionRate(
  metrics: readonly PlatformMetricValue[],
): PlatformMetricValue | null {
  const orders = metrics.find((m) => m.key === 'platform_orders');
  const clicks = metrics.find((m) => m.key === 'link_clicks');
  if (!orders && !clicks) return null;
  // `as const` keeps `key` at its literal `'purchase_conversion_rate'` (a member of the MetricKey
  // union) instead of widening to `string`, so the spread results below stay assignable to
  // PlatformMetricValue without re-asserting the key on every branch.
  const base = {
    schemaVersion: 2,
    key: PURCHASE_CONVERSION_RATE_KEY,
    unit: 'ratio',
    currency: null,
    definition: PURCHASE_CONVERSION_RATE_DEFINITION,
    aggregation: 'non-additive',
  } as const;
  const unknown = (reason: string): PlatformMetricValue => ({
    ...base,
    value: null,
    unavailableReason: reason,
  });
  if (!orders || orders.value === null || !clicks || clicks.value === null)
    return unknown('ข้อมูลการซื้อหรือคลิกลิงก์ยังไม่ครบ');
  if (BigInt(clicks.value) === 0n) return unknown('ยังไม่มีคลิกลิงก์จึงคำนวณอัตราไม่ได้');
  const value = purchaseConversionRatePercent(orders.value, clicks.value);
  if (value === null || !ExactDecimal.safeParse(value).success)
    return unknown('อัตราซื้อต่อคลิกอยู่นอกช่วงที่แสดงได้');
  return { ...base, value, unavailableReason: null };
}

/** Aggregate only complete, compatible, disjoint observations. Never turn absent data into zero. */
export function projectPerformance(
  period: z.infer<typeof Period>,
  input: unknown[],
  canViewSpend: boolean,
  stale = false,
) {
  if (input.length > 1000) throw new Error('Report bounds exceeded');
  const all = input.map((r) => SourceReportV2.parse(r));
  const start = Date.parse(period.from),
    end = Date.parse(period.toExclusive);
  const inside = all.filter(
    (r) =>
      r.completeness === 'complete' &&
      Date.parse(r.period.from) >= start &&
      Date.parse(r.period.toExclusive) <= end,
  );
  const exact = inside.filter(
    (r) => Date.parse(r.period.from) === start && Date.parse(r.period.toExclusive) === end,
  );
  const reports = (exact.length ? exact : inside).sort(
    (a, b) => Date.parse(a.period.from) - Date.parse(b.period.from),
  );
  if (reports.length > 366) throw new Error('Report segment bounds exceeded');
  const signature = (r: Report) =>
    JSON.stringify([
      r.identity,
      r.apiVersion,
      r.reportDefinition,
      r.attribution,
      r.actionReportTime,
      r.period.timezone,
    ]);
  if (reports.some((r) => signature(r) !== signature(reports[0])))
    throw new Error('Incompatible report definitions');
  if (
    new Set(reports.flatMap((r) => r.metrics.flatMap((m) => (m.currency ? [m.currency] : []))))
      .size > 1
  )
    throw new Error('Mixed currencies');
  for (let i = 1; i < reports.length; i++)
    if (Date.parse(reports[i - 1].period.toExclusive) > Date.parse(reports[i].period.from))
      throw new Error('Overlapping reports');
  const coverage = coverageForPeriod(
    period,
    reports.map((r) => ({ ...r.period, timezone: 'Asia/Bangkok' as const })),
  );
  // ROAS is visible to a Celebrity by policy even when spend permission is absent; only the raw
  // `spend` amount stays gated on canViewSpend. (Prohibited counts are stripped downstream by
  // celebSafeAdPerformance so native staff/ingestion reports keep their raw counts intact.)
  const visible = (m: PlatformMetricValue) => m.key !== 'spend' || canViewSpend;
  // Any supplied purchase_conversion_rate is a DERIVED metric we own: never trust or duplicate an
  // input value. Exclude it from the aggregation candidates (both totals and series) before we
  // recompute it below from the authoritative order/click counts.
  const authored = (m: PlatformMetricValue) => m.key !== PURCHASE_CONVERSION_RATE_KEY;
  const keys = [
    ...new Set(reports.flatMap((r) => r.metrics.filter(visible).filter(authored).map((m) => m.key))),
  ];
  const metrics = keys.map((key) => {
    const entries = reports.map((r) => r.metrics.find((m) => m.key === key)),
      first = entries.find(Boolean)!;
    if (
      entries.some(
        (m) =>
          m &&
          (m.unit !== first.unit ||
            m.currency !== first.currency ||
            m.definition !== first.definition ||
            m.aggregation !== first.aggregation),
      )
    )
      throw new Error('Incompatible metric definitions');
    const reason =
      coverage.status !== 'complete'
        ? 'ข้อมูลยังไม่ครบช่วงวันที่เลือก ดูช่วงที่มีข้อมูลด้านล่าง'
        : entries.some((m) => !m || m.value === null)
          ? 'ต้นทางไม่ได้ส่งค่านี้ครบทุกช่วง'
          : reports.length > 1 && first.aggregation === 'non-additive'
            ? 'ค่านี้ต้องใช้รายงานรวมทั้งช่วงจากต้นทาง ไม่สามารถบวกข้ามวันได้'
            : null;
    return {
      ...first,
      value: reason
        ? null
        : reports.length === 1
          ? first.value
          : sumExact(entries.map((m) => m!.value!)),
      unavailableReason: reason,
    };
  });
  // Derive purchase_conversion_rate AFTER the compatibility/coverage-guarded totals so an incomplete
  // total yields a null numerator/denominator (rate unknown); each series is derived from its own
  // single-period counts so a valid partial-window rate can still surface. Totals and series are
  // never summed/averaged into each other.
  const derivedTotal = derivePurchaseConversionRate(metrics);
  const totalMetrics = derivedTotal ? [...metrics, derivedTotal] : metrics;
  const series = reports.map((r) => {
    const seriesMetrics = r.metrics.filter(visible).filter(authored);
    const derived = derivePurchaseConversionRate(seriesMetrics);
    return { period: r.period, metrics: derived ? [...seriesMetrics, derived] : seriesMetrics };
  });
  const reasons: string[] = [];
  if (coverage.status !== 'complete')
    reasons.push(
      reports.length
        ? 'ข้อมูลโฆษณายังไม่ครบช่วงวันที่เลือก'
        : 'ยังไม่มีรายงานโฆษณาที่ตรงกับช่วงวันที่เลือก',
    );
  if (stale && reports.length) reasons.push('การอัปเดตยังไม่สำเร็จ แสดงรายงานล่าสุดที่เก็บไว้');
  return PartnerAdPerformance.parse({
    schemaVersion: 2,
    source: reports[0]?.reportDefinition ?? 'Facebook',
    definition: reports[0]
      ? {
          apiVersion: reports[0].apiVersion,
          attribution: reports[0].attribution,
          actionReportTime: reports[0].actionReportTime,
          reportTimezone: reports[0].period.timezone,
        }
      : null,
    period,
    coverage,
    fetchedAt: reports.length
      ? reports.map((r) => r.fetchedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0]
      : null,
    dataThrough:
      reports.length && reports.every((r) => r.dataThrough !== null)
        ? reports.map((r) => r.dataThrough!).sort((a, b) => Date.parse(a) - Date.parse(b))[0]
        : null,
    state:
      coverage.status === 'unavailable'
        ? 'unavailable'
        : coverage.status === 'partial'
          ? 'partial'
          : stale
            ? 'stale'
            : 'ready',
    reasons,
    metrics: totalMetrics,
    series,
  });
}
