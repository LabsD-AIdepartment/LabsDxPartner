import { observeApi } from '@/server/platform/observability/api';
import { handleShopVideoRequest } from '@/server/modules/marketing-ads/tiktok-shop/video-runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handleGET = (request: Request) => handleShopVideoRequest(request, 'partner-read');

export const GET = observeApi('/api/v1/partner/content/shop-videos', handleGET);
