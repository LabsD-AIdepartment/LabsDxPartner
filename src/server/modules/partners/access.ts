import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';
import { Id } from '@/contracts/common';
import { InviteRequest } from '@/contracts/operations';
import { Session, type SessionValue } from '@/contracts/session';
import type { ResolvePrincipal } from '@/server/modules/identity/resolve-principal';
import { FRESH_SESSION_SECONDS } from '@/server/modules/identity/policy';

const PartnerCapability = z.enum([
  'view_earnings',
  'view_content',
  'view_statements',
  'view_ad_spend',
]);
type Capability = z.infer<typeof PartnerCapability>;
const EvidenceRef = Id.regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const Revision = z
  .string()
  .regex(/^[1-9]\d*$/)
  .max(19)
  .refine((v) => /^[1-9]\d*$/.test(v) && v.length <= 19 && BigInt(v) <= 9223372036854775807n);
const MembershipChange = z
  .strictObject({
    partnerId: Id,
    userId: Id,
    expectedRevision: Revision,
    status: z.enum(['active', 'suspended']),
    verifiedContactRef: EvidenceRef,
    capabilities: z
      .array(PartnerCapability)
      .max(4)
      .refine((v) => new Set(v).size === v.length)
      .transform((v) => v.sort()),
    idempotencyKey: Id,
  })
  .refine((v) => v.status !== 'active' || v.capabilities.length > 0);
const InviteClaim = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  idempotencyKey: Id,
});
const InviteRevoke = z.strictObject({ partnerId: Id, inviteId: Id, idempotencyKey: Id });
const InviteResult = z.strictObject({ id: Id, partnerId: Id });
const ClaimResult = z.strictObject({
  membershipId: Id,
  partnerId: Id,
  status: z.literal('pending'),
});
const MemberResult = z.strictObject({ membershipId: Id, revision: Revision });
type Tx = TransactionSql;
type Actor = { userId: string; sessionId: string; displayName: string; fresh: boolean };
export type PartnerScope = {
  userId: string;
  partnerId: string;
  permissionRevision: string;
  capabilities: Capability[];
};
export class AccessFailure extends Error {
  constructor(
    readonly code:
      | 'unauthenticated'
      | 'forbidden'
      | 'fresh_auth_required'
      | 'invalid_input'
      | 'invalid_invite'
      | 'conflict',
  ) {
    super(code);
    this.name = 'AccessFailure';
  }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AccessFailure('invalid_input');
  return result.data;
}

