import { observeApi } from '@/server/platform/observability/api';
import { handleShopVideoRequest } from '@/server/modules/marketing-ads/tiktok-shop/video-runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlePOST = (request: Request) => handleShopVideoRequest(request, 'lookup');

export const POST = observeApi('/api/v1/staff/shop-videos/lookup', handlePOST);
