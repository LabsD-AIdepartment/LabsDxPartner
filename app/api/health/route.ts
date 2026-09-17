import { observeApi } from '@/server/platform/observability/api';
import { healthResponse } from '@/server/http/health';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handleGET = healthResponse;
const handleHEAD = healthResponse;

export const GET = observeApi('/api/health', handleGET);
export const HEAD = observeApi('/api/health', handleHEAD);
