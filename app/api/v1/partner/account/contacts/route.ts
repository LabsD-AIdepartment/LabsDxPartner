import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createAccountContactsHttp } from '@/server/http/account-contacts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  return handleIdentityRequest(request, () => {
    const identity = getIdentityRuntime();
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: createAccountContactsHttp(identity.partners, process.env.BETTER_AUTH_URL!),
        }
      : null;
  });
}
export const GET = observeApi('/api/v1/partner/account/contacts', handle);
export const PUT = observeApi('/api/v1/partner/account/contacts', handle);
