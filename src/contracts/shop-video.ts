import { z } from 'zod';
import { Id, Instant } from './common';
import { ExternalId } from './platform-capabilities';
import { RegistrationScope } from './ad-registration';

export const ShopVideoLookup = RegistrationScope.extend({
  targetId: Id,
  connectionId: Id,
  videoId: ExternalId,
});
export const ShopVideoSave = ShopVideoLookup.extend({
  generationId: z.uuid(),
  creatorId: ExternalId,
  targetRevision: z.string().regex(/^[1-9]\d*$/),
  connectionRevision: z.string().regex(/^[1-9]\d*$/),
  idempotencyKey: z.uuid(),
});
export const ShopVideoSaved = z.strictObject({
  mappingId: z.uuid(),
  partnerId: Id,
  clipId: Id,
  videoId: ExternalId,
  replayed: z.boolean(),
});
export const PartnerShopVideoQuery = z
  .strictObject({
    partnerId: Id,
    permissionRevision: Id,
    clipId: Id,
    from: z.iso.date(),
    toExclusive: z.iso.date(),
  })
  .refine((q) => {
    const days = (Date.parse(q.toExclusive) - Date.parse(q.from)) / 86_400_000;
    return days > 0 && days <= 366;
  }, 'Select between 1 and 366 days');

// Public projection only: no shop credentials, creator identifiers or raw provider payloads.
import { ExactCount, ExactDecimal } from './platform-metrics';
const CalendarPeriod = z
  .strictObject({ from: z.iso.date(), toExclusive: z.iso.date() })
  .refine((p) => p.from < p.toExclusive);
const VideoValues = z.strictObject({
  views: ExactCount.nullable(),
  paidSkuOrders: ExactCount.nullable(),
  itemsSold: ExactCount.nullable(),
  gmv: z
    .strictObject({ amount: ExactDecimal, currency: z.string().regex(/^[A-Z]{3}$/) })
    .nullable(),
  productClickThroughRate: ExactDecimal.nullable(),
});
export const ShopVideoPerformance = VideoValues.extend({
  state: z.enum(['ready', 'partial', 'stale', 'unavailable']),
  timezone: z.string().min(1).max(80).nullable(),
  fetchedAt: Instant.nullable(),
  latestAvailableDate: z.iso.date().nullable(),
  series: z.array(VideoValues.extend({ period: CalendarPeriod, available: z.boolean() })).max(366),
});
export const PartnerShopVideos = z.strictObject({
  schemaVersion: z.literal(1),
  partnerId: Id,
  permissionRevision: Id,
  clipId: Id,
  period: CalendarPeriod,
  metricsRevision: ExactCount,
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        source: z.literal('TikTok Shop Video'),
        performance: ShopVideoPerformance,
      }),
    )
    .max(50),
});
export const ShopVideoReceipt = ShopVideoLookup.extend({
  generationId: z.uuid(),
  creatorId: ExternalId,
  targetRevision: z.string().regex(/^[1-9]\d*$/),
  connectionRevision: z.string().regex(/^[1-9]\d*$/),
  title: z.string().max(2000),
  creatorName: z.string().max(500),
});
export const ShopVideoOptionsQuery = RegistrationScope.extend({
  q: z.string().trim().max(160).default(''),
});
export const ShopVideoOptions = ShopVideoOptionsQuery.extend({
  hasMore: z.boolean(),
  targets: z
    .array(z.strictObject({ id: Id, partnerId: Id, clipId: Id, label: z.string().max(1200) }))
    .max(500),
  connections: z
    .array(z.strictObject({ id: Id, label: z.string().max(160), available: z.boolean() }))
    .max(100),
});
