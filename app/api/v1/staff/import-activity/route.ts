import { observeApi } from '@/server/platform/observability/api';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';
import { createImportActivityHttp } from '@/server/http/import-activity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function handleGET(request: Request) {
  return handleIdentityRequest(request, () => {
    const identity = process.env.LABSD_MARKETING_ENABLED === '1' ? getIdentityRuntime() : null;
    return identity
      ? {
          assertBinding: identity.assertBinding,
          handle: createImportActivityHttp(identity.partners, [
            'facebook',
            ...(process.env.LABSD_TIKTOK_VIDEO_ENABLED === '1' ? ['tiktok'] : []),
          ]),
        }
      : null;
  });
}

export const GET = observeApi('/api/v1/staff/import-activity', handleGET);
