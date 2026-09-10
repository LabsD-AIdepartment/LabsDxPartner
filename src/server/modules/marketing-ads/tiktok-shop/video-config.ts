import { z } from 'zod';
import { Id } from '@/contracts/common';
import { ShopVideoConnection } from './video-contract';

/** Metadata only. Existing source owner retains OAuth, token refresh and upstream quota. */
export const ShopVideoProfile = ShopVideoConnection.extend({
  acquisitionOwner: z.literal('sale-dashboard'),
  sourceConnectionRef: Id,
});
export type VideoProfile = z.infer<typeof ShopVideoProfile>;

export function parseShopVideoProfiles(raw: string | undefined): VideoProfile[] {
  if (!raw || raw.length > 64000) throw new Error('Invalid shop video profile configuration');
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('Invalid shop video profile configuration');
  }
  const parsed = z.array(ShopVideoProfile).min(1).max(100).safeParse(input);
  if (!parsed.success) throw new Error('Invalid shop video profile configuration');
  const profiles = parsed.data;
  for (const keys of [
    profiles.map((p) => p.connectionId),
    profiles.map((p) => JSON.stringify([p.namespace, p.shopId])),
    profiles.map((p) => p.sourceConnectionRef),
  ])
    if (new Set(keys).size !== keys.length)
      throw new Error('Duplicate shop video profile configuration');
  return profiles;
}
