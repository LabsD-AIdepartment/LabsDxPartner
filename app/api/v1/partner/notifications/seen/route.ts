import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createNotificationsHttp } from '@/server/http/notifications';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_FINANCE_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: createNotificationsHttp(identity.partners, process.env.BETTER_AUTH_URL!, true),
        }
      : null;
  });
}
