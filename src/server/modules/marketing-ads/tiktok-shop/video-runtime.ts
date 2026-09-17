import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createShopVideoHttp } from '@/server/http/shop-videos';
import { createMarketingConnectionsHttp } from '@/server/http/marketing-connections';
import { createShopVideoConnections } from './video-connections';
import { configuredShopVideoOwner } from './owner-runtime';

/** Separate capability switch. No source calls or credential initialization on a portal read. */
export function handleShopVideoRequest(
  request: Request,
  action: Parameters<typeof createShopVideoHttp>[2] | 'connections',
) {
  return handleIdentityRequest(request, () => {
    const identity =
      process.env.LABSD_MARKETING_ENABLED === '1' && process.env.LABSD_TIKTOK_VIDEO_ENABLED === '1'
        ? getIdentityRuntime()
        : null;
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle:
            action === 'connections'
              ? createMarketingConnectionsHttp(
                  createShopVideoConnections(
                    identity.partners,
                    configuredShopVideoOwner(process.env),
                  ),
                  process.env.BETTER_AUTH_URL!,
                )
              : createShopVideoHttp(identity.partners, process.env.BETTER_AUTH_URL!, action),
        }
      : null;
  });
}
