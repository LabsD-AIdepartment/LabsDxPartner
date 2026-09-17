import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createStatementsHttp } from '@/server/http/statements';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handleGET(request: Request, context: { params: Promise<{ statementId: string }> }) {
  const { statementId } = await context.params;
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_FINANCE_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: (r) => createStatementsHttp(identity.partners)(r, statementId),
        }
      : null;
  });
}

export const GET = observeApi('/api/v1/partner/statements/[statementId]', handleGET);
