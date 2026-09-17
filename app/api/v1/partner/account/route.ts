import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createAccountHttp } from '@/server/http/account';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handleGET(request: Request) {
  return handleIdentityRequest(request, () => {
    const identity = getIdentityRuntime();
    return identity
      ? { assertBinding: identity.assertBinding, handle: createAccountHttp(identity.partners) }
      : null;
  });
}

export const GET = observeApi('/api/v1/partner/account', handleGET);
