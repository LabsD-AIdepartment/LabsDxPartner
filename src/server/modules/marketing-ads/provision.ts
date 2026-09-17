import { createHash } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import type { FacebookProfile } from './facebook/config';
import { parseProvisionCommand, ProvisionFailure } from './provision-command';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Command = ReturnType<typeof parseProvisionCommand>;
type ProvisionProfile = {
  id: string;
  namespace: string;
  accountId: string;
  currency: string;
  timezone: string;
  acquisitionOwner: 'portal-direct' | 'sale-dashboard';
  configuration: FacebookProfile | import('./tiktok-shop/video-config').VideoProfile;
} & (
  | { platform: 'facebook'; capability: 'facebook.ad_insights' }
  | { platform: 'tiktok'; capability: 'tiktok.shop_video' }
);

/** Backward-compatible Facebook entry; source identity is still supplied by trusted configuration. */
export function createMarketingProvisioner(
  sql: Sql,
  profiles: readonly FacebookProfile[],
  assertBinding: (tx: TransactionSql) => Promise<string>,
) {
  return createConnectionProvisioner(
    sql,
    profiles.map((p) => ({
      ...p,
      platform: 'facebook' as const,
      capability: 'facebook.ad_insights' as const,
      configuration: p,
    })),
    assertBinding,
  );
}
/** Shared audited writer; exact supported pairs only. Never expose through staff HTTP. */
export function createConnectionProvisioner(
  sql: Sql,
  profiles: readonly ProvisionProfile[],
  assertBinding: (tx: TransactionSql) => Promise<string>,
) {
  if (
    profiles.some(
      (p) =>
        !(
          (p.platform === 'facebook' && p.capability === 'facebook.ad_insights') ||
          (p.platform === 'tiktok' && p.capability === 'tiktok.shop_video')
        ),
    )
  )
    throw new ProvisionFailure('invalid-input');
  const configured = new Map(profiles.map((p) => [p.id, p]));
  if (
    configured.size !== profiles.length ||
    new Set(
      profiles.map((p) => JSON.stringify([p.namespace, p.platform, p.accountId, p.capability])),
    ).size !== profiles.length
  )
    throw new ProvisionFailure('invalid-input');
  async function prepare(tx: TransactionSql, command: Command) {
    const target = await assertBinding(tx);
    if (!target) throw new ProvisionFailure('identity-mismatch');
    const profile = configured.get(command.connectionId);
    if (!profile) throw new ProvisionFailure('not-configured');
    const requestHash = digest(command);
    const [prior] =
      await tx`select request_hash,plan_hash,result from portal_marketing.provision_commands where id=${command.commandId}`;
    if (prior && prior.request_hash !== requestHash) throw new ProvisionFailure('command-conflict');
    const [duplicate] =
      await tx`select id from portal_marketing.connections where namespace=${profile.namespace} and account_id=${profile.accountId} and platform=${profile.platform} and capability=${profile.capability} and id<>${profile.id}`;
    if (duplicate) throw new ProvisionFailure('identity-mismatch');
    const [connection] =
      await tx`select id,namespace,platform,capability,account_id,label,revision::text,enabled,verified_at from portal_marketing.connections where id=${profile.id} for share`;
    if (
      connection &&
      (connection.namespace !== profile.namespace ||
        connection.account_id !== profile.accountId ||
        connection.platform !== profile.platform ||
        connection.capability !== profile.capability)
    )
      throw new ProvisionFailure('identity-mismatch');
    if (prior) {
      if (!connection) throw new ProvisionFailure('identity-mismatch');
      return { prior, requestHash };
    }
    if ((connection?.revision ?? null) !== command.expectedRevision)
      throw new ProvisionFailure('stale-plan');
    const grants = connection
      ? await tx`select user_id from portal_marketing.connection_grants where connection_id=${profile.id} order by user_id for share`
      : [];
    const users = command.grantUserIds.length
      ? await tx`select user_id,revision::text,active,capabilities from portal_access.staff_grants where user_id in ${tx(command.grantUserIds)} order by user_id for share`
      : [];
    if (
      users.length !== command.grantUserIds.length ||
      users.some((u) => !u.active || !u.capabilities.includes('manage_partners'))
    )
      throw new ProvisionFailure('ineligible-staff');
    const current = grants.map((g) => String(g.user_id));
    const add = command.grantUserIds.filter((id) => !current.includes(id)),
      remove = command.revokeUserIds.filter((id) => current.includes(id));
    const before = connection
      ? {
          id: connection.id,
          namespace: connection.namespace,
          accountId: connection.account_id,
          label: connection.label,
          revision: connection.revision,
          enabled: connection.enabled,
          verified_at: connection.verified_at
            ? new Date(connection.verified_at).toISOString()
            : null,
          grantUserIds: current,
        }
      : null;
    const plan = {
      commandId: command.commandId,
      target,
      profile: {
        id: profile.id,
        platform: profile.platform,
        capability: profile.capability,
        namespace: profile.namespace,
        accountId: profile.accountId,
        currency: profile.currency,
        timezone: profile.timezone,
        acquisitionOwner: profile.acquisitionOwner,
        ...('sourceConnectionRef' in profile.configuration
          ? { sourceConnectionRef: profile.configuration.sourceConnectionRef }
          : {}),
      },
      before,
      changes: {
        create: !connection,
        label: command.label,
        grantUserIds: add,
        revokeUserIds: remove,
      },
      // References/configuration and current staff revision fence the reviewed plan; never token values.
      configurationDigest: digest(profile.configuration),
      staffRevisions: users.map((u) => ({ userId: u.user_id, revision: u.revision })),
    };
    return { prior: null, requestHash, plan, planHash: digest([requestHash, plan]) };
  }
  async function transaction<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    return (await sql.begin(async (tx) => {
      await tx`set local lock_timeout='3s'`;
      await tx`set local statement_timeout='10s'`;
      return fn(tx);
    })) as T;
  }
  return {
    async inspect(staffAfter: string | null = null) {
      if (staffAfter !== null && (staffAfter.length < 1 || staffAfter.length > 160))
        throw new ProvisionFailure('invalid-input');
      return transaction(async (tx) => {
        const target = await assertBinding(tx);
        if (!target) throw new ProvisionFailure('identity-mismatch');
        const connections = profiles.length
          ? await tx`select c.id,c.label,c.namespace,c.account_id,c.platform,c.capability,c.revision::text,c.enabled,c.verified_at,
          coalesce((select jsonb_agg(g.user_id order by g.user_id) from portal_marketing.connection_grants g where g.connection_id=c.id),'[]') as grants
          from portal_marketing.connections c where c.id in ${tx(profiles.map((p) => p.id))} order by c.id`
          : [];
        if (
          connections.some((c) => {
            const p = configured.get(c.id)!;
            return (
              c.namespace !== p.namespace ||
              c.account_id !== p.accountId ||
              c.platform !== p.platform ||
              c.capability !== p.capability
            );
          })
        )
          throw new ProvisionFailure('identity-mismatch');
        const staff =
          await tx`select s.user_id,s.revision::text,u.name,u.username from portal_access.staff_grants s join portal_identity.users u on u.id=s.user_id where s.active and 'manage_partners'=any(s.capabilities) and (${staffAfter}::text is null or s.user_id>${staffAfter}) order by s.user_id limit 501`;

        return {
          target,
          connections: profiles.map((p) => ({
            id: p.id,
            accountId: p.accountId,
            namespace: p.namespace,
            current: connections.find((c) => c.id === p.id) ?? null,
          })),
          eligibleStaff: staff.slice(0, 500),
          nextStaffCursor: staff.length > 500 ? staff[499].user_id : null,
        };
      });
    },
    async preview(raw: unknown) {
      const command = parseProvisionCommand(raw);
      return transaction(async (tx) => {
        const prepared = await prepare(tx, command);
        return prepared.prior
          ? {
              state: 'already-applied' as const,
              result: prepared.prior.result,
              planHash: prepared.prior.plan_hash,
            }
          : { state: 'preview' as const, plan: prepared.plan, planHash: prepared.planHash };
      });
    },
    async apply(raw: unknown, planHash: string) {
      const command = parseProvisionCommand(raw);
      if (!/^[a-f0-9]{64}$/.test(planHash)) throw new ProvisionFailure('invalid-input');
      return transaction(async (tx) => {
        // Global command ID first, then connection. Concurrent same-command replay is deterministic.
        await tx`select pg_advisory_xact_lock(hashtextextended(${'marketing-provision-command:' + command.commandId},0))`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${'marketing-provision-connection:' + command.connectionId},0))`;
        const prepared = await prepare(tx, command);
        if (prepared.prior) {
          if (prepared.prior.plan_hash !== planHash) throw new ProvisionFailure('stale-plan');
          return { state: 'replayed' as const, result: prepared.prior.result };
        }
        if (prepared.planHash !== planHash) throw new ProvisionFailure('stale-plan');
        const { plan, requestHash } = prepared,
          profile = configured.get(command.connectionId)!;
        if (plan.changes.create)
          await tx`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label) values(${profile.id},${profile.namespace},${profile.platform},${profile.capability},${profile.accountId},${command.label})`;
        else if (
          plan.before?.label !== command.label ||
          plan.changes.grantUserIds.length ||
          plan.changes.revokeUserIds.length
        )
          await tx`update portal_marketing.connections set label=${command.label} where id=${profile.id}`;
        for (const id of plan.changes.grantUserIds)
          await tx`insert into portal_marketing.connection_grants(connection_id,user_id) values(${profile.id},${id})`;
        if (plan.changes.revokeUserIds.length)
          await tx`delete from portal_marketing.connection_grants where connection_id=${profile.id} and user_id in ${tx(plan.changes.revokeUserIds)}`;
        const [row] =
          await tx`select revision::text,enabled from portal_marketing.connections where id=${profile.id}`;
        const result = {
          commandId: command.commandId,
          connectionId: profile.id,
          revision: row.revision,
          enabled: row.enabled,
          granted: plan.changes.grantUserIds.length,
          revoked: plan.changes.revokeUserIds.length,
        };
        await tx`insert into portal_marketing.provision_commands(id,connection_id,operator_ref,evidence_ref,request_hash,plan_hash,changes,result)
          values(${command.commandId},${profile.id},${command.operatorRef},${command.evidenceRef},${requestHash},${planHash},${JSON.stringify({ before: plan.before, applied: plan.changes })}::jsonb,${JSON.stringify(result)}::jsonb)`;
        return { state: 'applied' as const, result };
      });
    },
  };
}
