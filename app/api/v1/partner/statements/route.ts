import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createStatementsHttp } from '@/server/http/statements';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_FINANCE_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity
      ? { assertBinding: identity.assertBinding, handle: createStatementsHttp(identity.partners) }
      : null;
  });
}
