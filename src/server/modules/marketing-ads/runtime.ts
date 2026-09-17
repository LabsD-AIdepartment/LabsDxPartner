import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createMarketingAdsHttp } from '@/server/http/marketing-ads';

/** OFF by default. Native adapters are installed server-side, never selected by browser data. */
export function handleMarketingRequest(
  request: Request,
  action: Parameters<typeof createMarketingAdsHttp>[2],
) {
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_MARKETING_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: createMarketingAdsHttp(
            identity.marketing(),
            process.env.BETTER_AUTH_URL!,
            action,
          ),
        }
      : null;
  });
}
