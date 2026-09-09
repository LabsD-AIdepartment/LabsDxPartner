import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { createFinanceReader } from '@/server/modules/staff-finance/read-model';
import { createStatementPublisher } from '@/server/modules/statements/publish';
import { FinancePublish } from '@/contracts/staff-finance';
import { boundedRequest } from './bounded-request';
export function createStaffFinanceHttp(
  access: ReturnType<typeof createPartnerAccess>,
  origin: string,
  publish = false,
) {
  const read = createFinanceReader(access),
    issue = createStatementPublisher(access),
    expectedOrigin = new URL(origin).origin;
  return async (request: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== (publish ? 'POST' : 'GET'))
      return new Response(null, { status: 405, headers });
    try {
      const q: Record<string, string> = Object.create(null);
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(q, key)) throw new AccessFailure('invalid_input');
        q[key] = value;
      }
      if (!publish) return Response.json(await read(request.headers, q), { headers });
      if (Object.keys(q).length) throw new AccessFailure('invalid_input');
      if (request.headers.get('origin') !== expectedOrigin) throw new AccessFailure('forbidden');
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        throw new AccessFailure('invalid_input');
      const buffered = await boundedRequest(request);
      if (buffered instanceof Response) {
        Object.entries(headers).forEach(([k, v]) => buffered.headers.set(k, v));
        return buffered;
      }
      const command = FinancePublish.safeParse(await buffered.json().catch(() => null));
      if (!command.success) throw new AccessFailure('invalid_input');
      return Response.json(await issue(request.headers, command.data), { headers });
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
