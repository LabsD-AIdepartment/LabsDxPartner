import { z } from 'zod';
import { Id, Instant, Period } from './common';
import { SourceReportV2 } from './platform-metrics';
import { isProhibitedCelebMetricKey } from './celeb-safe-metrics';

// Persisted, server-only snapshot of ONE full-period Facebook ad report for a dev partner-demo clip.
// It is produced by the operator refresh path (a read-only Graph report), validated, and written to
// a local server file so the dev preview endpoint can serve Celeb-safe metrics WITHOUT ever touching
// a live token, a raw audience count, or an arbitrary Graph proxy at request time.
//
// It stores NO credential and (by refinement) NO prohibited audience count. The account/namespace
// identity it carries is server-only scope for validation; the dev endpoint projects it down to the
// public PartnerAdPerformance, which deliberately excludes those identities.

/** The exact ad/account/window this snapshot is bound to; echoed so the endpoint can re-validate. */
export const AdSnapshotBinding = z.strictObject({
  identity: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  clipId: Id,
  namespace: Id,
  connectionId: Id,
  accountId: z.string().regex(/^\d{1,80}$/),
  adId: z.string().regex(/^\d{1,80}$/),
  // The creative this ad must resolve to at refresh time, plus (optionally) the exact asset video.
  // They fence a repurposed ad from silently presenting a different creative's stats as this clip's:
  // the refresh verifies them against Graph, and the request-time projector re-verifies the stored
  // binding equals the CURRENT config binding, so any post-snapshot change fails closed.
  expectedCreativeId: z.string().regex(/^\d{1,80}$/),
  expectedVideoId: z
    .string()
    .regex(/^\d{1,80}$/)
    .nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.literal('Asia/Bangkok'),
  canViewSpend: z.boolean(),
});
export type AdSnapshotBindingValue = z.infer<typeof AdSnapshotBinding>;

export const AdPerformanceSnapshot = z
  .strictObject({
    schemaVersion: z.literal(1),
    binding: AdSnapshotBinding,
    requestedPeriod: Period,
    report: SourceReportV2,
    fetchedAt: Instant,
    refreshedBy: z.literal('operator'),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const { report, binding, requestedPeriod } = v;
    // The report must describe the same ad/account/currency/timezone/window as the binding.
    if (report.identity.accountId !== binding.accountId) fail('Snapshot account mismatch');
    if (report.identity.externalId !== binding.adId) fail('Snapshot ad mismatch');
    if (report.identity.namespace !== binding.namespace) fail('Snapshot namespace mismatch');
    if (report.identity.connectionId !== binding.connectionId) fail('Snapshot connection mismatch');
    if (report.period.timezone !== binding.timezone) fail('Snapshot timezone mismatch');
    if (
      report.period.from !== requestedPeriod.from ||
      report.period.toExclusive !== requestedPeriod.toExclusive
    )
      fail('Snapshot report period must equal the requested period');
    if (Date.parse(v.fetchedAt) < Date.parse(report.fetchedAt))
      fail('Snapshot fetch time cannot precede the source report');
    // A snapshot NEVER stores a prohibited audience count, and money metrics must match currency.
    for (const m of report.metrics) {
      if (isProhibitedCelebMetricKey(m.key)) fail('Snapshot must not store prohibited counts');
      if (m.unit === 'money' && m.currency !== binding.currency) fail('Snapshot currency mismatch');
    }
  });
export type AdPerformanceSnapshotValue = z.infer<typeof AdPerformanceSnapshot>;