/** No HTTP principal arguments. The resolver verifies the maintained library's signed session. */
export function createPartnerAccess(sql: Sql, resolvePrincipal: ResolvePrincipal) {
  async function transaction<T>(
    headers: Headers,
    write: boolean,
    run: (tx: Tx, actor: Actor) => Promise<T>,
  ): Promise<T> {
    const proof = await resolvePrincipal(headers);
    if (!proof) throw new AccessFailure('unauthenticated');
    // Authorization writes serialize before acquiring actor/target row locks. This avoids
    // two admins revoking each other's sessions in reverse order. Partner readers never
    // acquire this advisory lock; it is not the importer or financial writer's lock.
    const outcome = await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '5s'`;
      await tx`set local statement_timeout = '10s'`;
      await tx`set local idle_in_transaction_session_timeout = '10s'`;
      if (write) await tx`select pg_advisory_xact_lock(981705, 2)`;
      const [session] = await tx`
        select s.id, s.user_id, u.name,
          (s.created_at <= clock_timestamp() AND
           s.created_at > clock_timestamp() - ${FRESH_SESSION_SECONDS} * interval '1 second') as fresh
        from portal_identity.sessions s join portal_identity.users u on u.id = s.user_id
        where s.id = ${proof.sessionId} AND s.user_id = ${proof.userId} AND s.expires_at > clock_timestamp()
        for share of s,u`;
      if (!session) throw new AccessFailure('unauthenticated');
      return {
        value: await run(tx, {
          userId: session.user_id,
          sessionId: session.id,
          displayName: session.name,
          fresh: session.fresh,
        }),
      };
    });
    return outcome.value;
  }
  async function staff(tx: Tx, actor: Actor) {
    if (!actor.fresh) throw new AccessFailure('fresh_auth_required');
    const [grant] = await tx`select capabilities from portal_access.staff_grants
      where user_id = ${actor.userId} AND active for share`;
    if (!grant?.capabilities.includes('manage_partners')) throw new AccessFailure('forbidden');
  }
  async function activePartner(tx: Tx, partnerId: string) {
    const [partner] = await tx`select id from portal_access.partners
      where id = ${partnerId} AND status = 'active' for share`;
    if (!partner) throw new AccessFailure('forbidden');
  }
  async function replay<T>(
    tx: Tx,
    actor: Actor,
    idempotencyKey: string,
    requestHash: string,
    schema: z.ZodType<T>,
  ) {
    const [prior] = await tx`select request_hash,result from portal_access.audit
      where actor_id = ${actor.userId} AND idempotency_key = ${idempotencyKey}`;
    if (!prior) return null;
    if (prior.request_hash !== requestHash) throw new AccessFailure('conflict');
    return parse(schema, prior.result);
  }
  async function audit(
    tx: Tx,
    actor: Actor,
    action: string,
    partnerId: string,
    targetId: string,
    idempotencyKey: string,
    requestHash: string,
    result: Record<string, string>,
    details: Record<string, unknown>,
  ) {
    // Drizzle replaces postgres.js JSON serializers on a shared client. Bind text
    // explicitly, then let PostgreSQL parse JSONB; works with either pool setup.
    await tx`insert into portal_access.audit(id,actor_id,action,partner_id,target_id,idempotency_key,request_hash,result,details)
      values (${randomUUID()},${actor.userId},${action},${partnerId},${targetId},${idempotencyKey},${requestHash},${JSON.stringify(result)}::text::jsonb,${JSON.stringify(details)}::text::jsonb)`;
  }

  return {
    /** Keep dependent data reads in this transaction and scope every join with scope.partnerId. */
    async withPartner<T>(
      headers: Headers,
      partnerId: string,
      capability: Capability,
      read: (tx: Tx, scope: PartnerScope) => Promise<T>,
    ): Promise<T> {
      parse(Id, partnerId);
      parse(PartnerCapability, capability);
      return transaction(headers, false, async (tx, actor) => {
        const [membership] =
          await tx`select m.capabilities,m.permission_revision::text as revision,p.revision::text as partner_revision
          from portal_access.memberships m join portal_access.partners p on p.id = m.partner_id
          where m.user_id = ${actor.userId} AND m.partner_id = ${partnerId} AND m.status = 'active' AND p.status = 'active'
          for share of m,p`;
        if (!membership || !membership.capabilities.includes(capability))
          throw new AccessFailure('forbidden');
        const capabilities = parse(z.array(PartnerCapability), membership.capabilities);
        return read(tx, {
          userId: actor.userId,
          partnerId,
          capabilities,
          permissionRevision: `p${membership.partner_revision}:m${membership.revision}`,
        });
      });
    },
    async session(headers: Headers, selectedPartnerId?: string): Promise<SessionValue> {
      if (selectedPartnerId !== undefined) parse(Id, selectedPartnerId);
      return transaction(headers, false, async (tx, actor) => {
        const rows =
          await tx`select m.partner_id,p.name,m.status,p.status as partner_status,m.capabilities,
          m.permission_revision::text as revision,p.revision::text as partner_revision
          from portal_access.memberships m join portal_access.partners p on p.id = m.partner_id
          where m.user_id = ${actor.userId} order by m.partner_id for share of m,p`;
        const active = rows.filter(
          (row) => row.status === 'active' && row.partner_status === 'active',
        );
        if (
          selectedPartnerId !== undefined &&
          !active.some((row) => row.partner_id === selectedPartnerId)
        )
          throw new AccessFailure('forbidden');
        return Session.parse({
          userId: actor.userId,
          displayName: actor.displayName,
          activePartnerId: selectedPartnerId ?? active[0]?.partner_id ?? null,
          memberships: active.map((row) => ({
            partnerId: row.partner_id,
            partnerName: row.name,
            permissionRevision: `p${row.partner_revision}:m${row.revision}`,
            capabilities: row.capabilities,
          })),
          access: active.length
            ? 'active'
            : rows.some((row) => row.status === 'suspended' || row.partner_status === 'suspended')
              ? 'suspended'
              : 'pending',
        });
      });
    },
    async issueInvite(headers: Headers, input: unknown) {
      const command = parse(InviteRequest, input),
        requestHash = hash(JSON.stringify(['invite', command]));
      return transaction(headers, true, async (tx, actor) => {
        await staff(tx, actor);
        await activePartner(tx, command.partnerId);
        const prior = await replay(tx, actor, command.idempotencyKey, requestHash, InviteResult);
        if (prior) return { ...prior, token: null, replayed: true };
        const [timeCheck] =
          await tx`select ${command.expiresAt}::timestamptz > clock_timestamp() as valid`;
        if (!timeCheck.valid) throw new AccessFailure('invalid_input');
        const token = randomBytes(32).toString('base64url'),
          id = randomUUID();
        await tx`insert into portal_access.invites(id,partner_id,token_hash,expires_at,created_by)
          values (${id},${command.partnerId},${hash(token)},${command.expiresAt},${actor.userId})`;
        const result = { id, partnerId: command.partnerId };
        await audit(
          tx,
          actor,
          'invite',
          command.partnerId,
          id,
          command.idempotencyKey,
          requestHash,
          result,
          { expiresAt: command.expiresAt },
        );
        return { ...result, token, replayed: false };
      });
    },
    async claimInvite(headers: Headers, input: unknown) {
      const command = parse(InviteClaim, input),
        tokenHash = hash(command.token);
      const requestHash = hash(JSON.stringify(['claim', tokenHash]));
      return transaction(headers, true, async (tx, actor) => {
        const prior = await replay(tx, actor, command.idempotencyKey, requestHash, ClaimResult);
        if (prior) return { ...prior, replayed: true };
        const [invite] =
          await tx`update portal_access.invites set claimed_at = clock_timestamp(),claimed_by = ${actor.userId}
          where token_hash = ${tokenHash} AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at > clock_timestamp()
          returning id,partner_id`;
        if (!invite) throw new AccessFailure('invalid_invite');
        await activePartner(tx, invite.partner_id);
        const id = randomUUID();
        const inserted =
          await tx`insert into portal_access.memberships(id,partner_id,user_id,status)
          values (${id},${invite.partner_id},${actor.userId},'pending') on conflict(partner_id,user_id) do nothing returning id`;
        if (!inserted.length) throw new AccessFailure('conflict');
        const result = {
          membershipId: id,
          partnerId: invite.partner_id,
          status: 'pending' as const,
        };
        await audit(
          tx,
          actor,
          'claim',
          invite.partner_id,
          id,
          command.idempotencyKey,
          requestHash,
          result,
          { inviteId: invite.id, userId: actor.userId, status: 'pending', capabilities: [] },
        );
        return { ...result, replayed: false };
      });
    },
    async changeMembership(headers: Headers, input: unknown) {
      const command = parse(MembershipChange, input),
        requestHash = hash(JSON.stringify(['membership', command]));
      return transaction(headers, true, async (tx, actor) => {
        await staff(tx, actor);
        await activePartner(tx, command.partnerId);
        const prior = await replay(tx, actor, command.idempotencyKey, requestHash, MemberResult);
        if (prior) return { ...prior, replayed: true };
        const [previous] =
          await tx`select status,capabilities,verified_contact_ref,permission_revision::text as revision
          from portal_access.memberships where partner_id = ${command.partnerId} AND user_id = ${command.userId}
          AND permission_revision = ${command.expectedRevision}::bigint for update`;
        if (!previous) throw new AccessFailure('conflict');
        const [member] = await tx`update portal_access.memberships set status = ${command.status},
          capabilities = ${tx.array(command.capabilities)}::text[],verified_contact_ref = ${command.verifiedContactRef},
          permission_revision = permission_revision + 1,updated_at = clock_timestamp()
          where partner_id = ${command.partnerId} AND user_id = ${command.userId} AND permission_revision = ${command.expectedRevision}::bigint
          returning id,permission_revision::text as revision`;
        if (!member) throw new AccessFailure('conflict');
        const revoked =
          await tx`delete from portal_identity.sessions where user_id = ${command.userId} returning id`;
        const result = { membershipId: String(member.id), revision: String(member.revision) };
        await audit(
          tx,
          actor,
          'membership',
          command.partnerId,
          member.id,
          command.idempotencyKey,
          requestHash,
          result,
          {
            userId: command.userId,
            previous,
            current: {
              status: command.status,
              capabilities: command.capabilities,
              verified_contact_ref: command.verifiedContactRef,
              revision: member.revision,
            },
            sessionsRevoked: revoked.length,
          },
        );
        return { ...result, replayed: false };
      });
    },
    async revokeInvite(headers: Headers, input: unknown) {
      const command = parse(InviteRevoke, input),
        requestHash = hash(JSON.stringify(['revoke-invite', command]));
      return transaction(headers, true, async (tx, actor) => {
        await staff(tx, actor);
        await activePartner(tx, command.partnerId);
        const prior = await replay(tx, actor, command.idempotencyKey, requestHash, InviteResult);
        if (prior) return { ...prior, replayed: true };
        const [invite] = await tx`update portal_access.invites set revoked_at = clock_timestamp()
          where id = ${command.inviteId} AND partner_id = ${command.partnerId} AND claimed_at IS NULL AND revoked_at IS NULL returning id`;
        if (!invite) throw new AccessFailure('conflict');
        const result = { id: String(invite.id), partnerId: command.partnerId };
        await audit(
          tx,
          actor,
          'revoke-invite',
          command.partnerId,
          invite.id,
          command.idempotencyKey,
          requestHash,
          result,
          { status: 'revoked' },
        );
        return { ...result, replayed: false };
      });
    },
  };
}
