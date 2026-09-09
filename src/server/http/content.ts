import { createContentReader, ContentReadFailure } from '@/server/modules/content/read-model';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';

export function createContentHttp(access: ReturnType<typeof createPartnerAccess>) {
  const read = createContentReader(access);
  return async (request: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== 'GET') return new Response(null, { status: 405, headers });
    try {
      const input: Record<string, string> = Object.create(null);
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(input, key)) throw new AccessFailure('invalid_input');
        input[key] = value;
      }
      return Response.json(await read(request.headers, input), { headers });
    } catch (error) {
      const status =
        error instanceof ContentReadFailure
          ? error.code === 'not_found'
            ? 404
            : 503
          : error instanceof AccessFailure
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
            status === 409
              ? 'CHANGED'
              : status === 404
                ? 'NOT_FOUND'
                : status === 503
                  ? 'UNAVAILABLE'
                  : 'ACCESS_DENIED',
        },
        { status, headers },
      );
    }
  };
}
