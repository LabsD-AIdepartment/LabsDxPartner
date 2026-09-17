// Production stub for the dev ad-performance GET handler. The `@ad-performance-handler` build alias
// resolves to THIS module outside the development server, so none of the snapshot read code — nor the
// `synthetic-ad-performance-snapshot` marker — is ever bundled for production. It imports no node
// builtin and no dev module; it always answers 404 (the endpoint does not exist).
//
// The exported signature MUST stay byte-compatible with handler.ts::handleAdPerformanceRequest.

export type AutoRefreshFn = (params: {
  env: Record<string, string | undefined>;
  dir: string;
  fileName: string;
  binding: unknown;
  now: () => number;
  fetch?: typeof fetch;
}) => Promise<unknown>;

export interface HandlerDeps {
  env?: Record<string, string | undefined>;
  dir?: string;
  readSnapshot?: (dir: string, fileName: string) => unknown;
  now?: () => number;
  fetch?: typeof fetch;
  autoRefresh?: AutoRefreshFn;
}

export async function handleAdPerformanceRequest(
  _request: Request,
  _deps: HandlerDeps = {},
): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not_found', reason: 'development-only' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
