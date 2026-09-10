import { z } from 'zod';
import { Id, Instant } from './common';

export const AdPlatform = z.enum(['facebook', 'shopee', 'lazada', 'tiktok']);
export const CapabilityId = z.enum([
  'facebook.ad_insights',
  'shopee.ads_reporting',
  'lazada.sponsored_reporting',
  'tiktok.shop_video',
  'tiktok.business_ads',
  'tiktok.gmv_max',
]);
export type Capability = z.infer<typeof CapabilityId>;
export const platformLabels: Record<z.infer<typeof AdPlatform>, string> = {
  facebook: 'Facebook',
  shopee: 'Shopee',
  lazada: 'Lazada',
  tiktok: 'TikTok',
};

/** Capability metadata is not account authorization or proof of an installed adapter. */
export const capabilityRegistry = {
  'facebook.ad_insights': { platform: 'facebook', label: 'Facebook Ads', adIdentity: true },
  'shopee.ads_reporting': { platform: 'shopee', label: 'Shopee Ads', adIdentity: false },
  'lazada.sponsored_reporting': {
    platform: 'lazada',
    label: 'Lazada Sponsored Solutions',
    adIdentity: false,
  },
  'tiktok.shop_video': { platform: 'tiktok', label: 'TikTok Shop Video', adIdentity: false },
  'tiktok.business_ads': { platform: 'tiktok', label: 'TikTok Ads', adIdentity: false },
  'tiktok.gmv_max': { platform: 'tiktok', label: 'TikTok GMV Max', adIdentity: false },
} as const satisfies Record<
  Capability,
  { platform: z.infer<typeof AdPlatform>; label: string; adIdentity: boolean }
>;

export const CapabilityAvailability = z
  .strictObject({
    capability: CapabilityId,
    phase: z.enum(['disabled', 'configured', 'verified', 'shadow', 'enabled']),
    verifiedAt: Instant.nullable(),
    reason: z.string().min(1).max(300).nullable(),
  })
  .superRefine((value, ctx) => {
    if (['verified', 'shadow', 'enabled'].includes(value.phase) && value.verifiedAt === null)
      ctx.addIssue({ code: 'custom', path: ['verifiedAt'], message: 'Verification is required' });
    if (value.phase !== 'enabled' && value.reason === null)
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Unavailable capability needs a reason',
      });
  });
export const SourceMode = z.enum(['synthetic', 'native']);

/** A source-owned ID is opaque; never coerce it to a number or silently trim it. */
export const ExternalId = Id.regex(/^[^\s\u0000-\u001f\u007f]+$/u);
/** Only the first understood identity is implemented. Other grains require their own contract. */
export const SourceIdentityV2 = z.strictObject({
  schemaVersion: z.literal(2),
  platform: z.literal('facebook'),
  capability: z.literal('facebook.ad_insights'),
  namespace: Id,
  connectionId: Id,
  accountId: ExternalId,
  objectType: z.literal('ad'),
  externalId: ExternalId,
});
export const ResolvedSourceV2 = z
  .strictObject({
    schemaVersion: z.literal(2),
    identity: SourceIdentityV2,
    apiVersion: Id,
    sourceRevision: Id.nullable(),
    name: z.string().min(1).max(500),
    creativeIds: z.array(ExternalId).max(100).nullable(),
    fetchedAt: Instant,
  })
  .refine(
    (v) => v.creativeIds === null || new Set(v.creativeIds).size === v.creativeIds.length,
    'Duplicate creative references',
  );

/** Stable identity excludes transport/connection rotation; account and namespace isolate IDs. */
export function sourceIdentityKey(raw: z.infer<typeof SourceIdentityV2>) {
  const value = SourceIdentityV2.parse(raw);
  return JSON.stringify([
    value.platform,
    value.namespace,
    value.accountId,
    value.objectType,
    value.externalId,
  ]);
}
