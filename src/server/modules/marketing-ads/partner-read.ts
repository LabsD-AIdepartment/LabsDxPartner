import { createHash, randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { z } from 'zod';
import { ContentHttpResponse, ContentQuery } from '@/contracts/content-http';
import { Instant } from '@/contracts/common';
import { AccessFailure } from '@/server/modules/partners/access';
import { earningsGeneration, instantSqlFormat as fmt } from '@/server/modules/earnings/publication';
import { celebSafeAdPerformance, projectPerformance } from './partner-performance';
import { SourceReportV2 } from '@/contracts/platform-metrics';
const Cursor = z.strictObject({
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  at: Instant,
  id: z.uuid(),
});
export class PartnerAdReadFailure extends Error {
  constructor(public code: 'not_found' | 'unavailable') {
    super(code);
  }
}
export const partnerAdsSql = `with clip as materialized (
  select id from portal_content.clips where partner_id=$1 and id=$2 and not removed and ($3::text is null or brand=$3)
), ads as materialized (
  select a.*,c.enabled,j.id as job_id,j.state as sync_state,j.refresh_from from portal_marketing.associations a
  join portal_marketing.targets t on t.id=a.target_id and t.active and t.partner_id=a.partner_id and t.clip_id=a.clip_id
  join portal_marketing.connections c on c.id=a.connection_id and c.namespace=a.namespace and c.account_id=a.account_id
  join portal_marketing.sync_jobs j on j.association_id=a.id and j.mapping_revision=a.mapping_revision
  where a.partner_id=$1 and a.clip_id=$2 and exists(select 1 from clip)
), batch as (
  select * from ads where ($4::text is null or id::text=$4) and ($5::timestamptz is null or (created_at,id)<($5::timestamptz,$6::uuid))
  order by created_at desc,id desc limit 51
) select exists(select 1 from clip) as has_clip,
  coalesce(s.statements,0)::text as statements_revision,coalesce(c.revision,0)::text as catalogue_revision,
  coalesce(m.earnings,0)::text as earnings_revision,coalesce(m.metrics,0)::text as metrics_revision,
  to_char(statement_timestamp() at time zone 'UTC',${fmt}) as as_of,
  (select count(*)::int from ads) as total,
  coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('created_at',to_char(b.created_at at time zone 'UTC',${fmt}),
    'reports',case when $4::text is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(x.payload),'[]') from (select jsonb_build_object('report',g.report,'state',w.state,
        'overdue',(b.refresh_from is null or w.period_to>b.refresh_from) and w.next_run_at < statement_timestamp()-interval '15 minutes') as payload
      from portal_marketing.report_windows w join portal_marketing.report_generations g on g.id=w.current_generation and g.window_id=w.id
      where w.job_id=b.job_id and w.period_from >= $7::timestamptz and w.period_to <= $8::timestamptz
      order by w.period_from,w.period_to,w.id limit 1001) x
    ) end) order by b.created_at desc,b.id desc) from batch b),'[]') as items
  from (values(1)) singleton(n)
  left join portal_statements.revisions s on s.partner_id=$1
  left join portal_content.catalogues c on c.partner_id=$1
  left join portal_meta.partner_changes m on m.partner_id=$1`;
export async function readPartnerAds(
  tx: TransactionSql,
  scope: { partnerId: string; permissionRevision: string; capabilities: readonly string[] },
  q: z.infer<typeof ContentQuery>,
) {
  let cursor: z.infer<typeof Cursor> | null = null;
  if (q.cursor) {
    try {
      cursor = Cursor.parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')));
    } catch {
      throw new AccessFailure('invalid_input');
    }
  }
  const period = {
    from: q.from + 'T00:00:00+07:00',
    toExclusive: q.toExclusive + 'T00:00:00+07:00',
    timezone: 'Asia/Bangkok' as const,
  };
  const [row] = await tx.unsafe(partnerAdsSql, [
    scope.partnerId,
    q.contentId!,
    q.brand ?? null,
    q.adId ?? null,
    cursor?.at ?? null,
    cursor?.id ?? null,
    period.from,
    period.toExclusive,
  ]);
  if (!row?.has_clip) throw new PartnerAdReadFailure('not_found');
  const generation = earningsGeneration(
    scope.partnerId,
    period.from,
    period.toExclusive,
    q.brand ?? null,
    row.statements_revision,
    row.catalogue_revision,
  );
  const binding = createHash('sha256')
    .update(
      JSON.stringify([
        scope.partnerId,
        scope.permissionRevision,
        generation,
        row.metrics_revision,
        q.contentId,
        q.brand ?? null,
      ]),
    )
    .digest('hex');
  if ((q.generation && q.generation !== generation) || (cursor && cursor.binding !== binding))
    throw new AccessFailure('conflict');
  if (q.resource === 'ad' && !row.items.length) throw new PartnerAdReadFailure('not_found');
  const batch = row.items.slice(0, 50),
    last = batch.at(-1);
  const items = batch.map(
    (a: {
      id: string;
      name: string;
      clip_id: string;
      created_at: string;
      source_identity: unknown;
      enabled: boolean;
      sync_state: string;
      refresh_from: string | null;
      reports: { report: unknown; state: string; overdue: boolean }[];
    }) => {
      const ad = {
        id: a.id,
        contentId: a.clip_id,
        title: a.name,
        status: 'unknown' as const,
        asOf: row.as_of,
        metrics: [],
      };
      if (q.resource === 'ads') return ad;
      const reports = a.reports.map((x) => SourceReportV2.parse(x.report));
      for (const r of reports) {
        const expected = a.source_identity as Record<string, unknown>;
        if (Object.entries(r.identity).some(([k, v]) => expected[k] !== v))
          throw new PartnerAdReadFailure('unavailable');
      }
      const canViewSpend = scope.capabilities.includes('view_ad_spend');
      return {
        ...ad,
        performance: {
          // Strip prohibited audience counts from every Celeb-facing surface; keep native raw
          // SourceReportV2 counts untouched for staff/ingestion.
          ...celebSafeAdPerformance(
            projectPerformance(
              period,
              reports,
              canViewSpend,
              !a.enabled ||
                a.sync_state === 'needs-attention' ||
                a.reports.some((r) => r.overdue || r.state === 'needs-attention'),
            ),
            canViewSpend,
          ),
          automaticRefreshFrom: a.refresh_from ? new Date(a.refresh_from).toISOString() : null,
        },
      };
    },
  );
  const performance = 'performance' in (items[0] ?? {}) ? items[0].performance : undefined;
  const result = {
    generation,
    period,
    generatedAt: row.as_of,
    dataThrough: performance?.dataThrough ?? null,
    requestId: randomUUID(),
    dataState: performance && performance.state !== 'unavailable' ? performance.state : 'ready',
    reasons: performance?.state === 'unavailable' ? [] : (performance?.reasons ?? []),
    data:
      q.resource === 'ad'
        ? items[0]
        : {
            items,
            totalCount: row.total,
            nextCursor:
              row.items.length > 50 && last
                ? Buffer.from(
                    JSON.stringify({ binding, at: last.created_at, id: last.id }),
                  ).toString('base64url')
                : null,
          },
  };
  return ContentHttpResponse.parse({
    partnerId: scope.partnerId,
    permissionRevision: scope.permissionRevision,
    resource: q.resource,
    brand: q.brand ?? null,
    q: q.q,
    contentId: q.contentId ?? null,
    adId: q.adId ?? null,
    earningsRevision: row.earnings_revision,
    catalogueRevision: row.catalogue_revision,
    result,
  });
}
