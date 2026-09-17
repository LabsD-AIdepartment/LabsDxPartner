import { z } from 'zod';
import { Id, Instant } from './common';
import { SourceIdentityV2 } from './platform-capabilities';

// Bounded wire strings preserve decimal precision and counts beyond Number.MAX_SAFE_INTEGER.
export const ExactDecimal = z
  .string()
  .max(80)
  .regex(/^(0|[1-9]\d{0,39})(\.\d{1,18})?$/);
export const ExactCount = z
  .string()
  .max(40)
  .regex(/^(0|[1-9]\d*)$/);
const MetricKey = z.enum([
  'impressions',
  'link_clicks',
  'video_views',
  'reach',
  'platform_orders',
  'platform_value',
  'spend',
  'roas',
  // Meta-official derived economics. cpc/cpm/cost_per_purchase are money; ctr is a ratio the source
  // already expresses as a PERCENT value (Meta returns e.g. 1.53 for 1.53%). All are non-additive:
  // they are averages/ratios and must never be summed across periods or ads.
  'cpc',
  'ctr',
  'cpm',
  'cost_per_purchase',
  // Derived sales conversion rate = platform_orders / link_clicks * 100 (a PERCENT value). It is a
  // non-additive ratio owned by the shared projection; presentation appends %. Old payloads never
  // send this key.
  'purchase_conversion_rate',
]);
// money units for cost-per metrics; ratio units for rate metrics.
const moneyKeys = new Set(['platform_value', 'spend', 'cpc', 'cpm', 'cost_per_purchase']);
const ratioKeys = new Set(['roas', 'ctr', 'purchase_conversion_rate']);
const nonAdditive = new Set([
  'reach',
  'roas',
  'cpc',
  'ctr',
  'cpm',
  'cost_per_purchase',
  'purchase_conversion_rate',
]);
export const PlatformMetricV2 = z
  .strictObject({
    schemaVersion: z.literal(2),
    key: MetricKey,
    value: ExactDecimal.nullable(),
    unit: z.enum(['count', 'money', 'ratio']),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    definition: z.string().min(1).max(1000),
    unavailableReason: z.string().min(1).max(300).nullable(),
    aggregation: z.enum(['sum-disjoint', 'non-additive']),
  })
  .superRefine((v, ctx) => {
    const expected = moneyKeys.has(v.key) ? 'money' : ratioKeys.has(v.key) ? 'ratio' : 'count';
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (v.unit !== expected) fail('Metric unit does not match its definition');
    if ((v.unit === 'money') !== (v.currency !== null)) fail('Currency is required only for money');
    if ((v.value === null) !== (v.unavailableReason !== null))
      fail('Unknown values require a reason; known values cannot be unavailable');
    if (v.unit === 'count' && v.value !== null && !ExactCount.safeParse(v.value).success)
      fail('Counts must be exact integers');
    if (nonAdditive.has(v.key) && v.aggregation !== 'non-additive')
      fail('Reach and ratios are not additive');
  });
export type PlatformMetricValue = z.infer<typeof PlatformMetricV2>;
export const SourcePeriod = z
  .strictObject({
    from: Instant,
    toExclusive: Instant,
    timezone: z
      .string()
      .min(1)
      .max(80)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Unknown reporting timezone'),
  })
  .refine((v) => Date.parse(v.from) < Date.parse(v.toExclusive), 'Period must increase');
export const SourceReportV2 = z
  .strictObject({
    schemaVersion: z.literal(2),
    identity: SourceIdentityV2,
    grain: z.literal('ad-period'),
    apiVersion: Id,
    reportDefinition: Id,
    attribution: Id,
    actionReportTime: Id,
    period: SourcePeriod,
    coveredPeriod: SourcePeriod.nullable(),
    fetchedAt: Instant,
    dataThrough: Instant.nullable(),
    completeness: z.enum(['complete', 'partial', 'unavailable']),
    nextCursor: z.string().min(1).max(2000).nullable(),
    reason: z.string().min(1).max(300).nullable(),
    metrics: z.array(PlatformMetricV2).max(100),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const requested = v.period,
      covered = v.coveredPeriod;
    if (
      covered &&
      (covered.timezone !== requested.timezone ||
        Date.parse(covered.from) < Date.parse(requested.from) ||
        Date.parse(covered.toExclusive) > Date.parse(requested.toExclusive))
    )
      fail('Coverage must be inside the requested reporting period');
    if (
      v.completeness === 'complete' &&
      (v.nextCursor !== null ||
        v.reason !== null ||
        !covered ||
        Date.parse(covered.from) !== Date.parse(requested.from) ||
        Date.parse(covered.toExclusive) !== Date.parse(requested.toExclusive))
    )
      fail('Complete reports require full coverage and exhausted pagination');
    if (v.completeness !== 'complete' && v.reason === null)
      fail('Incomplete reports require a reason');
    if (v.completeness === 'unavailable' && (covered !== null || v.metrics.length !== 0))
      fail('Unavailable report cannot contain observations');
    if (v.metrics.length > 0 && covered === null)
      fail('Observations require explicit covered period');
    if (new Set(v.metrics.flatMap((m) => (m.currency === null ? [] : [m.currency]))).size > 1)
      fail('Mixed report currencies');
    if (v.dataThrough !== null && Date.parse(v.dataThrough) > Date.parse(v.fetchedAt))
      fail('Source watermark cannot exceed fetch time');
    if (new Set(v.metrics.map((m) => m.key)).size !== v.metrics.length)
      fail('Duplicate metric definition');
  });

/** Exact conversion for a verified currency scale. Reject precision loss; never round silently. */
export function decimalToMinor(value: string, scale: number): string {
  const parsed = ExactDecimal.parse(value);
  if (!Number.isInteger(scale) || scale < 0 || scale > 18)
    throw new Error('Invalid currency scale');
  const [whole, fraction = ''] = parsed.split('.');
  if (/[1-9]/.test(fraction.slice(scale))) throw new Error('Amount exceeds currency precision');
  return (
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt(fraction.slice(0, scale).padEnd(scale, '0') || '0')
  ).toString();
}

/** Display only: bounded exact rounding without converting money to a floating-point number. */
export function formatExactDecimal(raw: string, places: number): string {
  return formatScaledDecimal(raw, places, 0);
}

/** Display a source fraction as percent; never sum rates or round through Number. */
export function formatExactPercentage(raw: string, places = 2): string {
  return formatScaledDecimal(raw, places, 2) + '%';
}

function formatScaledDecimal(raw: string, places: number, shift: number): string {
  const value = ExactDecimal.parse(raw);
  if (!Number.isInteger(places) || places < 0 || places > 18)
    throw new Error('Invalid display precision');
  const [sourceWhole, sourceFraction = ''] = value.split('.');
  const whole = sourceWhole + sourceFraction.slice(0, shift).padEnd(shift, '0');
  const fraction = sourceFraction.slice(shift);
  let minor = BigInt(whole + fraction.slice(0, places).padEnd(places, '0'));
  if (Number(fraction[places] ?? '0') >= 5) minor += 1n;
  const digits = minor.toString().padStart(places + 1, '0');
  const integer = places ? digits.slice(0, -places) : digits;
  return (
    integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (places ? '.' + digits.slice(-places) : '')
  );
}
