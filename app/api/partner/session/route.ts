import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = (request: Request) =>
  handleIdentityRequest(request, () => {
    const identity = getIdentityRuntime();
    return identity
      ? { assertBinding: identity.assertBinding, handle: identity.partnerSession }
      : null;
  });
const handleGET = handle;
const handlePOST = handle;

export const GET = observeApi('/api/partner/session', handleGET);
export const POST = observeApi('/api/partner/session', handlePOST);
