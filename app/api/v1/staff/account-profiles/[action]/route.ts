import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createStaffAccountHttp } from '@/server/http/staff-account';
import { createReviewedFiles } from '@/server/adapters/reviewed-files/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handlePOST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (
    process.env.LABSD_ACCOUNT_PROFILE_ENABLED !== '1' ||
    (action !== 'inspect' && action !== 'publish')
  )
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  return handleIdentityRequest(request, () => {
    const identity = getIdentityRuntime();
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: createStaffAccountHttp(
            identity.partners,
            createReviewedFiles(process.env.LABSD_REVIEW_DIRECTORY ?? '').accountProfiles,
            process.env.BETTER_AUTH_URL!,
            action,
          ),
        }
      : null;
  });
}

export const POST = observeApi('/api/v1/staff/account-profiles/[action]', handlePOST);
