import { observeApi } from '@/server/platform/observability/api';
import { handleShopVideoRequest } from '@/server/modules/marketing-ads/tiktok-shop/video-runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handleGET = (request: Request) => handleShopVideoRequest(request, 'options');

export const GET = observeApi('/api/v1/staff/shop-videos', handleGET);
