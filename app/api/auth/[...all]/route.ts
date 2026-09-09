import { toNextJsHandler } from 'better-auth/next-js';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { handleIdentityRequest } from '@/server/modules/identity/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pass the original Request to the maintained adapter: preserve POST body, URL and repeated cookies.
const handlers = toNextJsHandler((request: Request) => handleIdentityRequest(request, getIdentityRuntime));
export const GET = handlers.GET;
export const POST = handlers.POST;
