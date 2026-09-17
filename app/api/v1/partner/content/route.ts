import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createContentHttp } from '@/server/http/content';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handleGET(request: Request) {
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_FINANCE_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: createContentHttp(identity.partners, {
            marketingEnabled: process.env.LABSD_MARKETING_ENABLED === '1',
          }),
        }
      : null;
  });
}

export const GET = observeApi('/api/v1/partner/content', handleGET);
