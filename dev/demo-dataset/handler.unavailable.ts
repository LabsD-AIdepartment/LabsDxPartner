// Production stub for the dev demo-dataset GET handler. The `@demo-dataset-handler` build alias
// resolves to THIS module outside the development server, so none of the SQLite/fs read code — nor
// the `synthetic-demo-dataset-snapshot` fixture marker — is ever bundled for production. It imports
// no node builtins and no dev-dataset modules; it always answers 404 (the endpoint does not exist).
//
// The exported signature MUST stay byte-compatible with handler.ts::handleDemoDatasetRequest so the
// route can call either implementation identically.

export interface HandlerDeps {
  databasePath?: string;
  generation?: string;
}

export async function handleDemoDatasetRequest(
  _request: Request,
  _deps: HandlerDeps = {},
): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not_found', reason: 'development-only' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
