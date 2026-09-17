import { createImportActivityReader } from '@/server/modules/marketing-ads/import-activity';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
export function createImportActivityHttp(
  access: ReturnType<typeof createPartnerAccess>,
  platforms: readonly string[],
) {
  const read = createImportActivityReader(access);
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
      if (!platforms.includes(input.platform))
        return Response.json({ code: 'unavailable' }, { status: 404, headers });
      return Response.json(await read(request.headers, input), { headers });
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
        { code: status === 503 ? 'unavailable' : 'access_denied' },
        { status, headers },
      );
    }
  };
}
