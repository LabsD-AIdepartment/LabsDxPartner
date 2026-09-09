import { z } from 'zod';
import { Id, Count, Instant, Money, Period, envelope, page } from './common';
import { PeriodCoverage } from './coverage';
export const Metric = z
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
  .refine((v) => v.key !== 'reach' || !v.additive, 'Reach is non-additive');
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
  }),
).extend({ coverage: PeriodCoverage.optional() });
export const AdListResponse = envelope(page(Ad));
export const AdDetailResponse = envelope(Ad);
