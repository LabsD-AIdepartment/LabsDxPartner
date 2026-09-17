import { AccessFailure } from '@/server/modules/partners/access';
import type { createMarketingConnections } from '@/server/modules/marketing-ads/connections';
import { SourceReadError } from '@/server/modules/marketing-ads/source-error';
import { boundedRequest } from './bounded-request';
export function createMarketingConnectionsHttp(
  service: ReturnType<typeof createMarketingConnections>,
  origin: string,
) {
  return async (request: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    try {
      if (!['GET', 'POST'].includes(request.method))
        return new Response(null, { status: 405, headers });
      const query: Record<string, string> = Object.create(null);
      for (const [k, v] of new URL(request.url).searchParams) {
        if (Object.hasOwn(query, k)) throw new AccessFailure('invalid_input');
        query[k] = v;
      }
      if (request.method === 'GET')
        return Response.json(await service.read(request.headers, query), { headers });
      if (
        Object.keys(query).length ||
        request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json'
      )
        throw new AccessFailure('invalid_input');
      if (request.headers.get('origin') !== new URL(origin).origin)
        throw new AccessFailure('forbidden');
      const body = await boundedRequest(request);
      if (body instanceof Response) {
        Object.entries(headers).forEach(([k, v]) => body.headers.set(k, v));
        return body;
      }
      return Response.json(
        await service.command(
          request.headers,
          await body.json().catch(() => null),
          AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        ),
        { headers },
      );
    } catch (error) {
      const status =
        error instanceof AccessFailure
          ? error.code === 'unauthenticated'
            ? 401
            : error.code === 'invalid_input'
              ? 400
              : error.code === 'conflict'
                ? 409
                : 403
          : 503;
      const code =
        error instanceof SourceReadError
          ? error.code
          : error instanceof AccessFailure
            ? error.code
            : 'unavailable';
      return Response.json({ code }, { status, headers });
    }
  };
}
