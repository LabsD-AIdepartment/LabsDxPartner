import { createHash, randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';
import { Id } from '@/contracts/common';
import { SourceIdentityV2 } from '@/contracts/platform-capabilities';
import { SourcePeriod, SourceReportV2 } from '@/contracts/platform-metrics';
import { advanceRevisions } from '@/server/platform/db/revisions';

export const ReportDefinition = z.strictObject({
  apiVersion: Id,
  reportDefinition: Id,
  attribution: Id,
  actionReportTime: Id,
});
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
}
const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
export type SyncIssue =
  'temporary' | 'throttled' | 'access' | 'not-found' | 'invalid-source' | 'incomplete';
export type SyncLease = {
  windowId: string;
  jobId: string;
  token: string;
  connectionId: string;
  connectionRevision: string;
  targetRevision: string;
  mappingRevision: string;
  partnerId: string;
  attempt: number;
  creativeIds: string[];
  identity: z.infer<typeof SourceIdentityV2>;
  period: z.infer<typeof SourcePeriod>;
  definition: z.infer<typeof ReportDefinition>;
};
export class SyncSuperseded extends Error {
  constructor() {
    super('Sync lease is no longer current');
  }
}
const seconds = (value: number, min: number, max: number) =>
  z.number().int().min(min).max(max).parse(value);
async function limits(tx: TransactionSql) {
  await tx`set local lock_timeout='3s'`;
  await tx`set local statement_timeout='10s'`;
}
async function binding(tx: TransactionSql, jobId: string) {
  const [r] =
    await tx`select a.source_identity,a.creative_ids,a.mapping_revision::text,a.partner_id,
      c.id as connection_id,c.revision::text as connection_revision,t.revision::text as target_revision
    from portal_marketing.sync_jobs j
    join portal_marketing.associations a on a.id=j.association_id and a.mapping_revision=j.mapping_revision
    join portal_marketing.connections c on c.id=a.connection_id
    join portal_marketing.targets t on t.id=a.target_id
    join portal_access.partners p on p.id=a.partner_id
    join portal_content.clips cl on cl.partner_id=a.partner_id and cl.id=a.clip_id
    where j.id=${jobId} and c.enabled and c.verified_at is not null and t.active
      and p.status='active' and not cl.removed
    for share of c,t,p,cl`;
  if (!r) throw new SyncSuperseded();
  return r;
}
async function summarize(tx: TransactionSql, jobId: string) {
  await tx`update portal_marketing.sync_jobs j set
    state=s.state,attempt=coalesce(s.attempt,0),next_run_at=coalesce(s.next_run_at,clock_timestamp()),issue=s.issue,
    last_success_at=(select max(last_success_at) from portal_marketing.report_windows where job_id=j.id),lease_token=null,lease_until=null,data_through=null
    from (select case when bool_or(w.state='running') then 'running'
      when bool_or(w.state='needs-attention') then 'needs-attention'
      when bool_or(w.state='queued') then 'queued' else 'ready' end as state,
      max(w.attempt) as attempt,min(w.next_run_at) as next_run_at,max(w.issue) as issue
      from portal_marketing.report_windows w join portal_marketing.sync_jobs owner on owner.id=w.job_id
      where w.job_id=${jobId} and (owner.refresh_from is null or w.period_to>owner.refresh_from)) s where j.id=${jobId}`;
}

