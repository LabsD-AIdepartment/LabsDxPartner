import { observeApi } from '@/server/platform/observability/api';
import { handleMarketingRequest } from '@/server/modules/marketing-ads/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handleGET = (request: Request) => handleMarketingRequest(request, 'targets');
const handlePOST = (request: Request) => handleMarketingRequest(request, 'create-target');

export const GET = observeApi('/api/v1/staff/ads/targets', handleGET);
export const POST = observeApi('/api/v1/staff/ads/targets', handlePOST);
