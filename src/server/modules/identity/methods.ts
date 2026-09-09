import { createHash, randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';
import { Id } from '@/contracts/common';
import { Provider } from '@/contracts/session';
import type { createIdentity } from './auth';
import type { ResolvePrincipal } from './resolve-principal';
import { FRESH_SESSION_SECONDS } from './policy';
import { revokeIdentitySessions } from './revocation';

const Revision = z.string().regex(/^[a-f0-9]{64}$/);
const Unlink = z.strictObject({ accountId: Id, expectedRevision: Revision, idempotencyKey: Id });
const Method = z.strictObject({ id: Id, provider: Provider });
const Receipt = z.strictObject({
  requestId: Id,
  accountId: Id,
  status: z.literal('requires-reauth'),
  revision: Revision,
});
type MethodValue = z.infer<typeof Method>;
type TransactionAuth = (tx: TransactionSql) => ReturnType<typeof createIdentity>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const revision = (methods: MethodValue[]) => hash(JSON.stringify(methods));
export class IdentityMethodFailure extends Error {
  constructor(
    readonly code:
      | 'unauthenticated'
      | 'fresh_auth_required'
      | 'invalid_input'
      | 'not_found'
      | 'conflict'
      | 'last_method',
  ) {
    super(code);
    this.name = 'IdentityMethodFailure';
  }
}

/** Identity-internal only. HTTP exposure also requires callback/session-issuance fencing. */
export function createIdentityMethods(
  sql: Sql,
  resolvePrincipal: ResolvePrincipal,
  transactionAuth: TransactionAuth,
) {
  async function run<T>(
    headers: Headers,
    write: boolean,
    operation: (tx: TransactionSql, userId: string) => Promise<T>,
  ): Promise<T> {
    const proof = await resolvePrincipal(headers);
    if (!proof) throw new IdentityMethodFailure('unauthenticated');
    const outcome = await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '5s'`;
      await tx`set local statement_timeout = '10s'`;
      await tx`set local idle_in_transaction_session_timeout = '10s'`;
      // Same ordering as membership revocation: authorization writer before actor rows.
      if (write) await tx`select pg_advisory_xact_lock(981705, 2)`;
      const [session] = await tx`
        select s.id, s.user_id,
          (s.created_at <= clock_timestamp() AND
           s.created_at > clock_timestamp() - ${FRESH_SESSION_SECONDS} * interval '1 second') as fresh
        from portal_identity.sessions s join portal_identity.users u on u.id = s.user_id
        where s.id = ${proof.sessionId} AND s.user_id = ${proof.userId} AND s.expires_at > clock_timestamp()
        for share of s,u`;
      if (!session) throw new IdentityMethodFailure('unauthenticated');
      if (write && !session.fresh) throw new IdentityMethodFailure('fresh_auth_required');
      return { value: await operation(tx, session.user_id) };
    });
    return outcome.value;
  }
  async function methods(tx: TransactionSql, userId: string): Promise<MethodValue[]> {
    // These three providers are mandatory in IdentityConfig. Disabled password/foreign
    // provider rows are not usable login methods, even if the library counts them.
    const rows = await tx`select id, provider_id as provider from portal_identity.accounts
      where user_id = ${userId} AND provider_id in ('google','line','apple') AND account_id <> ''
      order by id for share`;
    return z.array(Method).parse(rows);
  }
  return {
    list(headers: Headers) {
      return run(headers, false, async (tx, userId) => {
        const current = await methods(tx, userId);
        return {
          userId,
          revision: revision(current),
          methods: current.map((method) => ({ ...method, canUnlink: current.length > 1 })),
        };
      });
    },
    unlink(headers: Headers, input: unknown) {
      const parsed = Unlink.safeParse(input);
      if (!parsed.success) throw new IdentityMethodFailure('invalid_input');
      const command = parsed.data;
      const requestHash = hash(JSON.stringify({ action: 'unlink', ...command }));
      return run(headers, true, async (tx, userId) => {
        const [prior] = await tx`select request_hash, result from portal_identity.method_audit
          where actor_id = ${userId} AND idempotency_key = ${command.idempotencyKey}`;
        if (prior) {
          if (prior.request_hash !== requestHash) throw new IdentityMethodFailure('conflict');
          return { ...Receipt.parse(prior.result), replayed: true };
        }
        const current = await methods(tx, userId);
        const selected = current.find((method) => method.id === command.accountId);
        if (!selected) throw new IdentityMethodFailure('not_found');
        if (revision(current) !== command.expectedRevision)
          throw new IdentityMethodFailure('conflict');
        if (current.length < 2) throw new IdentityMethodFailure('last_method');
        const [binding] = await tx`select account_id from portal_identity.accounts
          where id = ${selected.id} AND user_id = ${userId}`;
        if (!binding) throw new IdentityMethodFailure('not_found');

        // Crucially the MAINTAINED native API runs on this transaction's adapter.
        // A separate pool here would commit deletion before audit/revocation could fail.
        const native = transactionAuth(tx);
        await native.api.unlinkAccount({ headers, body: { accountId: selected.id } });
        const remaining = await methods(tx, userId);
        if (
          remaining.length !== current.length - 1 ||
          remaining.some((method) => method.id === selected.id)
        )
          throw new Error('Native identity mutation did not remove the selected method');
        const revoked = await revokeIdentitySessions(tx, userId, {
          provider: selected.provider,
          subject: binding.account_id,
        });
        const result = Receipt.parse({
          requestId: randomUUID(),
          accountId: selected.id,
          status: 'requires-reauth',
          revision: revision(remaining),
        });
        const details = {
          before: current,
          after: remaining,
          sessionsRevoked: revoked.length,
          beforeRevision: command.expectedRevision,
          afterRevision: result.revision,
        };
        // Text binding works on both plain postgres.js and Drizzle-configured clients.
        await tx`insert into portal_identity.method_audit
          (id,actor_id,action,target_id,idempotency_key,request_hash,result,details)
          values (${result.requestId},${userId},'unlink',${selected.id},${command.idempotencyKey},
          ${requestHash},${JSON.stringify(result)}::text::jsonb,${JSON.stringify(details)}::text::jsonb)`;
        return { ...result, replayed: false };
      });
    },
  };
}
