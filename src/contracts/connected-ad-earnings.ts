import { z } from 'zod';
import { Id, Money, Period } from './common';
import { Rate } from './earnings';
import { PartnerAdPerformance } from './partner-ad-performance';

/** Provider report and separately agreed commission policy. No settlement authority. */
export const ConnectedAd = z.strictObject({
  clipId: Id,
  adId: Id,
  ratePpm: Rate.nullable(),
  performance: PartnerAdPerformance.nullable(),
});
export const ConnectedAds = z.strictObject({
  period: Period,
  connections: z.array(ConnectedAd).max(100),
}).refine(v => new Set(v.connections.map(c => c.clipId)).size === v.connections.length);
export type ConnectedAdsValue = z.infer<typeof ConnectedAds>;
export const AdCommission = z.strictObject({
  amount: Money.nullable(),
  sales: Money.nullable(),
  ratePpm: Rate.nullable(),
  reason: z.string().nullable(),
  status: z.literal('estimated'),
});
