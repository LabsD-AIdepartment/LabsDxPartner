import { observeApi } from '@/server/platform/observability/api';
import { handleDailyFill as handleGET } from '@/server/hosted-demo/daily-chart-fill/handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = observeApi('/api/demo/daily-chart-fill', handleGET);
