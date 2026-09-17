import { pitchModeEnabled } from '@/server/platform/pitch-mode';
import { authorizePitchRequest } from '@/server/platform/pitch-access';
import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
// Development-only snapshot endpoint for the coherent partner-demo dataset:
//   GET /api/dev/demo-dataset?identity=a|b  →  validated DatasetRecords JSON (dev) / 404 (prod).
//
// Two independent guards keep the SQLite read path out of production:
//   1. This handler answers 404 whenever NODE_ENV !== 'development'.
//   2. The `@demo-dataset-handler` build alias resolves to dev/demo-dataset/handler.unavailable.ts
//      (a 404 stub with no node:sqlite / fs code and no fixture marker) outside the dev server, so the
//      real handler — and its `synthetic-demo-dataset-snapshot` marker — never ships. Same mechanism
//      the existing `@*-preview` aliases use (next.config.ts resolveAlias + tsconfig paths).

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
  const { handleDemoDatasetRequest } = await import('@demo-dataset-handler');
  return handleDemoDatasetRequest(request);
}

export const GET = observeApi('/api/dev/demo-dataset', handleGET);
