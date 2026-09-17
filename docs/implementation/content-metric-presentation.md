# Clip status and performance presentation

The income status distinguishes `partner-only` attribution (income exists at
partner level but cannot be assigned to this clip) from `unavailable` (no usable
clip income status). Only the former is described as unmatched. For unavailable
income, the reason supplied by the read model is retained, including missing
published coverage or earnings access. This does not alter money authorization,
null/zero handling, or commission calculations.

`MetricSections` retains its default empty message for existing consumers. When
an active TikTok video source is present on the clip page, `ShopVideoPanel` owns
its loading, error, empty, and populated states, so the generic legacy empty
message is suppressed. An empty TikTok mapping result explicitly describes
missing TikTok Shop Video reports; other available legacy metrics remain visible.
Removed clips do not start a video request and retain the generic fallback.

`formatExactPercentage` formats a source decimal fraction as a percentage using
the same exact-string rounding as `formatExactDecimal`. For example `0.045`
becomes `4.50%`, zero becomes `0.00%`, and null remains a dash. The shared video
value component applies this to totals and individual source periods. It does not
sum or average click rates, infer missing values, or change stored observations.

Validated 2026-09-11: 69 tests across content composition, shop-video display and
platform contracts; TypeScript and production build with fixture exclusion;
independent seven-file candidate review. Native HTTPS with the existing isolated
synthetic database showed 24,000 views and 4.50% while income remained unavailable,
with no contradictory generic performance message. This is local validation;
real platform access, release, full responsive and 200% acceptance remain separate.
