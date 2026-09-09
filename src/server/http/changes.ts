import { z } from 'zod';
import { Id } from '@/contracts/common';
import { PartnerCapability } from '@/contracts/access';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { readRevisions } from '@/server/platform/db/revisions';

const Query = z.strictObject({
  partnerId: Id,
  permissionRevision: Id,
  capability: PartnerCapability,
});
export function createChangesHttp(access: ReturnType<typeof createPartnerAccess>) {
  return async (request: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== 'GET') return new Response(null, { status: 405, headers });
    try {
      const values: Record<string, string> = Object.create(null);
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(values, key)) throw new AccessFailure('invalid_input');
        values[key] = value;
      }
      const parsed = Query.safeParse(values);
      if (!parsed.success) throw new AccessFailure('invalid_input');
      const q = parsed.data;
      const result = await access.withPartner(
        request.headers,
        q.partnerId,
        q.capability,
        async (tx, scope) => {
          if (q.permissionRevision !== scope.permissionRevision)
            throw new AccessFailure('forbidden');
          return readRevisions(tx, scope);
        },
      );
      return Response.json(result, { headers });
    } catch (error) {
      const status =
        error instanceof AccessFailure
          ? error.code === 'unauthenticated'
            ? 401
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
