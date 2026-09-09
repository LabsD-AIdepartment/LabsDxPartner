import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { Sql, TransactionSql } from 'postgres';
import { IssuePasswordReset, ResetPassword, ChangePassword } from '@/contracts/passwords';
import { InviteToken } from '@/contracts/invitations';
import { createCredentialIdentity, type CredentialConfig } from './credential-auth';
import { credentialWrite } from './credential-session';
import { transactionDatabase } from './transaction-auth';
import { revokeIdentitySessions } from './revocation';
import type { Principal, ResolvePrincipal } from './resolve-principal';
import { FRESH_SESSION_SECONDS } from './policy';

export class PasswordFailure extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'invalid_reset'
      | 'unauthenticated'
      | 'fresh_auth_required'
      | 'forbidden'
      | 'conflict'
      | 'invalid_password',
  ) {
    super(code);
  }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const completed = { status: 'requires-login' as const };

/** Server-only. HTTP entry points must separately enforce origin, binding, size and attempt limits. */
export function createPasswordService(
  sql: Sql,
  config: CredentialConfig,
  resolve: ResolvePrincipal,
) {
  async function principal(headers: Headers) {
    const actor = await resolve(headers);
    if (!actor) throw new PasswordFailure('unauthenticated');
    return actor;
  }
  async function session(tx: TransactionSql, actor: Principal, fresh = false) {
    const [row] =
      await tx`select id, (created_at <= clock_timestamp() AND created_at > clock_timestamp()-${FRESH_SESSION_SECONDS}*interval '1 second') as fresh
      from portal_identity.sessions where id=${actor.sessionId} AND user_id=${actor.userId} AND expires_at>clock_timestamp() for share`;
    if (!row) throw new PasswordFailure('unauthenticated');
    if (fresh && !row.fresh) throw new PasswordFailure('fresh_auth_required');
  }
  async function account(tx: TransactionSql, userId: string) {
    const rows =
      await tx`select id,password from portal_identity.accounts where user_id=${userId} AND provider_id='credential' AND account_id=${userId} for update`;
    if (rows.length !== 1 || !rows[0].password) throw new PasswordFailure('forbidden');
    return rows[0] as { id: string; password: string };
  }
  async function audit(
    tx: TransactionSql,
    actorId: string,
    action: string,
    targetId: string,
    key: string,
    requestHash: string,
    result: object,
    details: object,
  ) {
    await tx`insert into portal_identity.method_audit(id,actor_id,action,target_id,idempotency_key,request_hash,result,details)
      values(${randomUUID()},${actorId},${action},${targetId},${key},${requestHash},${JSON.stringify(result)}::text::jsonb,${JSON.stringify(details)}::text::jsonb)`;
  }
  async function replace(tx: TransactionSql, userId: string, passwordHash: string) {
    const credential = await account(tx, userId);
    const context = await createCredentialIdentity(config, transactionDatabase(tx)).$context;
    await context.internalAdapter.updateAccount(credential.id, { password: passwordHash });
    await tx`update portal_identity.password_resets set revoked_at=clock_timestamp() where user_id=${userId} AND consumed_at IS NULL AND revoked_at IS NULL`;
    const revoked = await revokeIdentitySessions(tx, userId);
    return revoked.map((row) => row.id as string);
  }
  async function lookup(token: string, tx?: TransactionSql) {
    const query = tx ?? sql;
    const [row] = await query`select r.id,r.user_id,u.username,r.expires_at
      from portal_identity.password_resets r
      join portal_identity.users u on u.id=r.user_id
      join portal_access.memberships m on m.user_id=r.user_id AND m.partner_id=r.partner_id
      join portal_access.partners p on p.id=r.partner_id
      join portal_access.staff_grants g on g.user_id=r.created_by
      where r.token_hash=${digest(token)} AND r.consumed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at>clock_timestamp()
        AND m.status='active' AND p.status='active' AND m.permission_revision=r.membership_revision AND m.verified_contact_ref=r.verified_contact_ref
        AND g.active AND g.revision=r.issuer_revision AND 'manage_partners'=ANY(g.capabilities)
        AND NOT EXISTS(select 1 from portal_access.staff_grants target_staff where target_staff.user_id=r.user_id)
      ${tx ? query`for update of r for share of m,p,g` : query``}`;
    if (!row) throw new PasswordFailure('invalid_reset');
    return row as { id: string; user_id: string; username: string; expires_at: Date };
  }
  return {
    async issue(headers: Headers, input: unknown) {
      const parsed = IssuePasswordReset.safeParse(input);
      if (!parsed.success) throw new PasswordFailure('invalid_input');
      const command = parsed.data,
        actor = await principal(headers);
      return credentialWrite(sql, async (tx) => {
        await session(tx, actor, true);
        const [grant] =
          await tx`select revision::text from portal_access.staff_grants where user_id=${actor.userId} AND active AND 'manage_partners'=ANY(capabilities) for share`;
        if (!grant) throw new PasswordFailure('forbidden');
        const [member] =
          await tx`select m.id from portal_access.memberships m join portal_access.partners p on p.id=m.partner_id
          where m.partner_id=${command.partnerId} AND m.user_id=${command.userId} AND m.status='active' AND p.status='active'
            AND m.permission_revision=${command.expectedRevision} AND m.verified_contact_ref=${command.verifiedContactRef}
            AND NOT EXISTS(select 1 from portal_access.staff_grants g where g.user_id=m.user_id) for share of m,p`;
        if (!member) throw new PasswordFailure('forbidden');
        await account(tx, command.userId);
        const requestHash = digest(JSON.stringify(['issue-password-reset', command]));
        const [prior] =
          await tx`select request_hash,result from portal_identity.method_audit where actor_id=${actor.userId} AND idempotency_key=${command.idempotencyKey}`;
        if (prior) {
          if (prior.request_hash !== requestHash) throw new PasswordFailure('conflict');
          return { ...(prior.result as { id: string; expiresAt: string }), token: null };
        }
        const replaced =
          await tx`update portal_identity.password_resets set revoked_at=clock_timestamp() where user_id=${command.userId} AND consumed_at IS NULL AND revoked_at IS NULL returning id`;
        const id = randomUUID(),
          token = randomBytes(32).toString('base64url');
        const [created] =
          await tx`insert into portal_identity.password_resets(id,user_id,partner_id,membership_revision,verified_contact_ref,verification_evidence_ref,token_hash,created_by,issuer_revision,expires_at)
          values(${id},${command.userId},${command.partnerId},${command.expectedRevision},${command.verifiedContactRef},${command.verificationEvidenceRef},${digest(token)},${actor.userId},${grant.revision},clock_timestamp()+interval '30 minutes') returning expires_at`;
        const result = { id, expiresAt: new Date(created.expires_at).toISOString() };
        await audit(
          tx,
          actor.userId,
          'issue-password-reset',
          command.userId,
          command.idempotencyKey,
          requestHash,
          result,
          {
            partnerId: command.partnerId,
            membershipRevision: command.expectedRevision,
            verifiedContactRef: command.verifiedContactRef,
            verificationEvidenceRef: command.verificationEvidenceRef,
            replacedIds: replaced.map((r) => r.id),
          },
        );
        return { ...result, token };
      });
    },
    async inspect(input: unknown) {
      const parsed = InviteToken.safeParse(input);
      if (!parsed.success) throw new PasswordFailure('invalid_reset');
      const row = await lookup(parsed.data);
      return { username: row.username, expiresAt: new Date(row.expires_at).toISOString() };
    },
    async reset(input: unknown) {
      const parsed = ResetPassword.safeParse(input);
      if (!parsed.success) throw new PasswordFailure('invalid_input');
      await lookup(parsed.data.token);
      const passwordHash = await hashPassword(parsed.data.password);
      return credentialWrite(sql, async (tx) => {
        const reset = await lookup(parsed.data.token, tx);
        const [consumed] =
          await tx`update portal_identity.password_resets set consumed_at=clock_timestamp() where id=${reset.id} AND expires_at>clock_timestamp() returning id`;
        if (!consumed) throw new PasswordFailure('invalid_reset');
        const revokedSessionIds = await replace(tx, reset.user_id, passwordHash);
        await audit(
          tx,
          reset.user_id,
          'reset-password',
          reset.user_id,
          'reset:' + reset.id,
          digest(reset.id),
          completed,
          { resetId: reset.id, revokedSessionIds },
        );
        return completed;
      });
    },
    async change(headers: Headers, input: unknown) {
      const parsed = ChangePassword.safeParse(input);
      if (!parsed.success) throw new PasswordFailure('invalid_input');
      const command = parsed.data,
        actor = await principal(headers);
      const passwordHash = await hashPassword(command.password);
      return credentialWrite(sql, async (tx) => {
        await session(tx, actor);
        const [prior] =
          await tx`select id from portal_identity.method_audit where actor_id=${actor.userId} AND idempotency_key=${command.idempotencyKey}`;
        if (prior) throw new PasswordFailure('conflict');
        const credential = await account(tx, actor.userId);
        if (
          !(await verifyPassword({ hash: credential.password, password: command.currentPassword }))
        )
          throw new PasswordFailure('invalid_password');
        const revokedSessionIds = await replace(tx, actor.userId, passwordHash);
        await audit(
          tx,
          actor.userId,
          'change-password',
          actor.userId,
          command.idempotencyKey,
          digest(JSON.stringify(['change-password', actor.userId, command.idempotencyKey])),
          completed,
          { revokedSessionIds },
        );
        return completed;
      });
    },
  };
}
