// Shared, PURE Celeb-facing metric-visibility policy. Zero dependencies so it can be imported by
// BOTH the server projectors (native read + dev snapshot endpoint) and the Celeb UI without pulling
// any zod schema, node builtin or credential path. It decides only WHICH metric keys a Celebrity is
// allowed to see; it never inspects values, so no underlying count can leak through it.
//
// Policy (owner-authorized) — this is a STRICT ALLOWLIST, not a denylist. A key is Celeb-safe ONLY
// if it is explicitly enumerated below; every unknown/future metric key is denied by default so a
// newly-emitted count can never silently leak through this gate.
//   - The raw audience/reach COUNTS are ALWAYS hidden from Celeb surfaces, regardless of any spend
//     permission: impressions, video_views, reach (kept as an explicit deny list for clarity and for
//     the snapshot-store refinement, though the allowlist alone already excludes them).
//   - `link_clicks` is now owner-authorized as a Celeb-safe count (the latest owner instruction
//     supersedes the earlier D170 click exclusion; impressions/video_views/reach stay hidden). It is
//     the link-click count and the input for the derived sales conversion rate.
//   - `spend` (the brand's ad cost) is Celeb-safe ONLY when the viewer holds the spend permission.
//   - The Celeb-safe derived economics are: roas, cpc, ctr, cpm, cost_per_purchase,
//     purchase_conversion_rate, link_clicks, platform_orders, platform_value, eligible_orders,
//     eligible_sales. ROAS stays visible even when spend is hidden.

/** Audience/reach counts a Celebrity must never see, on any surface, in any permission state. */
export const PROHIBITED_CELEB_METRIC_KEYS = [
  'impressions',
  'video_views',
  'reach',
] as const;
export type ProhibitedCelebMetricKey = (typeof PROHIBITED_CELEB_METRIC_KEYS)[number];

const prohibited: ReadonlySet<string> = new Set(PROHIBITED_CELEB_METRIC_KEYS);

/**
 * The exhaustive allowlist of derived-economics keys a Celebrity may see WITHOUT a spend permission.
 * `spend` is deliberately NOT here: it is gated separately on the viewer's permission.
 */
export const CELEB_SAFE_METRIC_KEYS = [
  'roas',
  'cpc',
  'ctr',
  'cpm',
  'cost_per_purchase',
  'purchase_conversion_rate',
  'link_clicks',
  'platform_orders',
  'platform_value',
  'eligible_orders',
  'eligible_sales',
] as const;
export type CelebSafeMetricKey = (typeof CELEB_SAFE_METRIC_KEYS)[number];

const safe: ReadonlySet<string> = new Set(CELEB_SAFE_METRIC_KEYS);

/** True for a raw count that must always be excluded from Celeb-visible metrics and series. */
export function isProhibitedCelebMetricKey(key: string): boolean {
  return prohibited.has(key);
}

/**
 * Whether a metric key may be shown to a Celebrity, given the viewer's spend permission. STRICT: an
 * unknown key (e.g. a future/unmapped metric or a raw count) is always denied.
 */
export function isCelebSafeMetricKey(key: string, options: { canViewSpend: boolean }): boolean {
  if (prohibited.has(key)) return false; // counts are always excluded
  if (key === 'spend') return options.canViewSpend; // brand cost only for authorized viewers
  return safe.has(key); // allowlist only — everything else (incl. unknown/future keys) is denied
}

type KeyedMetric = { key: string };
/** Keep only the Celeb-safe metric entries from a list (pure; never mutates the input). */
export function celebSafeMetricList<T extends KeyedMetric>(
  metrics: readonly T[],
  options: { canViewSpend: boolean },
): T[] {
  return metrics.filter((m) => isCelebSafeMetricKey(m.key, options));
}
