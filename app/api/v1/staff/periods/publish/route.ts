import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createStaffFinanceHttp } from '@/server/http/staff-finance';
import { statementPublicationEnabled } from '@/server/modules/statements/activation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handlePOST(request: Request) {
  if (!statementPublicationEnabled(process.env))
    return Response.json({ code: 'PUBLICATION_DISABLED', retryable: false }, {
      status: 503,
      headers: {
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_FINANCE_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: createStaffFinanceHttp(identity.partners, process.env.BETTER_AUTH_URL!, true),
        }
      : null;
  });
}

export const POST = observeApi('/api/v1/staff/periods/publish', handlePOST);
