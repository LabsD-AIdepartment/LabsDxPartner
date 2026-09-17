import { z } from 'zod';
import { Instant, Period } from './common';
import { PlatformMetricV2, SourcePeriod } from './platform-metrics';
import { PeriodCoverage, coverageMatchesPeriod } from './coverage';
/** Public projection deliberately excludes account/namespace/credential identities. */
export const PartnerAdPerformance = z
  .strictObject({
    schemaVersion: z.literal(2),
    source: z.string().min(1).max(160),
    definition: z
      .strictObject({
        apiVersion: z.string().min(1).max(160),
        attribution: z.string().min(1).max(160),
        actionReportTime: z.string().min(1).max(160),
        reportTimezone: z.string().min(1).max(80),
      })
      .nullable(),
    period: Period,
    coverage: PeriodCoverage,
    fetchedAt: Instant.nullable(),
    dataThrough: Instant.nullable(),
    automaticRefreshFrom: Instant.nullable().optional(),
    state: z.enum(['ready', 'partial', 'stale', 'unavailable']),
    reasons: z.array(z.string().min(1).max(300)).max(20),
    metrics: z.array(PlatformMetricV2).max(100),
    series: z
      .array(z.strictObject({ period: SourcePeriod, metrics: z.array(PlatformMetricV2).max(100) }))
      .max(366),
  })
  .refine(
    (v) => coverageMatchesPeriod(v.coverage, v.period),
    'Coverage must match the requested period',
  )
  .refine(
    (v) =>
      v.series.every(
        (s) =>
          Date.parse(s.period.from) >= Date.parse(v.period.from) &&
          Date.parse(s.period.toExclusive) <= Date.parse(v.period.toExclusive),
      ),
    'Series must be inside the selected period',
  );
