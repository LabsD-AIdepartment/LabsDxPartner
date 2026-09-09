import { createNotifications } from '@/server/modules/notifications/read-model';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { boundedRequest } from './bounded-request';
export function createNotificationsHttp(
  access: ReturnType<typeof createPartnerAccess>,
  origin: string,
  seen = false,
) {
  const service = createNotifications(access);
  const expectedOrigin = new URL(origin).origin;
  return async (request: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== (seen ? 'POST' : 'GET'))
      return new Response(null, { status: 405, headers });
    try {
      const input: Record<string, string> = Object.create(null);
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(input, key)) throw new AccessFailure('invalid_input');
        input[key] = value;
      }
      if (!seen) return Response.json(await service.read(request.headers, input), { headers });
      if (Object.keys(input).length) throw new AccessFailure('invalid_input');
      if (request.headers.get('origin') !== expectedOrigin) throw new AccessFailure('forbidden');
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        throw new AccessFailure('invalid_input');
      const buffered = await boundedRequest(request);
      if (buffered instanceof Response) {
        Object.entries(headers).forEach(([key, value]) => buffered.headers.set(key, value));
        return buffered;
      }
      return Response.json(
        await service.seen(request.headers, await buffered.json().catch(() => null)),
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
        { code: status === 503 ? 'UNAVAILABLE' : status === 409 ? 'CHANGED' : 'ACCESS_DENIED' },
        { status, headers },
      );
    }
  };
}
