import { z } from 'zod';
import { Id } from '@/contracts/common';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import {
  partnerCookie,
  readPartnerCookie,
  selectSessionPartner,
} from '@/server/modules/access/partner-session';
import { boundedRequest } from './bounded-request';

export function createPartnerSessionHttp(
  access: ReturnType<typeof createPartnerAccess>,
  origin: string,
) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
    try {
      if (request.method === 'GET') {
        const session = await access.session(request.headers);
        return Response.json(selectSessionPartner(session, readPartnerCookie(request.headers)), {
          headers,
        });
      }
      if (request.method !== 'POST') return new Response(null, { status: 405, headers });
      if (request.headers.get('origin') !== origin) throw new AccessFailure('forbidden');
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        throw new AccessFailure('invalid_input');
      const buffered = await boundedRequest(request);
      if (buffered instanceof Response) {
        Object.entries(headers).forEach(([key, value]) => buffered.headers.set(key, value));
        return buffered;
      }
      const input: unknown = await buffered.json().catch(() => null);
      const body = z.strictObject({ partnerId: Id }).safeParse(input);
      if (!body.success) throw new AccessFailure('invalid_input');
      const session = await access.session(request.headers, body.data.partnerId);
      return Response.json(session, {
        headers: { ...headers, 'Set-Cookie': partnerCookie(session) },
      });
    } catch (error) {
      const status =
        error instanceof AccessFailure
          ? error.code === 'unauthenticated'
            ? 401
            : error.code === 'forbidden'
              ? 403
              : 400
          : 503;
      return Response.json(
        { code: status === 503 ? 'UNAVAILABLE' : 'ACCESS_DENIED' },
        { status, headers },
      );
    }
  };
}
