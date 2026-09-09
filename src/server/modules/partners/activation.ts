import { createHash, randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { ActivateAccount, AcceptInvitation, InviteToken } from '@/contracts/invitations';
import { MemberCapabilities } from '@/contracts/access';
import { credentialRegistration } from '@/server/modules/identity/registration';
import type { CredentialConfig } from '@/server/modules/identity/credential-auth';
import type { ResolvePrincipal } from '@/server/modules/identity/resolve-principal';
import { FRESH_SESSION_SECONDS } from '@/server/modules/identity/policy';

export class ActivationFailure extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'invalid_invite'
      | 'username_unavailable'
      | 'fresh_auth_required'
      | 'membership_exists',
  ) {
    super(code);
  }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type Invite = {
  id: string;
  partner_id: string;
  name: string;
  recipient_name: string;
  verified_contact_ref: string;
  capabilities: string[];
  expires_at: Date;
};

/** The only credential setup authority is an unconsumed, preapproved server-owned invitation. */
export function createInvitationActivation(
  sql: Sql,
  config: CredentialConfig,
  resolvePrincipal: ResolvePrincipal,
) {
  const identity = credentialRegistration(config);
  async function lookup(token: string, tx?: TransactionSql): Promise<Invite> {
    const query = tx ?? sql;
    const rows =
      await query`select i.id,i.partner_id,p.name,i.recipient_name,i.verified_contact_ref,i.capabilities,i.expires_at
      from portal_access.invites i join portal_access.partners p on p.id=i.partner_id
      where i.token_hash=${digest(token)} AND i.claimed_at IS NULL AND i.revoked_at IS NULL
      AND i.expires_at > clock_timestamp() AND i.verified_contact_ref IS NOT NULL AND p.status='active'
      ${tx ? query`for update of i,p` : query``}`;
    if (!rows[0]) throw new ActivationFailure('invalid_invite');
    return rows[0] as Invite;
  }
  async function transaction<T>(run: (tx: TransactionSql) => Promise<T>): Promise<T> {
    const result = await sql.begin(async (tx) => {
      await tx`set local lock_timeout='5s'`;
      await tx`set local statement_timeout='10s'`;
      await tx`set local idle_in_transaction_session_timeout='10s'`;
      // Same ordering as membership and invite revocation writers.
      await tx`select pg_advisory_xact_lock(981705,2)`;
      return { value: await run(tx) };
    });
    return result.value;
  }
  async function activate(tx: TransactionSql, invite: Invite, userId: string) {
    const capabilities = MemberCapabilities.parse(invite.capabilities);
    const [previous] =
      await tx`select id from portal_access.memberships where partner_id=${invite.partner_id} AND user_id=${userId}`;
    if (previous) throw new ActivationFailure('membership_exists');
    const membershipId = randomUUID();
    await tx`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref)
      values (${membershipId},${invite.partner_id},${userId},'active',${tx.array(capabilities)}::text[],${invite.verified_contact_ref})`;
    const [claimed] =
      await tx`update portal_access.invites set claimed_at=clock_timestamp(),claimed_by=${userId}
      where id=${invite.id} AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() returning id`;
    if (!claimed) throw new ActivationFailure('invalid_invite');
    const result = {
      userId,
      partnerId: invite.partner_id,
      membershipId,
      status: 'active' as const,
    };
    // Never include password, hash or bearer token in audit/replay material.
    await tx`insert into portal_access.audit(id,actor_id,action,partner_id,target_id,idempotency_key,request_hash,result,details)
      values (${randomUUID()},${userId},'activate-invitation',${invite.partner_id},${membershipId},${'activate:' + invite.id},${digest(JSON.stringify([invite.id, userId]))},
      ${JSON.stringify(result)}::text::jsonb,${JSON.stringify({ inviteId: invite.id, capabilities, verifiedContactRef: invite.verified_contact_ref })}::text::jsonb)`;
    return result;
  }
  return {
    async inspect(input: unknown) {
      const token = InviteToken.safeParse(input);
      if (!token.success) throw new ActivationFailure('invalid_invite');
      const invite = await lookup(token.data);
      return {
        partnerName: invite.name,
        recipientName: invite.recipient_name,
        expiresAt: new Date(invite.expires_at).toISOString(),
      };
    },
    async register(input: unknown) {
      const parsed = ActivateAccount.safeParse(input);
      if (!parsed.success) throw new ActivationFailure('invalid_input');
      const command = parsed.data;
      await lookup(command.token);
      const passwordHash = await identity.prepare(command.password);
      return transaction(async (tx) => {
        const invite = await lookup(command.token, tx);
        const [existing] =
          await tx`select id from portal_identity.users where username=${command.username}`;
        if (existing) throw new ActivationFailure('username_unavailable');
        const userId = await identity.create(tx, {
          username: command.username,
          name: invite.recipient_name,
          passwordHash,
        });
        return activate(tx, invite, userId);
      });
    },
    async accept(headers: Headers, input: unknown) {
      const command = AcceptInvitation.safeParse(input);
      if (!command.success) throw new ActivationFailure('invalid_input');
      const principal = await resolvePrincipal(headers);
      if (!principal) throw new ActivationFailure('fresh_auth_required');
      return transaction(async (tx) => {
        const [session] =
          await tx`select id from portal_identity.sessions where id=${principal.sessionId} AND user_id=${principal.userId}
          AND expires_at>clock_timestamp() AND created_at<=clock_timestamp()
          AND created_at>clock_timestamp()-${FRESH_SESSION_SECONDS}*interval '1 second' for share`;
        if (!session) throw new ActivationFailure('fresh_auth_required');
        const invite = await lookup(command.data.token, tx);
        return activate(tx, invite, principal.userId);
      });
    },
  };
}
