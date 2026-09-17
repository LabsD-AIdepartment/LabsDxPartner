import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { createShopVideoRegistration } from '@/server/modules/marketing-ads/tiktok-shop/video-registration';
import { createPartnerShopVideoRead } from '@/server/modules/marketing-ads/tiktok-shop/video-partner-read';
import { boundedRequest } from './bounded-request';

export function createShopVideoHttp(
  access: ReturnType<typeof createPartnerAccess>,
  origin: string,
  action: 'lookup' | 'save' | 'partner-read' | 'options',
) {
  const registration = createShopVideoRegistration(access),
    read = createPartnerShopVideoRead(access);
  const expectedOrigin = new URL(origin).origin;
  return async (request: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== (action === 'partner-read' || action === 'options' ? 'GET' : 'POST'))
      return new Response(null, { status: 405, headers });
    try {
      const query: Record<string, string> = Object.create(null);
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(query, key)) throw new AccessFailure('invalid_input');
        query[key] = value;
      }
      if (action === 'partner-read')
        return Response.json(await read(request.headers, query), { headers });
      if (action === 'options')
        return Response.json(await registration.options(request.headers, query), { headers });
      if (Object.keys(query).length) throw new AccessFailure('invalid_input');
      if (request.headers.get('origin') !== expectedOrigin) throw new AccessFailure('forbidden');
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        throw new AccessFailure('invalid_input');
      const bounded = await boundedRequest(request);
      if (bounded instanceof Response) {
        for (const [k, v] of Object.entries(headers)) bounded.headers.set(k, v);
        return bounded;
      }
      const body: unknown = await bounded.json().catch(() => null);
      return Response.json(
        await (action === 'lookup'
          ? registration.lookup(request.headers, body)
          : registration.save(request.headers, body)),
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
      return Response.json(
        {
          code:
            error instanceof AccessFailure && error.code === 'fresh_auth_required'
              ? 'FRESH_AUTH_REQUIRED'
              : status === 409
                ? 'CHANGED'
                : status === 400
                  ? 'INVALID_INPUT'
                  : status === 503
                    ? 'UNAVAILABLE'
                    : 'ACCESS_DENIED',
        },
        { status, headers },
      );
    }
  };
}
