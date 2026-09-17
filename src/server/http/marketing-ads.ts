import { AccessFailure } from '@/server/modules/partners/access';
import type { createMarketingRegistration } from '@/server/modules/marketing-ads/registration';
import { boundedRequest } from './bounded-request';

export function createMarketingAdsHttp(
  service: ReturnType<typeof createMarketingRegistration>,
  origin: string,
  action: 'read' | 'resolve' | 'save' | 'targets' | 'create-target',
) {
  const expectedOrigin = new URL(origin).origin;
  return async (request: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== (action === 'read' || action === 'targets' ? 'GET' : 'POST'))
      return new Response(null, { status: 405, headers });
    try {
      const query: Record<string, string> = Object.create(null);
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(query, key)) throw new AccessFailure('invalid_input');
        query[key] = value;
      }
      if (action === 'read')
        return Response.json(await service.read(request.headers, query), { headers });
      if (action === 'targets')
        return Response.json(await service.targetOptions(request.headers, query), { headers });
      if (Object.keys(query).length) throw new AccessFailure('invalid_input');
      if (request.headers.get('origin') !== expectedOrigin) throw new AccessFailure('forbidden');
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        throw new AccessFailure('invalid_input');
      const bounded = await boundedRequest(request);
      if (bounded instanceof Response) {
        Object.entries(headers).forEach(([k, v]) => bounded.headers.set(k, v));
        return bounded;
      }
      const body: unknown = await bounded.json().catch(() => null);
      const result =
        action === 'create-target'
          ? await service.createTarget(request.headers, body)
          : action === 'resolve'
            ? await service.resolve(
                request.headers,
                body,
                AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
              )
            : await service.save(request.headers, body);
      return Response.json(result, { headers });
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
        error instanceof AccessFailure && error.code === 'fresh_auth_required'
          ? 'FRESH_AUTH_REQUIRED'
          : status === 409
            ? 'CHANGED'
            : status === 503
              ? 'UNAVAILABLE'
              : status === 400
                ? 'INVALID_INPUT'
                : 'ACCESS_DENIED';
      return Response.json({ code }, { status, headers });
    }
  };
}
