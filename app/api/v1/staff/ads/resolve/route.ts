import { observeApi } from '@/server/platform/observability/api';
import { handleMarketingRequest } from '@/server/modules/marketing-ads/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlePOST = (request: Request) => handleMarketingRequest(request, 'resolve');

export const POST = observeApi('/api/v1/staff/ads/resolve', handlePOST);
