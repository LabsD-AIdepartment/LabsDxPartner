import { z } from 'zod';
import { createAccountReader } from '@/server/modules/account/profile';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
export function createAccountHttp(access: ReturnType<typeof createPartnerAccess>) {
  const read = createAccountReader(access);
  return async (request: Request) => {
    const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
    if (request.method !== 'GET') return new Response(null, { status: 405, headers });
    try {
      const query: Record<string, string> = {};
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(query, key)) throw new AccessFailure('invalid_input');
        query[key] = value;
      }
      return Response.json(await read(request.headers, query), { headers });
    } catch (error) {
      const status =
        error instanceof z.ZodError
          ? 400
          : error instanceof AccessFailure
            ? error.code === 'unauthenticated'
              ? 401
              : error.code === 'conflict'
                ? 409
                : error.code === 'invalid_input'
                  ? 400
                  : 403
            : 503;
      return Response.json(
        { code: status === 503 ? 'UNAVAILABLE' : 'ACCESS_DENIED' },
        { status, headers },
      );
    }
  };
}