/** Trusted server orchestration only. No HTTP entrypoint, credentials or financial writes. */
export function createMarketingSyncStore(
  sql: Sql,
  options: { leaseSeconds?: number; refreshSeconds?: number } = {},
) {
  const leaseSeconds = seconds(options.leaseSeconds ?? 120, 30, 600);
  const refreshSeconds = seconds(options.refreshSeconds ?? 900, 60, 86400);
  return {
    /** Atomically replace the recurring horizon. Stored generations are never retired or deleted. */
    async plan(
      jobId: string,
      rawWindows: unknown,
      rawDefinition: unknown,
      asOf: number,
      signal?: AbortSignal,
    ) {
      z.uuid().parse(jobId);
      z.number().finite().parse(asOf);
      const windows = z
        .array(
          z.strictObject({
            period: SourcePeriod,
            refreshSeconds: z.number().int().min(60).max(86400),
          }),
        )
        .min(1)
        .max(366)
        .parse(rawWindows);
      const definition = ReportDefinition.parse(rawDefinition),
        definitionHash = hash(definition);
      const sorted = [...windows].sort(
        (a, b) => Date.parse(a.period.from) - Date.parse(b.period.from),
      );
      if (
        sorted.some(
          (w, i) =>
            w.period.timezone !== sorted[0].period.timezone ||
            (i > 0 && Date.parse(sorted[i - 1].period.toExclusive) !== Date.parse(w.period.from)),
        )
      )
        throw new Error('Plan windows must be contiguous in one reporting timezone');
      signal?.throwIfAborted();
      return sql.begin(async (tx) => {
        await limits(tx);
        const [owner] =
          await tx`select a.connection_id from portal_marketing.sync_jobs j join portal_marketing.associations a on a.id=j.association_id where j.id=${jobId}`;
        if (!owner) throw new SyncSuperseded();
        await tx`insert into portal_marketing.connection_runtime(connection_id) values(${owner.connection_id}) on conflict do nothing`;
        // Match worker account -> window/job serialization; never hold these locks across source I/O.
        await tx`select connection_id from portal_marketing.connection_runtime where connection_id=${owner.connection_id} for update`;
        const b = await binding(tx, jobId);
        const [job] =
          await tx`select plan_as_of,refresh_from from portal_marketing.sync_jobs where id=${jobId} for update`;
        if (job.plan_as_of && new Date(job.plan_as_of).getTime() >= asOf) return 0;
        const rows = windows.map((w) => ({
          id: randomUUID(),
          period_from: w.period.from,
          period_to: w.period.toExclusive,
          timezone: w.period.timezone,
          refresh_seconds: w.refreshSeconds,
        }));
        await tx`insert into portal_marketing.report_windows(id,job_id,period_from,period_to,timezone,definition,definition_hash,refresh_seconds)
          select x.id,${jobId},x.period_from,x.period_to,x.timezone,${JSON.stringify(definition)}::jsonb,${definitionHash},x.refresh_seconds
          from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(id uuid,period_from timestamptz,period_to timestamptz,timezone text,refresh_seconds integer)
          on conflict(job_id,period_from,period_to,timezone,definition_hash) do update set refresh_seconds=excluded.refresh_seconds`;
        await tx`update portal_marketing.sync_jobs set refresh_from=${sorted[0].period.from},plan_as_of=${new Date(asOf).toISOString()},last_planned_at=clock_timestamp() where id=${jobId}`;
        await summarize(tx, jobId);
        if (
          !job.refresh_from ||
          new Date(job.refresh_from).getTime() !== Date.parse(sorted[0].period.from)
        )
          await advanceRevisions(tx, b.partner_id, ['metrics']);
        signal?.throwIfAborted();
        return windows.length;
      });
    },
    async schedule(
      jobId: string,
      rawPeriod: unknown,
      rawDefinition: unknown,
      cadence = refreshSeconds,
    ) {
      seconds(cadence, 60, 86400);
      z.uuid().parse(jobId);
      const period = SourcePeriod.parse(rawPeriod),
        definition = ReportDefinition.parse(rawDefinition);
      return sql.begin(async (tx) => {
        await limits(tx);
        const b = await binding(tx, jobId);
        await tx`insert into portal_marketing.connection_runtime(connection_id) values(${b.connection_id}) on conflict do nothing`;
        const id = randomUUID();
        await tx`insert into portal_marketing.report_windows(id,job_id,period_from,period_to,timezone,definition,definition_hash,refresh_seconds)
          values(${id},${jobId},${period.from},${period.toExclusive},${period.timezone},${JSON.stringify(definition)}::jsonb,${hash(definition)},${cadence})
          on conflict(job_id,period_from,period_to,timezone,definition_hash) do update set refresh_seconds=excluded.refresh_seconds`;
        const [row] = await tx`select id from portal_marketing.report_windows where job_id=${jobId}
          and period_from=${period.from}::timestamptz and period_to=${period.toExclusive}::timestamptz
          and timezone=${period.timezone} and definition_hash=${hash(definition)}`;
        await summarize(tx, jobId);
        return String(row.id);
      });
    },
    /** Only worker-configured connections are eligible. One in-flight report per account. */
    async claim(rawConnections: readonly string[]): Promise<SyncLease | null> {
      const connections = z.array(Id).max(100).parse(rawConnections);
      if (!connections.length) return null;
      return sql.begin(async (tx) => {
        await limits(tx);
        const [account] = await tx`select r.connection_id from portal_marketing.connection_runtime r
          where r.connection_id in ${tx(connections)} and r.blocked_until<=clock_timestamp()
            and (r.lease_until is null or r.lease_until<=clock_timestamp())
            and exists(select 1 from portal_marketing.report_windows w
              join portal_marketing.sync_jobs j on j.id=w.job_id
              join portal_marketing.associations a on a.id=j.association_id
              join portal_marketing.connections c on c.id=a.connection_id
              join portal_marketing.targets t on t.id=a.target_id
              join portal_access.partners p on p.id=a.partner_id
              join portal_content.clips cl on cl.partner_id=a.partner_id and cl.id=a.clip_id
              where a.connection_id=r.connection_id and c.enabled and t.active and p.status='active' and not cl.removed
                and (j.refresh_from is null or w.period_to>j.refresh_from)
                and w.next_run_at<=clock_timestamp() and (w.lease_until is null or w.lease_until<=clock_timestamp())
                and w.state<>'needs-attention')
          order by r.last_claimed_at nulls first,r.connection_id for update of r skip locked limit 1`;
        if (!account) return null;
        const [w] = await tx`select w.* from portal_marketing.report_windows w
          join portal_marketing.sync_jobs j on j.id=w.job_id
          join portal_marketing.associations a on a.id=j.association_id
          join portal_marketing.targets t on t.id=a.target_id
          join portal_access.partners p on p.id=a.partner_id
          join portal_content.clips cl on cl.partner_id=a.partner_id and cl.id=a.clip_id
          where a.connection_id=${account.connection_id} and t.active and p.status='active' and not cl.removed
            and (j.refresh_from is null or w.period_to>j.refresh_from)
                and w.next_run_at<=clock_timestamp() and (w.lease_until is null or w.lease_until<=clock_timestamp())
            and w.state<>'needs-attention'
          order by (w.period_to>clock_timestamp()-interval '7 days') desc,w.period_to desc,w.next_run_at,w.id
          for update of w skip locked limit 1`;
        if (!w) return null;
        const b = await binding(tx, w.job_id),
          token = randomUUID();
        await tx`update portal_marketing.connection_runtime set last_claimed_at=clock_timestamp(),lease_token=${token},lease_until=clock_timestamp()+${leaseSeconds}*interval '1 second' where connection_id=${account.connection_id}`;
        await tx`update portal_marketing.report_windows set state='running',attempt=attempt+1,issue=null,
          lease_token=${token},lease_until=clock_timestamp()+${leaseSeconds}*interval '1 second' where id=${w.id}`;
        await summarize(tx, w.job_id);
        return {
          windowId: String(w.id),
          jobId: String(w.job_id),
          token,
          connectionId: String(b.connection_id),
          connectionRevision: b.connection_revision,
          targetRevision: b.target_revision,
          mappingRevision: b.mapping_revision,
          partnerId: String(b.partner_id),
          attempt: w.attempt + 1,
          creativeIds: z.array(Id).length(1).parse(b.creative_ids),
          identity: SourceIdentityV2.parse(b.source_identity),
          period: SourcePeriod.parse({
            from: new Date(w.period_from).toISOString(),
            toExclusive: new Date(w.period_to).toISOString(),
            timezone: w.timezone,
          }),
          definition: ReportDefinition.parse(w.definition),
        };
      });
    },
    async publish(lease: SyncLease, raw: unknown) {
      const report = SourceReportV2.parse(raw);
      if (
        report.completeness !== 'complete' ||
        hash(report.identity) !== hash(lease.identity) ||
        Date.parse(report.period.from) !== Date.parse(lease.period.from) ||
        Date.parse(report.period.toExclusive) !== Date.parse(lease.period.toExclusive) ||
        report.period.timezone !== lease.period.timezone ||
        Object.entries(lease.definition).some(([k, v]) => report[k as keyof typeof report] !== v)
      )
        throw new Error('Report does not match leased scope');
      return sql.begin(async (tx) => {
        await limits(tx);
        // Same account -> window lock order as claim; source changes are locked through commit.
        const [account] =
          await tx`select * from portal_marketing.connection_runtime where connection_id=${lease.connectionId}
          and lease_token=${lease.token} and lease_until>clock_timestamp() for update`;
        const [w] =
          await tx`select * from portal_marketing.report_windows where id=${lease.windowId}
          and lease_token=${lease.token} and lease_until>clock_timestamp() for update`;
        if (!account || !w) throw new SyncSuperseded();
        const b = await binding(tx, w.job_id);
        if (
          b.connection_revision !== lease.connectionRevision ||
          b.target_revision !== lease.targetRevision ||
          b.mapping_revision !== lease.mappingRevision ||
          hash(b.source_identity) !== hash(lease.identity) ||
          w.job_id !== lease.jobId ||
          hash(w.definition) !== hash(lease.definition) ||
          new Date(w.period_from).getTime() !== Date.parse(lease.period.from) ||
          new Date(w.period_to).getTime() !== Date.parse(lease.period.toExclusive) ||
          w.timezone !== lease.period.timezone
        )
          throw new SyncSuperseded();
        const id = randomUUID();
        await tx`insert into portal_marketing.report_generations(id,window_id,report,report_sha256)
          values(${id},${w.id},${JSON.stringify(report)}::jsonb,${hash(report)})`;
        const updated =
          await tx`update portal_marketing.report_windows set current_generation=${id},state='ready',attempt=0,issue=null,
          last_success_at=clock_timestamp(),next_run_at=clock_timestamp()+refresh_seconds*interval '1 second',lease_token=null,lease_until=null
          where id=${w.id} and lease_until>clock_timestamp() returning id`;
        if (!updated.length) throw new SyncSuperseded();
        await tx`update portal_marketing.connection_runtime set lease_token=null,lease_until=null where connection_id=${lease.connectionId} and lease_token=${lease.token}`;
        await summarize(tx, lease.jobId);
        await advanceRevisions(tx, b.partner_id, ['metrics']);
        return id;
      });
    },
    async fail(lease: SyncLease, issue: SyncIssue, retryAfterMs = 0) {
      const code = z
        .enum(['temporary', 'throttled', 'access', 'not-found', 'invalid-source', 'incomplete'])
        .parse(issue);
      const delay = Math.max(
        60_000,
        Math.min(7 * 86400_000, Number.isFinite(retryAfterMs) ? retryAfterMs : 0),
        Math.min(3600_000, 60_000 * 2 ** Math.min(lease.attempt - 1, 6)),
      );
      const attention =
        ['access', 'not-found', 'invalid-source'].includes(code) || lease.attempt >= 8;
      return sql.begin(async (tx) => {
        await limits(tx);
        const [account] =
          await tx`select * from portal_marketing.connection_runtime where connection_id=${lease.connectionId}
          and lease_token=${lease.token} and lease_until>clock_timestamp() for update`;
        if (!account) return false;
        const updated =
          await tx`update portal_marketing.report_windows set state=${attention ? 'needs-attention' : 'queued'},issue=${code},
          next_run_at=clock_timestamp()+${delay}*interval '1 millisecond',lease_token=null,lease_until=null
          where id=${lease.windowId} and lease_token=${lease.token} and lease_until>clock_timestamp() returning id`;
        if (!updated.length) return false;
        await tx`update portal_marketing.connection_runtime set lease_token=null,lease_until=null,
          blocked_until=case when ${code === 'throttled'} then greatest(blocked_until,clock_timestamp()+${delay}*interval '1 millisecond') else blocked_until end
          where connection_id=${lease.connectionId} and lease_token=${lease.token}`;
        await summarize(tx, lease.jobId);
        const [owner] = await tx`select a.partner_id from portal_marketing.report_windows w
          join portal_marketing.sync_jobs j on j.id=w.job_id join portal_marketing.associations a on a.id=j.association_id where w.id=${lease.windowId}`;
        if (owner) await advanceRevisions(tx, owner.partner_id, ['metrics']);
        return true;
      });
    },
  };
}
