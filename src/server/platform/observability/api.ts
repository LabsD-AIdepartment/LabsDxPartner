import { createBoundedLogWriter, type LogOutput } from './sink';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export type ApiEvent = {
  event: 'api_response';
  at: string;
  requestId: string;
  route: string;
  method: string;
  status: number;
  outcome: 'response' | 'handler_exception';
  headersReadyMs: number;
};
export function createApiSink(output: LogOutput) {
  const write = createBoundedLogWriter(output);
  return (event: ApiEvent) => write({ event: event.event, at: event.at, requestId: event.requestId,
    route: event.route, method: event.method, status: event.status, outcome: event.outcome,
    headersReadyMs: event.headersReadyMs });
}
const stdoutSink = createApiSink(process.stdout);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export function createApiObserver(
  enabled: () => boolean,
  sink: (event: ApiEvent) => void,
) {
  return function observe<Args extends [Request, ...unknown[]]>(
    route: string,
    handler: (...args: Args) => Response | Promise<Response>,
  ): (...args: Args) => Promise<Response> {
    // The caller supplies a source-code template, never the incoming URL or params.
    if (!/^\/api(?:\/[A-Za-z0-9_.[\]-]+)*$/.test(route) || route.length > 160)
      throw new Error('Invalid API route template');
    return async (...args) => {
      if (!enabled()) return handler(...args);
      const requestId = randomUUID();
      const started = performance.now();
      let response: Response;
      let outcome: ApiEvent['outcome'] = 'response';
      try {
        response = await handler(...args);
      } catch {
        outcome = 'handler_exception';
        // Unexpected API failures have no public stack/message and no automatic retry advice.
        response = new Response(args[0].method === 'HEAD' ? null : '{"code":"INTERNAL_ERROR"}', {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
            'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      try {
        response.headers.set('X-Request-ID', requestId);
      } catch {
        // Redirect/fetch responses may have immutable headers. Transfer the stream; never buffer it.
        const headers = new Headers(response.headers);
        headers.set('X-Request-ID', requestId);
        response = new Response(response.body, { status: response.status,
          statusText: response.statusText, headers });
      }
      // Healthy probes have correlation headers but do not flood the operational stream.
      if (!((route === '/api/health' || route === '/api/ready') && response.status < 400)) {
        try {
          sink({ event: 'api_response', at: new Date().toISOString(), requestId, route,
            method: methods.has(args[0].method) ? args[0].method : 'OTHER',
            status: response.status, outcome,
            headersReadyMs: Math.max(0, Math.round(performance.now() - started)),
          });
        } catch { /* Observability cannot turn a completed business action into a failed response. */ }
      }
      return response;
    };
  };
}

/** Deployment opt-in; disabling leaves the original handler response untouched. */
export const observeApi = createApiObserver(
  () => process.env.LABSD_API_OBSERVABILITY_ENABLED === '1', stdoutSink,
);
