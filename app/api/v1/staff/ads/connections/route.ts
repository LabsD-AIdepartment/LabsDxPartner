import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createMarketingConnectionsHttp } from '@/server/http/marketing-connections';
function handle(request: Request) {
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_MARKETING_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: createMarketingConnectionsHttp(
            identity.marketingConnections(),
            process.env.BETTER_AUTH_URL!,
          ),
        }
      : null;
  });
}
const handleGET = handle;
const handlePOST = handle;

export const GET = observeApi('/api/v1/staff/ads/connections', handleGET);
export const POST = observeApi('/api/v1/staff/ads/connections', handlePOST);
