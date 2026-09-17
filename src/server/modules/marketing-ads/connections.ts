import { z } from 'zod';
import { advanceRevisions } from '@/server/platform/db/revisions';
import type { TransactionSql } from 'postgres';
import {
  ConnectionCommand,
  ConnectionResult,
  ConnectionsSnapshot,
  VerifiedAccount,
} from '@/contracts/marketing-connections';
import { RegistrationScope, type RegistrationScopeValue } from '@/contracts/ad-registration';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash } from '@/server/modules/access/command-audit';
import type { createFacebookAccountVerifier } from './facebook/verify-account';
const parse = <T>(schema: z.ZodType<T>, input: unknown) => {
  const r = schema.safeParse(input);
  if (!r.success) throw new AccessFailure('invalid_input');
  return r.data;
};
type Actor = { userId: string; revision: string };
const assertActor = (a: Actor, s: RegistrationScopeValue) => {
  if (a.userId !== s.actorId || a.revision !== s.permissionRevision)
    throw new AccessFailure('forbidden');
};
// Read and retry share the same active job boundary (aliases j/a in each statement).
const activeJob = (tx: TransactionSql) => tx`j.mapping_revision=a.mapping_revision and exists(
  select 1 from portal_marketing.targets t
  join portal_access.partners p on p.id=a.partner_id and p.status='active'
  join portal_content.clips cl on cl.partner_id=a.partner_id and cl.id=a.clip_id and not cl.removed
  where t.id=a.target_id and t.active)`;
async function granted(tx: TransactionSql, actorId: string, id: string) {
  const [c] = await tx`select c.*,c.revision::text as version from portal_marketing.connections c
    join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actorId} where c.id=${id} and c.capability='facebook.ad_insights' for share of c,g`;
  if (!c) throw new AccessFailure('forbidden');
  return c;
}
export function createMarketingConnections(
  access: ReturnType<typeof createPartnerAccess>,
  verifier: ReturnType<typeof createFacebookAccountVerifier>,
) {
  return {
    async read(headers: Headers, input: unknown) {
      const scope = parse(RegistrationScope, input);
      return access.withStaffCapability(headers, 'manage_partners', false, async (tx, actor) => {
        assertActor(actor, scope);
        const rows =
          await tx`select c.*,c.revision::text as version,s.jobs,s.attention,s.last_success_at from portal_marketing.connections c
          join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actor.userId}
          left join lateral(select count(*)::int as jobs,count(*) filter(where j.state='needs-attention')::int as attention,max(j.last_success_at) as last_success_at
            from portal_marketing.associations a join portal_marketing.sync_jobs j
              on j.association_id=a.id
            where a.connection_id=c.id and ${activeJob(tx)}) s on true
          where c.capability='facebook.ad_insights' order by c.label,c.id limit 101`;
        if (rows.length > 100) throw new AccessFailure('conflict');
        return ConnectionsSnapshot.parse({
          ...scope,
          connections: rows.map((c) => ({
            id: c.id,
            label: c.label,
            platform: c.platform,
            accountId: c.account_id,
            revision: c.version,
            enabled: c.enabled,
            configured: (() => {
              const p = verifier.configured(c.id);
              return !!p && p.namespace === c.namespace && p.accountId === c.account_id;
            })(),
            verifiedAt: c.verified_at ? new Date(c.verified_at).toISOString() : null,
            jobs: c.jobs,
            attention: c.attention,
            lastSuccessAt: c.last_success_at ? new Date(c.last_success_at).toISOString() : null,
          })),
        });
      });
    },
    async command(headers: Headers, input: unknown, signal: AbortSignal) {
      const cmd = parse(ConnectionCommand, input),
        hash = commandHash('connection:' + cmd.action, cmd);
      const prepare = () =>
        access.withStaffCapability(headers, 'manage_partners', true, async (tx, actor) => {
          assertActor(actor, cmd);
          const c = await granted(tx, actor.userId, cmd.connectionId);
          const [prior] =
            await tx`select request_hash,result from portal_marketing.connection_commands where actor_id=${actor.userId} and id=${cmd.idempotencyKey}`;
          if (prior) {
            if (prior.request_hash !== hash) throw new AccessFailure('conflict');
            return { prior: ConnectionResult.parse({ ...prior.result, replayed: true }) };
          }
          if (c.version !== cmd.revision) throw new AccessFailure('conflict');
          const p = verifier.configured(c.id);
          if (
            cmd.action === 'verify' &&
            (!p || p.namespace !== c.namespace || p.accountId !== c.account_id)
          )
            throw new AccessFailure('forbidden');
          return { prior: null };
        });
      const prepared = await prepare();
      if (prepared.prior) return prepared.prior;
      const proof =
        cmd.action === 'verify'
          ? VerifiedAccount.parse(await verifier.verify(cmd.connectionId, signal))
          : null;
      signal.throwIfAborted();
      return access.withStaffCapability(headers, 'manage_partners', true, async (tx, actor) => {
        assertActor(actor, cmd);
        const c = await granted(tx, actor.userId, cmd.connectionId);
        const [prior] =
          await tx`select request_hash,result from portal_marketing.connection_commands where actor_id=${actor.userId} and id=${cmd.idempotencyKey}`;
        if (prior) {
          if (prior.request_hash !== hash) throw new AccessFailure('conflict');
          return ConnectionResult.parse({ ...prior.result, replayed: true });
        }
        if (c.version !== cmd.revision) throw new AccessFailure('conflict');
        if (proof) {
          if (proof.accountId !== c.account_id) throw new AccessFailure('conflict');
          await tx`update portal_marketing.connections set enabled=true,verified_at=${proof.checkedAt},verification=${JSON.stringify(proof)}::jsonb where id=${c.id}`;
        } else if (cmd.action === 'pause')
          await tx`update portal_marketing.connections set enabled=false where id=${c.id}`;
        else {
          if (!c.enabled || !c.verified_at) throw new AccessFailure('conflict');
          // Only terminal failed windows. Preserve active worker leases and quota cooldowns.
          await tx`update portal_marketing.report_windows w set state='queued',attempt=0,issue=null,next_run_at=clock_timestamp()
            from portal_marketing.sync_jobs j,portal_marketing.associations a
            where w.job_id=j.id and j.association_id=a.id and a.connection_id=${c.id} and w.state='needs-attention' and w.lease_token is null
              and ${activeJob(tx)} and (j.refresh_from is null or w.period_to>j.refresh_from)`;
          await tx`update portal_marketing.sync_jobs j set state='queued',attempt=0,issue=null,next_run_at=clock_timestamp(),last_planned_at=null
            from portal_marketing.associations a where j.association_id=a.id and a.connection_id=${c.id}
              and ${activeJob(tx)} and j.state='needs-attention'`;
        }
        const [current] =
          await tx`select enabled,revision::text from portal_marketing.connections where id=${c.id}`;
        const partners =
          await tx`select distinct partner_id from portal_marketing.associations where connection_id=${c.id} order by partner_id`;
        for (const p of partners) await advanceRevisions(tx, p.partner_id, ['metrics']);
        const result = ConnectionResult.parse({
          connectionId: c.id,
          revision: current.revision,
          enabled: current.enabled,
          replayed: false,
        });
        await tx`insert into portal_marketing.connection_commands(id,actor_id,connection_id,action,request_hash,result)
          values(${cmd.idempotencyKey},${actor.userId},${c.id},${cmd.action},${hash},${JSON.stringify(result)}::jsonb)`;
        return result;
      });
    },
  };
}
