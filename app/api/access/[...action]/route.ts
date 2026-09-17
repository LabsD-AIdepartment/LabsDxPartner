import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlePOST = (request: Request) =>
  handleIdentityRequest(request, () => {
    const identity = getIdentityRuntime();
    return identity ? { assertBinding: identity.assertBinding, handle: identity.access } : null;
  });

export const POST = observeApi('/api/access/[...action]', handlePOST);
