import { observeApi } from '@/server/platform/observability/api';
import { readyResponse } from '@/server/http/health';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function handleGET(request: Request) {
  return readyResponse(request, getIdentityRuntime, process.env);
}
const handleHEAD = handleGET;

export const GET = observeApi('/api/ready', handleGET);
export const HEAD = observeApi('/api/ready', handleHEAD);
