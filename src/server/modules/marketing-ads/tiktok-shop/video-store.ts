import { createVideoScanStore } from './video-scan-store';
import { createHash, randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';
import { advanceRevisions } from '@/server/platform/db/revisions';
import { SourceReadError } from '../source-error';
import { videoDailySchedule, videoFailurePolicy } from './video-schedule';
import {
  CompleteVideoCollection,
  ShopVideoConnection,
  ShopVideoPeriod,
  type VideoConnection,
  type VideoPeriod,
} from './video-contract';

export type VideoLease = {
  windowId: string;
  scheduled?: boolean;
  token: string;
  connection: VideoConnection;
  connectionRevision: string;
  period: VideoPeriod;
};
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SourceReadError('invalid-source');
  return parsed.data;
};
/** Worker-only authority. This is not callable with browser-provided shop identity or evidence. */
export function createShopVideoStore(
  sql: Sql,
  rawProfiles: readonly VideoConnection[],
  assertBinding: (tx: TransactionSql) => Promise<void>,
) {
  const profiles = new Map<string, VideoConnection>();
  for (const raw of rawProfiles) {
    const c = parse(ShopVideoConnection, raw);
    if (profiles.has(c.connectionId)) throw new SourceReadError('invalid-source');
    profiles.set(c.connectionId, c);
  }
  async function configured(tx: TransactionSql, id: string) {
    await assertBinding(tx);
    const profile = profiles.get(id);
    const [c] = await tx`select c.*,c.revision::text as version from portal_marketing.connections c
      where c.id=${id} and c.platform='tiktok' and c.capability='tiktok.shop_video' and c.enabled and c.verified_at is not null for share`;
    if (!profile || !c || c.namespace !== profile.namespace || c.account_id !== profile.shopId)
      throw new SourceReadError('access');
    return { profile, c };
  }
  async function lock(tx: TransactionSql, lease: VideoLease) {
    const current = await configured(tx, lease.connection.connectionId);
    if (
      current.c.version !== lease.connectionRevision ||
      JSON.stringify(current.profile) !== JSON.stringify(lease.connection)
    )
      throw new SourceReadError('access');
    // Always lock account before window, matching claim and avoiding cross-window races.
    const [runtime] =
      await tx`select * from portal_marketing.connection_runtime where connection_id=${lease.connection.connectionId}
      and lease_token=${lease.token} and lease_until>clock_timestamp() for update`;
    const [window] =
      await tx`select * from portal_marketing.video_windows where id=${lease.windowId}
      and connection_id=${lease.connection.connectionId} and connection_revision=${lease.connectionRevision}
      and period_from=${lease.period.from}::date and period_to=${lease.period.toExclusive}::date
      and timezone=${lease.connection.timezone} and lease_token=${lease.token} and lease_until>clock_timestamp() for update`;
    if (lease.scheduled) {
      const [schedule] = await tx`select 1 from portal_marketing.video_schedules
        where connection_id=${lease.connection.connectionId} and connection_revision=${lease.connectionRevision}
        and profile_hash=${createHash('sha256').update(JSON.stringify(lease.connection)).digest('hex')}
        and period_from<=${lease.period.from}::date and period_to>=${lease.period.toExclusive}::date`;
      if (!schedule) throw new SourceReadError('access');
    }
    if (!runtime || !window) throw new SourceReadError('access');
    return window;
  }
  async function clear(tx: TransactionSql, lease: VideoLease) {
    await tx`update portal_marketing.connection_runtime set lease_token=null,lease_until=null where connection_id=${lease.connection.connectionId} and lease_token=${lease.token}`;
    await tx`update portal_marketing.video_windows set lease_token=null,lease_until=null where id=${lease.windowId} and lease_token=${lease.token}`;
  }
  async function changed(tx: TransactionSql, connectionId: string) {
    const partners = await tx`select distinct t.partner_id from portal_marketing.video_mappings m
      join portal_marketing.targets t on t.id=m.target_id where m.connection_id=${connectionId} order by t.partner_id`;
    for (const row of partners) await advanceRevisions(tx, row.partner_id, ['metrics']);
  }
  async function claim(connectionId: string, rawPeriod?: VideoPeriod): Promise<VideoLease | null> {
    const explicit = rawPeriod ? parse(ShopVideoPeriod, rawPeriod) : null;
    if (explicit) {
      const days = (Date.parse(explicit.toExclusive) - Date.parse(explicit.from)) / 86400000;
      if (days < 1 || days > 31) throw new SourceReadError('invalid-source');
    }
    return sql.begin(async (tx) => {
      const { profile, c } = await configured(tx, connectionId);
      await tx`insert into portal_marketing.connection_runtime(connection_id) values(${connectionId}) on conflict do nothing`;
      const [runtime] =
        await tx`select *,lease_until>clock_timestamp() as leased,blocked_until>clock_timestamp() as blocked
        from portal_marketing.connection_runtime where connection_id=${connectionId} for update`;
      if (runtime.leased || runtime.blocked) return null;
      let window;
      if (explicit) {
        [window] =
          await tx`insert into portal_marketing.video_windows(id,connection_id,period_from,period_to,timezone,connection_revision)
          values(${randomUUID()},${connectionId},${explicit.from}::date,${explicit.toExclusive}::date,${profile.timezone},${c.version})
          on conflict(connection_id,period_from,period_to,timezone) do update set connection_revision=excluded.connection_revision
          returning id,period_from::text,period_to::text`;
      } else {
        // Only the active persisted horizon is eligible; historical data remains readable.
        [window] =
          await tx`select w.id,w.period_from::text,w.period_to::text from portal_marketing.video_windows w
          join portal_marketing.video_schedules s on s.connection_id=w.connection_id
          where w.connection_id=${connectionId} and s.connection_revision=${c.version}
            and s.profile_hash=${createHash('sha256').update(JSON.stringify(profile)).digest('hex')}
            and w.connection_revision=${c.version} and w.timezone=s.timezone
            and w.period_from>=s.period_from and w.period_to<=s.period_to and w.period_to-w.period_from=1
            and not exists(select 1 from portal_marketing.video_windows held
              where held.connection_id=w.connection_id and held.connection_revision=${c.version}
                and held.retry_paused and held.issue in ('access','invalid-source'))
            and not exists(select 1 from portal_marketing.video_scans scan
              join portal_marketing.video_windows active on active.id=scan.window_id
              where scan.connection_id=w.connection_id and scan.window_id<>w.id
                and scan.connection_revision=${c.version}
                and scan.profile_hash=${createHash('sha256').update(JSON.stringify(profile)).digest('hex')}
                and active.timezone=s.timezone and active.period_from>=s.period_from and active.period_to<=s.period_to)
            and not w.retry_paused and w.next_attempt_at<=clock_timestamp()
            and (w.lease_until is null or w.lease_until<=clock_timestamp())
          order by w.next_attempt_at,w.period_from desc,w.id limit 1 for update of w`;
      }
      if (!window) return null;
      if (!explicit)
        await tx`update portal_marketing.video_schedules set last_claimed_at=clock_timestamp() where connection_id=${connectionId}`;
      const token = randomUUID();
      await tx`update portal_marketing.connection_runtime set lease_token=${token},lease_until=clock_timestamp()+interval '90 seconds' where connection_id=${connectionId}`;
      await tx`update portal_marketing.video_windows set state='running',issue=null,lease_token=${token},lease_until=clock_timestamp()+interval '90 seconds'
        where id=${window.id}`;
      return {
        windowId: window.id,
        scheduled: !explicit,
        token,
        connection: profile,
        connectionRevision: c.version,
        period: { from: window.period_from, toExclusive: window.period_to },
      };
    });
  }
  return {
    pages: createVideoScanStore(sql, { lock, clear, changed }),
    /** Explicit diagnostic acquisition. Automatic workers use claimDue, never this bypass. */
    claim: (connectionId: string, period: VideoPeriod) => claim(connectionId, period),
    claimDue: (connectionId: string) => claim(connectionId),
    async orderConnections(ids: readonly string[]) {
      if (
        ids.length > 100 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !profiles.has(id))
      )
        throw new SourceReadError('invalid-source');
      if (!ids.length) return [];
      return sql.begin(async (tx) => {
        await assertBinding(tx);
        const rows = await tx`select c.id from portal_marketing.connections c
          left join portal_marketing.video_schedules s on s.connection_id=c.id
          where c.id in ${tx([...ids])} and c.enabled and c.verified_at is not null
            and c.platform='tiktok' and c.capability='tiktok.shop_video'
          order by s.last_claimed_at nulls first,c.id`;
        return rows.map((r) => r.id as string);
      });
    },
    async plan(connectionId: string, asOf = Date.now(), policy: unknown = {}) {
      const profile = profiles.get(connectionId);
      if (!profile) throw new SourceReadError('access');
      const plan = videoDailySchedule(profile.timezone, asOf, policy);
      const hash = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
      return sql.begin(async (tx) => {
        const { c } = await configured(tx, connectionId);
        await tx`insert into portal_marketing.connection_runtime(connection_id) values(${connectionId}) on conflict do nothing`;
        await tx`select connection_id from portal_marketing.connection_runtime where connection_id=${connectionId} for update`;
        const [previous] =
          await tx`select *,plan_as_of>${new Date(asOf).toISOString()}::timestamptz as newer
          from portal_marketing.video_schedules where connection_id=${connectionId} for update`;
        if (previous?.newer) return { planned: 0, superseded: true };
        const reset = !!previous && previous.connection_revision.toString() !== c.version;
        const reschedule = reset || (!!previous && previous.profile_hash !== hash);
        await tx`insert into portal_marketing.video_schedules(connection_id,period_from,period_to,timezone,connection_revision,profile_hash,plan_as_of)
          values(${connectionId},${plan.from}::date,${plan.toExclusive}::date,${profile.timezone},${c.version},${hash},${new Date(asOf).toISOString()}::timestamptz)
          on conflict(connection_id) do update set period_from=excluded.period_from,period_to=excluded.period_to,timezone=excluded.timezone,
          connection_revision=excluded.connection_revision,profile_hash=excluded.profile_hash,plan_as_of=excluded.plan_as_of`;
        const rows = plan.windows.map(({ period, refreshSeconds }) => ({
          id: randomUUID(),
          connection_id: connectionId,
          period_from: period.from,
          period_to: period.toExclusive,
          timezone: profile.timezone,
          connection_revision: c.version,
          refresh_seconds: refreshSeconds,
        }));
        await tx`insert into portal_marketing.video_windows ${tx(rows, 'id', 'connection_id', 'period_from', 'period_to', 'timezone', 'connection_revision', 'refresh_seconds')}
          on conflict(connection_id,period_from,period_to,timezone) do update set refresh_seconds=excluded.refresh_seconds,
            connection_revision=excluded.connection_revision,
            retry_paused=case when ${reset} then false else video_windows.retry_paused end,
            attempt_count=case when ${reset} then 0 else video_windows.attempt_count end,
            next_attempt_at=case when ${reschedule} then clock_timestamp() else video_windows.next_attempt_at end`;
        return { planned: rows.length, superseded: false };
      });
    },
    async publish(lease: VideoLease, input: unknown) {
      const collection = parse(CompleteVideoCollection, input);
      if (
        JSON.stringify(collection.connection) !== JSON.stringify(lease.connection) ||
        JSON.stringify(collection.period) !== JSON.stringify(lease.period)
      )
        throw new SourceReadError('invalid-source');
      const hash = createHash('sha256').update(JSON.stringify(collection)).digest('hex');
      return sql.begin(async (tx) => {
        const current = await configured(tx, lease.connection.connectionId);
        if (current.c.version !== lease.connectionRevision) throw new SourceReadError('access');
        // Serialize retries even after the lease has been cleared by the first publisher.
        await tx`select pg_advisory_xact_lock(hashtextextended(${lease.token},0))`;
        const [prior] =
          await tx`select id,report_hash,window_id from portal_marketing.video_generations where lease_token=${lease.token}`;
        if (prior) {
          if (prior.report_hash !== hash || prior.window_id !== lease.windowId)
            throw new SourceReadError('invalid-source');
          return { generationId: prior.id as string, replayed: true };
        }
        await lock(tx, lease);
        const [clock] =
          await tx`select ${collection.fetchedAt}::timestamptz<=clock_timestamp() as valid`;
        if (!clock.valid) throw new SourceReadError('invalid-source');
        const generationId = randomUUID(),
          { videos, ...metadata } = collection;
        await tx`insert into portal_marketing.video_generations(id,window_id,lease_token,connection_revision,report_hash,metadata)
          values(${generationId},${lease.windowId},${lease.token},${lease.connectionRevision},${hash},${JSON.stringify(metadata)}::text::jsonb)`;
        if (videos.length) {
          // Same representation on standalone workers and Drizzle-shared clients.
          await tx`insert into portal_marketing.video_observations(generation_id,video_id,creator_id,observation)
            select ${generationId},v->>'videoId',v->'creator'->>'openId',v
            from jsonb_array_elements(${JSON.stringify(videos)}::text::jsonb) as v`;
        }
        await tx`update portal_marketing.video_windows set current_generation=${generationId},state='ready',issue=null,last_success_at=clock_timestamp(),
          attempt_count=0,retry_paused=false,next_attempt_at=clock_timestamp()+refresh_seconds*interval '1 second' where id=${lease.windowId}`;
        // A diagnostic whole-shop publish supersedes unfinished pages for this window.
        await tx`delete from portal_marketing.video_scans where window_id=${lease.windowId}`;
        await clear(tx, lease);
        await changed(tx, lease.connection.connectionId);
        return { generationId, replayed: false };
      });
    },
    async fail(
      lease: VideoLease,
      reason:
        'source-not-ready' | 'page-limit' | 'access' | 'temporary' | 'throttled' | 'invalid-source',
      retryAfterMs = 0,
    ) {
      if (
        ![
          'source-not-ready',
          'page-limit',
          'access',
          'temporary',
          'throttled',
          'invalid-source',
        ].includes(reason) ||
        !Number.isSafeInteger(retryAfterMs) ||
        retryAfterMs < 0
      )
        throw new SourceReadError('invalid-source');
      await sql.begin(async (tx) => {
        const window = await lock(tx, lease);
        const attempts = Math.min(30, window.attempt_count + 1);
        const retry = videoFailurePolicy(reason, attempts, retryAfterMs);
        await tx`update portal_marketing.video_windows set state='needs-attention',issue=${reason},attempt_count=${attempts},
          retry_paused=${retry.paused},next_attempt_at=clock_timestamp()+${retry.delayMs}*interval '1 millisecond' where id=${lease.windowId}`;
        if (retryAfterMs)
          await tx`update portal_marketing.connection_runtime set blocked_until=greatest(blocked_until,clock_timestamp()+${retryAfterMs}*interval '1 millisecond') where connection_id=${lease.connection.connectionId}`;
        await clear(tx, lease);
        await changed(tx, lease.connection.connectionId);
      });
    },
  };
}
