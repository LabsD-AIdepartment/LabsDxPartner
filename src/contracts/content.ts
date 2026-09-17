import { z } from 'zod';
import { Id, Count, Instant, Money, Period, envelope, page } from './common';
import { PeriodCoverage } from './coverage';
import { PartnerAdPerformance } from './partner-ad-performance';
import { AdPlatform, ExternalId } from './platform-capabilities';
import { MediaPath } from './catalogue';

/** A source-owned platform ad identity shown on a card; never an internal association UUID. */
export const AdReference = z.strictObject({
  platform: AdPlatform,
  externalId: ExternalId,
});
export type AdReferenceValue = z.infer<typeof AdReference>;

/** Same-origin video asset; extension-checked, no remote URL, query, fragment or traversal. */
export const VideoPath = z
  .string()
  .max(250)
  .regex(/^\/media\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:mp4|webm)$/);

/** Player media is a local video (optional local poster) or a local cover image — no embeds. */
export const ContentMedia = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('video'), src: VideoPath, poster: MediaPath.optional() }),
  z.strictObject({ kind: z.literal('image'), src: MediaPath }),
]);
export type ContentMediaValue = z.infer<typeof ContentMedia>;
/** V1 presentation contract. Native provider ingestion must use SourceReportV2, not number coercion. */
export const MetricV1 = z
  .strictObject({
    key: z.enum([
      'eligible_orders',
      'eligible_sales',
      'impressions',
      'link_clicks',
      'video_views',
      'reach',
      'platform_orders',
      'platform_value',
      'spend',
      'roas',
      // Derived economics (unit THB for cpc/cpm/cost_per_purchase, ratio for ctr and
      // purchase_conversion_rate). ctr and purchase_conversion_rate carry a percent value;
      // presentation appends % (never ×100). Old payloads never send these keys.
      'cpc',
      'ctr',
      'cpm',
      'cost_per_purchase',
      'purchase_conversion_rate',
    ]),
    value: z.number().finite().nonnegative().nullable(),
    unit: z.enum(['count', 'THB', 'ratio']),
    definition: z.string().min(1),
    source: Id,
    period: Period,
    dataThrough: Instant.nullable(),
    unavailableReason: z.string().min(1).nullable(),
    additive: z.boolean(),
  })
  .refine(
    (v) => v.value !== null || v.unavailableReason !== null,
    'Unknown metric requires a reason',
  )
  .refine((v) => v.key !== 'reach' || !v.additive, 'Reach is non-additive')
  .refine(
    (v) => v.key !== 'purchase_conversion_rate' || !v.additive,
    'Purchase conversion rate is non-additive',
  );
// Preserve existing content/finance consumers during the P00→P04 compatibility window.
export const Metric = MetricV1;
export const ContentCard = z
  .strictObject({
    id: Id,
    title: z.string().min(1),
    brand: Id,
    publishedAt: Instant,
    cover: z.string().startsWith('/media/').nullable(),
    coverPosition: z.string().max(40),
    removed: z.boolean(),
    views: Count.nullable(),
    earned: Money.nullable(),
    unavailableReason: z.string().nullable(),
    // Optional/null = ad linkage unknown; [] = verified none. Old payloads omit this field.
    adReferences: z.array(AdReference).max(100).nullish(),
    // Optional/null = no authoritative media yet; never fabricate a video from a source URL.
    media: ContentMedia.nullish(),
  })
  .refine(
    (v) => v.earned !== null || v.unavailableReason !== null,
    'Unknown earnings need a reason',
  );
export const Ad = z.strictObject({
  id: Id,
  contentId: Id,
  title: z.string().min(1),
  status: z.enum(['active', 'paused', 'removed', 'unknown']),
  asOf: Instant,
  metrics: z.array(Metric),
  performance: PartnerAdPerformance.optional(),
});
export const ContentListResponse = envelope(page(ContentCard)).extend({
  coverage: PeriodCoverage.optional(),
  brands: z.array(Id).max(100).optional(),
});
export const ContentDetailResponse = envelope(
  z.strictObject({
    content: ContentCard,
    sourceUrl: z
      .url()
      .refine((v) => v.startsWith('https://'))
      .nullable(),
    eligibleSales: Money.nullable(),
    eligibleOrders: Count.nullable(),
    agreementVersion: Id.nullable(),
    earningsStatus: z
      .enum(['confirmed', 'estimated', 'mixed', 'unavailable'])
      .default('unavailable'),
    metrics: z.array(Metric),
    adCount: Count.nullable(),
    attribution: z.enum(['content', 'partner-only', 'unavailable']),
    // Optional Celeb-safe ad performance for the clip. Absent = no snapshot/native report; it never
    // carries prohibited counts and never gates the financial fields above.
    performance: PartnerAdPerformance.optional(),
  }),
).extend({ coverage: PeriodCoverage.optional() });
export const AdListResponse = envelope(page(Ad));
export const AdDetailResponse = envelope(Ad);
