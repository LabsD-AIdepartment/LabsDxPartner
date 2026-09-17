import { ImportActivityQuery, ImportActivitySnapshot } from '@/contracts/import-activity';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';

/** Persisted planned work only; this read neither acquires jobs nor calls a provider. */
export function createImportActivityReader(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const parsed = ImportActivityQuery.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const scope = parsed.data;
    return access.withStaffCapability(headers, 'manage_partners', false, async (tx, actor) => {
      if (actor.userId !== scope.actorId || actor.revision !== scope.permissionRevision)
        throw new AccessFailure('forbidden');
      const [clock] = await tx`select transaction_timestamp() as now`;
      const rows = await tx`with accounts as (
        select c.* from portal_marketing.connections c
        join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actor.userId}
        where c.platform=${scope.platform} and c.capability=case when ${scope.platform}='facebook' then 'facebook.ad_insights' else 'tiktok.shop_video' end
        order by c.id limit 101
      ), windows as (
        select c.id as connection_id,w.state,w.lease_until,w.next_run_at as next_at,
          (w.state='needs-attention') as held,w.current_generation,w.last_success_at,w.refresh_seconds
        from accounts c join portal_marketing.associations a on a.connection_id=c.id
        join portal_marketing.sync_jobs j on j.association_id=a.id and j.mapping_revision=a.mapping_revision
        join portal_marketing.report_windows w on w.job_id=j.id
        join portal_marketing.targets t on t.id=a.target_id and t.active
        join portal_access.partners p on p.id=a.partner_id and p.status='active'
        join portal_content.clips cl on cl.partner_id=a.partner_id and cl.id=a.clip_id and not cl.removed
        where c.platform='facebook' and (j.refresh_from is null or w.period_to>j.refresh_from)
        union all
        select c.id,w.state,w.lease_until,w.next_attempt_at,
          (w.retry_paused or exists(select 1 from portal_marketing.video_windows held
            where held.connection_id=c.id and held.connection_revision=c.revision
              and held.retry_paused and held.issue in ('access','invalid-source'))),
          case when exists(select 1 from portal_marketing.video_generations g
            where g.id=w.current_generation and g.window_id=w.id and g.connection_revision=c.revision)
            then w.current_generation else null end,w.last_success_at,w.refresh_seconds
        from accounts c join portal_marketing.video_schedules s on s.connection_id=c.id and s.connection_revision=c.revision
        join portal_marketing.video_windows w on w.connection_id=c.id and w.connection_revision=c.revision
          and w.timezone=s.timezone and w.period_from>=s.period_from and w.period_to<=s.period_to
          and w.period_to-w.period_from=1
        where c.platform='tiktok'
      ), planned as (
        select w.*,greatest(w.next_at,coalesce(r.blocked_until,'-infinity'),coalesce(q.blocked_until,'-infinity')) as eligible_at
        from windows w join accounts c on c.id=w.connection_id
        left join portal_marketing.connection_runtime r on r.connection_id=c.id
        left join lateral(select max(blocked_until) as blocked_until from portal_marketing.request_limits
          where c.platform='facebook' and bucket in ('facebook:app','facebook:connection:'||c.id)) q on true
      ), states as (
        select *,case when lease_until>${clock.now} then 'running' when held then 'attention'
          when eligible_at>${clock.now} then 'scheduled' else 'waiting' end as status from planned
      )
      select c.id,c.revision::text as revision,not(c.enabled and c.verified_at is not null) as paused,
        count(w.connection_id)::int as reports,
        count(*) filter(where w.status='running')::int as running,
        count(*) filter(where w.status='waiting')::int as waiting,
        count(*) filter(where w.status='scheduled')::int as scheduled,
        count(*) filter(where w.status='attention')::int as attention,
        min(w.eligible_at) filter(where w.status='waiting') as oldest_waiting_at,
        min(w.eligible_at) filter(where w.status='scheduled') as next_attempt_at,
        count(*) filter(where w.current_generation is not null and w.last_success_at is not null)::int as imported,
        count(*) filter(where w.current_generation is not null and w.last_success_at+ w.refresh_seconds*interval '1 second'<=${clock.now})::int as refresh_due,
        min(w.last_success_at) filter(where w.current_generation is not null) as oldest_success_at,
        max(w.last_success_at) filter(where w.current_generation is not null) as latest_success_at,
        min(w.last_success_at+w.refresh_seconds*interval '1 second') filter(where w.current_generation is not null
          and w.last_success_at+w.refresh_seconds*interval '1 second'<=${clock.now}) as oldest_refresh_due_at
      from accounts c left join states w on w.connection_id=c.id group by c.id,c.revision,c.enabled,c.verified_at order by c.id`;
      if (rows.length > 100) throw new AccessFailure('conflict');
      const instant = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
      return ImportActivitySnapshot.parse({
        ...scope,
        evaluatedAt: instant(clock.now),
        connections: rows.map((r) => ({
          connectionId: r.id,
          revision: r.revision,
          paused: r.paused,
          reports: r.reports,
          running: r.running,
          waiting: r.waiting,
          scheduled: r.scheduled,
          attention: r.attention,
          oldestWaitingAt: instant(r.oldest_waiting_at),
          nextAttemptAt: instant(r.next_attempt_at),
          freshness: {
            imported: r.imported,
            missing: r.reports - r.imported,
            refreshDue: r.refresh_due,
            oldestSuccessAt: instant(r.oldest_success_at),
            latestSuccessAt: instant(r.latest_success_at),
            oldestRefreshDueAt: instant(r.oldest_refresh_due_at),
          },
        })),
      });
    });
  };
}
