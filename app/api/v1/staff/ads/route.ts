import { observeApi } from '@/server/platform/observability/api';
import { handleMarketingRequest } from '@/server/modules/marketing-ads/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handleGET = (request: Request) => handleMarketingRequest(request, 'read');

export const GET = observeApi('/api/v1/staff/ads', handleGET);
