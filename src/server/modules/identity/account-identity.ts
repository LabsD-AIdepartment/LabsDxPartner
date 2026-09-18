import { createHash, randomUUID } from 'node:crypto';
import { verifyPassword } from 'better-auth/crypto';
import type { Sql } from 'postgres';
import { ChangeAccountIdentity } from '@/contracts/account-identity';
import { credentialWrite } from './credential-session';
import { createCredentialIdentity, type CredentialConfig } from './credential-auth';
import { transactionDatabase } from './transaction-auth';
import { revokeIdentitySessions } from './revocation';
import type { ResolvePrincipal } from './resolve-principal';
export class AccountIdentityFailure extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'unauthenticated'
      | 'forbidden'
      | 'conflict'
      | 'invalid_password'
      | 'username_unavailable',
  ) {
    super(code);
  }
}
export function createAccountIdentityWriter(
  sql: Sql,
  config: CredentialConfig,
  resolve: ResolvePrincipal,
) {
  return async (headers: Headers, input: unknown) => {
    const parsed = ChangeAccountIdentity.safeParse(input);
    if (!parsed.success) throw new AccountIdentityFailure('invalid_input');
    const command = parsed.data,
      actor = await resolve(headers);
    if (!actor) throw new AccountIdentityFailure('unauthenticated');
    if (actor.userId !== command.expectedUserId) throw new AccountIdentityFailure('conflict');
    try {
      return await credentialWrite(sql, async (tx) => {
        const [session] =
          await tx`select id from portal_identity.sessions where id=${actor.sessionId} and user_id=${actor.userId} and expires_at>clock_timestamp() for share`;
        if (!session) throw new AccountIdentityFailure('unauthenticated');
        const [membership] =
          await tx`select m.permission_revision::text as member_revision,p.revision::text as partner_revision
          from portal_access.memberships m join portal_access.partners p on p.id=m.partner_id
          where m.user_id=${actor.userId} and m.partner_id=${command.partnerId} and m.status='active' and p.status='active' for share of m,p`;
        if (!membership) throw new AccountIdentityFailure('forbidden');
        if (
          `p${membership.partner_revision}:m${membership.member_revision}` !==
          command.permissionRevision
        )
          throw new AccountIdentityFailure('conflict');
        const [user] =
          await tx`select name,username from portal_identity.users where id=${actor.userId} for update`;
        if (
          !user ||
          user.name !== command.expectedName ||
          user.username !== command.expectedUsername
        )
          throw new AccountIdentityFailure('conflict');
        const [credential] =
          await tx`select password from portal_identity.accounts where user_id=${actor.userId} and account_id=${actor.userId} and provider_id='credential' for update`;
        if (!credential?.password) throw new AccountIdentityFailure('forbidden');
        if (
          !(await verifyPassword({ hash: credential.password, password: command.currentPassword }))
        )
          throw new AccountIdentityFailure('invalid_password');
        const [prior] =
          await tx`select id from portal_identity.method_audit where actor_id=${actor.userId} and idempotency_key=${command.idempotencyKey}`;
        if (prior) throw new AccountIdentityFailure('conflict');
        const [taken] =
          await tx`select id from portal_identity.users where username=${command.username} and id<>${actor.userId}`;
        if (taken) throw new AccountIdentityFailure('username_unavailable');
        const context = await createCredentialIdentity(config, transactionDatabase(tx)).$context;
        await context.internalAdapter.updateUser(actor.userId, {
          name: command.name,
          username: command.username,
        });
        await tx`update portal_identity.password_resets set revoked_at=clock_timestamp() where user_id=${actor.userId} and consumed_at is null and revoked_at is null`;
        const revoked = await revokeIdentitySessions(tx, actor.userId);
        const result = { status: 'requires-login' as const };
        const digest = createHash('sha256')
          .update(JSON.stringify(['change-account-identity', actor.userId, command.idempotencyKey]))
          .digest('hex');
        await tx`insert into portal_identity.method_audit(id,actor_id,action,target_id,idempotency_key,request_hash,result,details)
          values(${randomUUID()},${actor.userId},'change-account-identity',${actor.userId},${command.idempotencyKey},${digest},${JSON.stringify(result)}::text::jsonb,
          ${JSON.stringify({ nameChanged: user.name !== command.name, usernameChanged: user.username !== command.username, revokedSessionIds: revoked.map((r) => r.id) })}::text::jsonb)`;
        return result;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new AccountIdentityFailure('username_unavailable');
      throw error;
    }
  };
}
