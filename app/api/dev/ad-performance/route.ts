import { pitchModeEnabled } from '@/server/platform/pitch-mode';
import { authorizePitchRequest } from '@/server/platform/pitch-access';
import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
// Development-only snapshot endpoint for the ad-performance preview:
//   GET /api/dev/ad-performance?identity&clip&from&to → { performance } (dev) / 404 (prod).
//
// Two independent guards keep the snapshot read path out of production:
//   1. This handler answers 404 whenever NODE_ENV !== 'development'.
//   2. The `@ad-performance-handler` build alias resolves to dev/ad-performance/handler.unavailable.ts
//      (a 404 stub with no node:fs code and no fixture marker) outside the dev server, so the real
//      handler — and its `synthetic-ad-performance-snapshot` marker — never ships. Same mechanism the
//      existing `@demo-dataset-handler` / `@*-preview` aliases use (next.config.ts + tsconfig paths).

import { observeApi } from '@/server/platform/observability/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET(request: Request): Promise<Response> {
  if (pitchModeEnabled()) {
    const denied = await authorizePitchRequest(request);
    if (denied) return denied;
  } else if (!developmentPreviewsEnabled())
    return new Response(JSON.stringify({ error: 'not_found', reason: 'development-only' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  const { handleAdPerformanceRequest } = await import('@ad-performance-handler');
  return handleAdPerformanceRequest(request, pitchModeEnabled() ? { env: { ...process.env, LABSD_AD_SNAPSHOT_AUTO_REFRESH: '0' } } : undefined);
}

export const GET = observeApi('/api/dev/ad-performance', handleGET);
