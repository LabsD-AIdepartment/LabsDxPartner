import { createStatementReader } from '@/server/modules/statements/read-model';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';

export function createStatementsHttp(access: ReturnType<typeof createPartnerAccess>) {
  const read = createStatementReader(access);
  return async (request: Request, statementId?: string) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== 'GET') return new Response(null, { status: 405, headers });
    try {
      const params = new URL(request.url).searchParams;
      const input: Record<string, string> = {};
      for (const [key, value] of params) {
        if (key in input || key === 'statementId') throw new AccessFailure('invalid_input');
        input[key] = value;
      }
      if (statementId !== undefined) input.statementId = statementId;
      return Response.json(await read(request.headers, input), { headers });
    } catch (error) {
      const status =
        error instanceof AccessFailure
          ? {
              unauthenticated: 401,
              forbidden: 403,
              fresh_auth_required: 403,
              invalid_input: 400,
              invalid_invite: 403,
              conflict: 409,
            }[error.code]
          : 503;
      return Response.json(
        { code: status === 409 ? 'CHANGED' : status === 503 ? 'UNAVAILABLE' : 'ACCESS_DENIED' },
        { status, headers },
      );
    }
  };
}
