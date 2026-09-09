import { createHmac, randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { boundedRequest } from '@/server/http/bounded-request';
import { createPartnerAccess, AccessFailure } from '@/server/modules/partners/access';
import { createStaffAccessReader } from '@/server/modules/partners/staff-access-read';
import {
  createInvitationActivation,
  ActivationFailure,
} from '@/server/modules/partners/activation';
import { createPasswordService, PasswordFailure } from '@/server/modules/identity/passwords';
import type { CredentialConfig } from '@/server/modules/identity/credential-auth';
import type { ResolvePrincipal } from '@/server/modules/identity/resolve-principal';
import { z } from 'zod';
import { Id } from '@/contracts/common';
import { InviteToken } from '@/contracts/invitations';

const tokenInput = z.strictObject({ token: InviteToken });
const sessionInput = z.strictObject({ partnerId: Id.optional() });
const securityHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: securityHeaders });
class AttemptLimit extends Error {}

/** One persisted attempt policy for access commands. Failed mutations still consume attempts. */
function attemptLimiter(sql: Sql, secret: string) {
  const keyFor = (key: string) =>
    'access:' + createHmac('sha256', secret).update(key).digest('hex');
  return async (scope: string, limit: number) => {
    const now = Date.now(),
      key = keyFor(scope);
    const result = await sql.begin(async (tx) => {
      await tx`set local lock_timeout='3s'`;
      await tx`set local statement_timeout='5s'`;
      const [row] =
        await tx`insert into portal_identity.rate_limits(id,key,count,last_request) values(${randomUUID()},${key},1,${now})
        on conflict(key) do update set
          count=CASE WHEN portal_identity.rate_limits.last_request <= ${now - 60000} THEN 1 ELSE portal_identity.rate_limits.count+1 END,
          last_request=CASE WHEN portal_identity.rate_limits.last_request <= ${now - 60000} THEN ${now} ELSE portal_identity.rate_limits.last_request END
        returning count`;
      // Keep expired application buckets bounded without touching native auth counters.
      if (row.count === 1)
        await tx`delete from portal_identity.rate_limits where id IN
        (select id from portal_identity.rate_limits where key LIKE 'access:%' AND last_request<${now - 120000} limit 500)`;
      return row.count as number;
    });
    if (result > limit) throw new AttemptLimit();
  };
}

export function createAccessHttp(
  sql: Sql,
  config: CredentialConfig,
  resolve: ResolvePrincipal,
  assertBinding: () => Promise<void>,
) {
  const partners = createPartnerAccess(sql, resolve);
  const invites = createInvitationActivation(sql, config, resolve);
  const passwords = createPasswordService(sql, config, resolve);
  const limit = attemptLimiter(sql, config.BETTER_AUTH_SECRET);
  const authenticatedActions = new Set([
    'staff/access',
    'memberships/change',
    'session',
    'invitations/accept',
    'invitations/issue',
    'invitations/revoke',
    'passwords/change',
    'passwords/issue',
  ]);
  const actions: Record<string, (headers: Headers, input: unknown) => Promise<unknown>> = {
    'staff/access': createStaffAccessReader(partners),
    'memberships/change': (headers, input) => partners.changeMembership(headers, input),
    session: async (headers, input) =>
      partners.session(headers, sessionInput.parse(input).partnerId),
    'invitations/inspect': async (_, input) => invites.inspect(tokenInput.parse(input).token),
    'invitations/register': (_, input) => invites.register(input),
    'invitations/accept': (headers, input) => invites.accept(headers, input),
    'invitations/issue': (headers, input) => partners.issueActivationInvite(headers, input),
    'invitations/revoke': (headers, input) => partners.revokeInvite(headers, input),
    'passwords/inspect': async (_, input) => passwords.inspect(tokenInput.parse(input).token),
    'passwords/reset': (_, input) => passwords.reset(input),
    'passwords/change': (headers, input) => passwords.change(headers, input),
    'passwords/issue': (headers, input) => passwords.issue(headers, input),
  };
  return async (request: Request) => {
    const path = new URL(request.url).pathname;
    const action = path.startsWith('/api/access/') ? path.slice('/api/access/'.length) : '';
    if (!Object.hasOwn(actions, action) || request.method !== 'POST')
      return json({ code: 'NOT_FOUND' }, 404);
    if (request.headers.get('origin') !== config.BETTER_AUTH_URL)
      return json({ code: 'INVALID_ORIGIN' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      return json({ code: 'INVALID_INPUT' }, 415);
    try {
      await assertBinding();
      const buffered = await boundedRequest(request);
      if (buffered instanceof Response) {
        for (const [name, value] of Object.entries(securityHeaders))
          buffered.headers.set(name, value);
        return buffered;
      }
      const read = action.endsWith('/inspect') || action === 'session' || action === 'staff/access';
      await limit('global:' + action, read ? 240 : 60);
      let input: unknown;
      try {
        input = await buffered.json();
      } catch {
        return json({ code: 'INVALID_INPUT' }, 400);
      }
      const token = tokenInput.safeParse(
        input && typeof input === 'object' && 'token' in input ? { token: input.token } : null,
      );
      const actor = authenticatedActions.has(action) ? await resolve(request.headers) : null;
      if (authenticatedActions.has(action) && !actor) return json({ code: 'UNAUTHENTICATED' }, 401);
      const scope = actor
        ? 'user:' + actor.userId
        : token.success
          ? token.data.token
          : (request.headers.get('cookie') ?? 'anonymous');
      await limit(action + ':' + scope, read ? 60 : 8);
      return json(await actions[action](request.headers, input));
    } catch (error) {
      if (error instanceof AttemptLimit) {
        const response = json({ code: 'TOO_MANY_ATTEMPTS' }, 429);
        response.headers.set('Retry-After', '60');
        return response;
      }
      if (error instanceof z.ZodError) return json({ code: 'INVALID_INPUT' }, 400);
      if (
        error instanceof AccessFailure ||
        error instanceof ActivationFailure ||
        error instanceof PasswordFailure
      ) {
        const code = error.code.toUpperCase();
        const status =
          error.code === 'unauthenticated'
            ? 401
            : ['forbidden', 'fresh_auth_required'].includes(error.code)
              ? 403
              : ['conflict', 'username_unavailable', 'membership_exists'].includes(error.code)
                ? 409
                : 400;
        return json({ code }, status);
      }
      return json({ code: 'ACCESS_UNAVAILABLE' }, 503);
    }
  };
}
