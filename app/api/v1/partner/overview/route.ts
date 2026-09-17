import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createOverviewHttp } from '@/server/http/overview';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handleGET(request: Request) {
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_FINANCE_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity ? { assertBinding: identity.assertBinding, handle: createOverviewHttp(identity.partners) } : null;
  });
}

export const GET = observeApi('/api/v1/partner/overview', handleGET);
