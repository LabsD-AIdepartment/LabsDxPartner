import { z } from 'zod';
import { ProfilePublishCommand, ProfileReviewQuery } from '@/contracts/account-profile';
import {
  createAccountProfilePublisher,
  createAccountProfileReview,
  type AccountProfileRepository,
} from '@/server/modules/account/profile';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { boundedRequest } from './bounded-request';
export function createStaffAccountHttp(
  access: ReturnType<typeof createPartnerAccess>,
  source: AccountProfileRepository,
  origin: string,
  action: 'inspect' | 'publish',
) {
  const inspect = createAccountProfileReview(access, source),
    publish = createAccountProfilePublisher(access, source);
  const expectedOrigin = new URL(origin).origin;
  return async (request: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== 'POST') return new Response(null, { status: 405, headers });
    try {
      if (new URL(request.url).search) throw new AccessFailure('invalid_input');
      if (request.headers.get('origin') !== expectedOrigin) throw new AccessFailure('forbidden');
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        throw new AccessFailure('invalid_input');
      const buffered = await boundedRequest(request);
      if (buffered instanceof Response) {
        Object.entries(headers).forEach(([k, v]) => buffered.headers.set(k, v));
        return buffered;
      }
      const body: unknown = await buffered.json().catch(() => null);
      // Validate commands here; malformed server-owned source is an unavailable source, not bad user input.
      const command = (action === 'inspect' ? ProfileReviewQuery : ProfilePublishCommand).parse(
        body,
      );
      return Response.json(
        await (action === 'inspect' ? inspect : publish)(request.headers, command),
        { headers },
      );
    } catch (error) {
      const status =
        error instanceof z.ZodError
          ? 400
          : error instanceof AccessFailure
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
