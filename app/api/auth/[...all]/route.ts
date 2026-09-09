import { toNextJsHandler } from 'better-auth/next-js';
import { getIdentityRuntime } from '@/server/modules/identity/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pass the original Request to the maintained adapter: preserve POST body, URL and repeated cookies.
const handlers = toNextJsHandler(async (request: Request) => {
  try {
    const identity = getIdentityRuntime();
    if (!identity) return unavailable();
    await identity.assertBinding();
    const response = await identity.auth.handler(request);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    return unavailable();
  }
});
function unavailable() {
  return Response.json(
    { code: 'IDENTITY_UNAVAILABLE', retryable: true },
    {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    },
  );
}
export const GET = handlers.GET;
export const POST = handlers.POST;
