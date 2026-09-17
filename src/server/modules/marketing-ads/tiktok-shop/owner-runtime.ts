import { createShopVideoOwnerClient } from './owner-client';
import { parseShopVideoProfiles } from './video-config';

/** Missing owner configuration disables Verify but never prevents native status reads or Pause. */
export function configuredShopVideoOwner(env: Record<string, string | undefined>) {
  if (env.LABSD_MARKETING_ENABLED !== '1' || env.LABSD_TIKTOK_VIDEO_ENABLED !== '1') return null;
  try {
    return createShopVideoOwnerClient(
      parseShopVideoProfiles(env.LABSD_TIKTOK_VIDEO_PROFILES),
      env.LABSD_TIKTOK_OWNER_ORIGIN ?? '',
      env.LABSD_TIKTOK_OWNER_SERVICE_TOKEN ?? '',
    );
  } catch {
    return null;
  }
}
