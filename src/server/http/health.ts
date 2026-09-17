type ReadyRuntime = { ready: () => Promise<boolean> };
const dependentWebFlags = [
  'LABSD_FINANCE_ENABLED',
  'LABSD_STATEMENT_PUBLICATION_ENABLED',
  'LABSD_MARKETING_ENABLED',
  'LABSD_TIKTOK_VIDEO_ENABLED',
  'LABSD_ACCOUNT_PROFILE_ENABLED',
] as const;

function statusResponse(request: Request, ready: boolean, liveness = false) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  return new Response(
    request.method === 'HEAD'
      ? null
      : JSON.stringify({
          status: liveness ? 'ok' : ready ? 'ready' : 'unavailable',
        }),
    { status: ready ? 200 : 503, headers },
  );
}

/** Process liveness only: no runtime initialization, network or database access. */
export function healthResponse(request: Request) {
  return statusResponse(request, true, true);
}

export async function readyResponse(
  request: Request,
  runtime: () => ReadyRuntime | null,
  env: Record<string, string | undefined>,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return statusResponse(request, false);
  try {
    if (env.LABSD_STATEMENT_PUBLICATION_ENABLED === '1' && env.LABSD_FINANCE_ENABLED !== '1')
      return statusResponse(request, false);
    if (env.LABSD_IDENTITY_ENABLED !== '1')
      return statusResponse(request, !dependentWebFlags.some((flag) => env[flag] === '1'));
    const identity = runtime();
    return statusResponse(request, identity ? await identity.ready() : false);
  } catch {
    return statusResponse(request, false);
  }
}
