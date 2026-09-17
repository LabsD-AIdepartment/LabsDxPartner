import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContentQuery, ContentHttpResponse } from '@/contracts/content-http';
import { Instant } from '@/contracts/common';
import type { AdReferenceValue } from '@/contracts/content';
import { coverageForPeriod } from '@/contracts/coverage';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import {
  earningsGeneration,
  instantSqlFormat as fmt,
  publishedPeriodsSql,
} from '@/server/modules/earnings/publication';
import { earningLineRef } from '@/server/modules/earnings/corrections';
import { IntakeRow } from '@/server/adapters/approved-period/schema';
import { readPartnerAds } from '@/server/modules/marketing-ads/partner-read';

const batchSize = 50;
// Verified platform ad identities for one clip, batched into the card query to avoid N+1.
// $11 = marketingEnabled: null when off (unknown), '[]' when on with no valid linkage (verified none).
// Authority mirrors partner-read: active owned target, matching connection, current sync mapping.
// A removed clip suppresses linkage (null -> omitted -> unknown) rather than exposing stale IDs.
// source_identity is projected only when it is a canonical SourceIdentityV2 whose every dimension
// matches the association's own trusted columns and the connection's capability/platform. Guards use
// jsonb_typeof so malformed rows are skipped, never cast-to-throw; ->> would coerce a numeric
// externalId to text, so string typing is required before the value is read. Deterministic
// order-by precedes the bound so the projected set is stable.
const adReferencesSql = (clip: string, removed: string) =>
  `case when $11::boolean and not ${removed} then coalesce((
    select jsonb_agg(jsonb_build_object('platform',x.platform,'externalId',x.external_id)
      order by x.platform,x.external_id)
    from (
      select a.source_identity->>'platform' as platform,a.source_identity->>'externalId' as external_id
      from portal_marketing.associations a
      join portal_marketing.targets mt on mt.id=a.target_id and mt.active
        and mt.partner_id=a.partner_id and mt.clip_id=a.clip_id
      join portal_marketing.connections mc on mc.id=a.connection_id
        and mc.namespace=a.namespace and mc.account_id=a.account_id
      join portal_marketing.sync_jobs j on j.association_id=a.id and j.mapping_revision=a.mapping_revision
      where a.partner_id=$1 and a.clip_id=${clip}
        and jsonb_typeof(a.source_identity)='object'
        and jsonb_typeof(a.source_identity->'schemaVersion')='number'
        and a.source_identity->>'schemaVersion'='2'
        and jsonb_typeof(a.source_identity->'externalId')='string'
        and jsonb_typeof(a.source_identity->'platform')='string'
        and jsonb_typeof(a.source_identity->'objectType')='string'
        and jsonb_typeof(a.source_identity->'namespace')='string'
        and jsonb_typeof(a.source_identity->'accountId')='string'
        and jsonb_typeof(a.source_identity->'connectionId')='string'
        and jsonb_typeof(a.source_identity->'capability')='string'
        and a.source_identity->>'externalId'=a.external_id
        and a.source_identity->>'platform'=a.platform
        and a.source_identity->>'objectType'=a.object_type
        and a.source_identity->>'namespace'=a.namespace
        and a.source_identity->>'accountId'=a.account_id
        and a.source_identity->>'connectionId'=a.connection_id
        and a.source_identity->>'platform'=mc.platform
        and a.source_identity->>'capability'=mc.capability
      group by 1,2 order by 1,2 limit 100
    ) x
  ),'[]'::jsonb) else null end`;
const Cursor = z.strictObject({
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  at: Instant,
  id: z.string().min(1).max(160),
  partition: z.uuid().nullable(),
});
export class ContentReadFailure extends Error {
  constructor(public code: 'not_found' | 'unavailable') {
    super(code);
  }
}
function decodeCursor(value?: string) {
  if (!value) return null;
  try {
    return Cursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new AccessFailure('invalid_input');
  }
}
const money = (minor: string) => ({ currency: 'THB' as const, minor });
const commonSql = `with ${publishedPeriodsSql},
 params as (select $8::timestamptz as after_at,$9::text as after_id,$10::uuid as after_generation),
 rows as materialized (
   select e.* from pubs p join portal_imports.earning_rows e on e.generation_id=p.generation_id
   where e.earned_at>=$2::timestamptz and e.earned_at<$3::timestamptz and $7::boolean
 ),
 clip_totals as (select content_id,sum(amount_minor)::text as amount,sum(eligible_base_minor)::text as sales,
   count(*)::integer as count,case when count(distinct payload->>'agreementVersion')=1 then min(payload->>'agreementVersion') end as agreement
   from rows where disposition='included' group by content_id),
 clips as materialized (
   select c.*,coalesce(t.amount,'0') as amount,coalesce(t.sales,'0') as sales,coalesce(t.count,0) as earning_count,t.agreement
   from portal_content.clips c left join clip_totals t on t.content_id=c.id
   where c.partner_id=$1 and ($4::text is null or c.brand=$4)
 ),
 library as (select * from clips c where position(lower($5::text) in lower(c.title||' '||c.brand))>0),
 brands as (select distinct c.brand from portal_content.clips c
   where c.partner_id=$1
   order by c.brand limit 101),
 target as (select * from clips where id=$6::text)`;
const metadataSql = `select
 case when $11::boolean and $6::text is not null then (select count(*)::int from portal_marketing.associations a
   join portal_marketing.targets t on t.id=a.target_id and t.active
   join portal_marketing.connections mc on mc.id=a.connection_id and mc.namespace=a.namespace and mc.account_id=a.account_id
   join portal_marketing.sync_jobs j on j.association_id=a.id and j.mapping_revision=a.mapping_revision
   where a.partner_id=$1 and a.clip_id=$6 and exists(select 1 from target where not removed)) end as ad_count,
 to_char(statement_timestamp() at time zone 'UTC',${fmt}) as as_of,
 (select count(*)::integer from pubs) as publication_count,
 (select to_char(min(data_through) at time zone 'UTC',${fmt}) from pubs) as through,
 coalesce((select jsonb_agg(jsonb_build_object('from',to_char(period_from at time zone 'UTC',${fmt}),
   'toExclusive',to_char(period_to at time zone 'UTC',${fmt}),'timezone','Asia/Bangkok')) from pubs),'[]') as periods,
 coalesce(r.statements,0)::text as statements_revision,coalesce(c.revision,0)::text as catalogue_revision,
 coalesce(m.earnings,0)::text as earnings_revision,c.partner_id is not null as has_catalogue,
 coalesce((select jsonb_agg(brand order by brand) from brands),'[]') as brands,
 (select count(*)::integer from rows e where e.disposition='included' and e.content_id is not null
   and not exists(select 1 from portal_content.clips c where c.partner_id=$1 and c.id=e.content_id)) as missing_metadata,
 (select count(*)::integer from rows where disposition='excluded') as excluded,
 (select to_jsonb(t)||jsonb_build_object('published_at',to_char(t.published_at at time zone 'UTC',${fmt}),
   'ad_references',${adReferencesSql('t.id', 't.removed')}) from target t) as target`;
const metadataFrom = `from (values(1)) singleton(n)
 left join portal_content.catalogues c on c.partner_id=$1
 left join portal_statements.revisions r on r.partner_id=$1
 left join portal_meta.partner_changes m on m.partner_id=$1`;

// Exported for regression tests that assert the ad-linkage guards are present in the composed
// query text. These tests verify query composition, not database execution.
export function dataSql(resource: z.infer<typeof ContentQuery>['resource']) {
  if (resource === 'list')
    return `${commonSql}, batch as (
    select c.* from library c cross join params p
    where p.after_at is null or (c.published_at,c.id)<(p.after_at,p.after_id)
    order by c.published_at desc,c.id desc limit ${batchSize + 1}
  ) ${metadataSql},(select count(*)::integer from library) as total,
    coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('published_at',to_char(b.published_at at time zone 'UTC',${fmt}),
      'ad_references',${adReferencesSql('b.id', 'b.removed')})
      order by b.published_at desc,b.id desc) from batch b),'[]') as items ${metadataFrom}`;
  if (resource === 'earnings')
    return `${commonSql}, lines as (
    select e.*,encode(sha256(convert_to(e.entitlement_key,'UTF8')),'hex') as key_id
    from rows e where e.content_id=$6 and e.disposition='included' and exists(select 1 from target)
  ), batch as (
    select e.* from lines e cross join params p where p.after_at is null
      or (e.earned_at,e.generation_id,e.key_id)<(p.after_at,p.after_generation,p.after_id)
    order by e.earned_at desc,e.generation_id desc,e.key_id desc limit ${batchSize + 1}
  ) ${metadataSql},(select count(*)::integer from lines) as total,
    coalesce((select jsonb_agg(jsonb_build_object('generation_id',b.generation_id,'key_id',b.key_id,
      'earned_at',to_char(b.earned_at at time zone 'UTC',${fmt}),'amount',b.amount_minor::text,
      'sales',b.eligible_base_minor::text,'payload',b.payload) order by b.earned_at desc,b.generation_id desc,b.key_id desc)
      from batch b),'[]') as items ${metadataFrom}`;
  return `${commonSql} ${metadataSql} ${metadataFrom}`;
}

type ClipRow = {
  id: string;
  title: string;
  brand: string;
  published_at: string;
  cover: string | null;
  cover_position: string;
  removed: boolean;
  amount: string;
  sales: string;
  earning_count: number;
  agreement: string | null;
  // null (marketing off) or absent (legacy row) means unknown; an array means verified linkage.
  ad_references?: AdReferenceValue[] | null;
};
// Exported for pure projection tests; the ad-linkage authority itself lives in the SQL above.
export function contentCard(row: ClipRow, known: boolean, reason: string) {
  return {
    id: row.id,
    title: row.title,
    brand: row.brand,
    publishedAt: row.published_at,
    cover: row.cover,
    coverPosition: row.cover_position,
    removed: row.removed,
    views: null,
    earned: known ? money(row.amount) : null,
    unavailableReason: known ? null : reason,
    // Omit when unknown; native media stays omitted until authoritative ingestion exists.
    ...(row.ad_references != null ? { adReferences: row.ad_references } : {}),
  };
}

export function createContentReader(
  access: ReturnType<typeof createPartnerAccess>,
  options: { marketingEnabled?: boolean } = {},
) {
  return async (headers: Headers, input: unknown) => {
    const parsed = ContentQuery.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const q = parsed.data,
      cursor = q.resource === 'ads' ? null : decodeCursor(q.cursor);
    if (cursor && (q.resource === 'list') !== (cursor.partition === null))
      throw new AccessFailure('invalid_input');
    return access.withPartner(headers, q.partnerId, 'view_content', async (tx, scope) => {
      if (scope.permissionRevision !== q.permissionRevision) throw new AccessFailure('forbidden');
      if (options.marketingEnabled && (q.resource === 'ad' || q.resource === 'ads'))
        return readPartnerAds(tx, scope, q);
      const canEarn = scope.capabilities.includes('view_earnings');
      if (q.resource === 'earnings' && !canEarn) throw new AccessFailure('forbidden');
      const period = {
        from: q.from + 'T00:00:00+07:00',
        toExclusive: q.toExclusive + 'T00:00:00+07:00',
        timezone: 'Asia/Bangkok' as const,
      };
      const [row] = await tx.unsafe(dataSql(q.resource), [
        scope.partnerId,
        period.from,
        period.toExclusive,
        q.brand ?? null,
        q.q,
        q.contentId ?? null,
        canEarn,
        cursor?.at ?? null,
        cursor?.id ?? null,
        cursor?.partition ?? null,
        !!options.marketingEnabled,
      ]);
      if (!row || row.publication_count > 1000 || row.brands.length > 100)
        throw new Error('Content bounds exceeded');
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
            q.resource,
            q.q,
            q.contentId ?? null,
          ]),
        )
        .digest('hex');
      if ((q.generation && q.generation !== generation) || (cursor && cursor.binding !== binding))
        throw new AccessFailure('conflict');
      if (q.resource !== 'list' && !row.target) throw new ContentReadFailure('not_found');
      if (q.resource === 'ad') throw new ContentReadFailure('unavailable');
      const coverage = coverageForPeriod(period, row.periods);
      const known = canEarn && coverage.status !== 'unavailable';
      const unknownReason = !canEarn
        ? 'บัญชีนี้ไม่ได้รับสิทธิ์ดูข้อมูลรายได้'
        : 'ยังไม่มีรายได้ที่เผยแพร่ในช่วงวันที่เลือก';
      const reasons: string[] = [];
      if (!known) reasons.push(unknownReason);
      else if (coverage.status === 'partial') reasons.push('มีข้อมูลเฉพาะงวดที่เผยแพร่แล้ว');
      if (q.resource === 'list' && row.missing_metadata)
        reasons.push('บางรายการรายได้ยังไม่มีข้อมูลคลิป ยอดภาพรวมยังรวมรายการเหล่านั้น');
      const base = {
        generation,
        period,
        coverage,
        generatedAt: row.as_of,
        dataThrough: canEarn ? row.through : null,
        requestId: randomUUID(),
        reasons,
        dataState: !row.has_catalogue ? 'unavailable' : reasons.length ? 'partial' : 'ready',
      };
      const hasMore = row.items?.length > batchSize;
      const items = row.items?.slice(0, batchSize) ?? [];
      const last = items.at(-1);
      const nextCursor =
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                binding,
                at: q.resource === 'list' ? last.published_at : last.earned_at,
                id: q.resource === 'list' ? last.id : last.key_id,
                partition: q.resource === 'list' ? null : last.generation_id,
              }),
            ).toString('base64url')
          : null;
      let result: unknown;
      if (q.resource === 'list')
        result = {
          ...base,
          brands: row.brands,
          data: {
            items: items.map((c: ClipRow) => contentCard(c, known, unknownReason)),
            totalCount: row.total,
            nextCursor,
          },
        };
      else if (q.resource === 'detail')
        result = {
          ...base,
          data: {
            content: contentCard(row.target, known, unknownReason),
            sourceUrl: row.target.source_url,
            eligibleSales: known ? money(row.target.sales) : null,
            eligibleOrders: null,
            agreementVersion: known ? row.target.agreement : null,
            earningsStatus: known ? 'confirmed' : 'unavailable',
            metrics: [],
            adCount: row.ad_count,
            attribution: known ? 'content' : 'unavailable',
          },
        };
      else if (q.resource === 'ads') {
        const { coverage: _coverage, ...adBase } = base;
        result = {
          ...adBase,
          dataState: 'unavailable',
          dataThrough: null,
          reasons: ['ยังไม่มีข้อมูลโฆษณาที่เชื่อมกับคลิปนี้จากต้นทาง'],
          data: { items: [], nextCursor: null, totalCount: null },
        };
      } else
        result = {
          ...base,
          data: {
            items: items.map(
              (line: {
                generation_id: string;
                earned_at: string;
                amount: string;
                sales: string | null;
                payload: unknown;
              }) => {
                const source = IntakeRow.parse(line.payload);
                if (source.disposition !== 'included')
                  throw new Error('Expected published earning');
                const e = source.earning;
                return {
                  id: earningLineRef(line.generation_id, source.entitlement),
                  sourceRef: source.sourceId,
                  sourceRevision: source.sourceRevision,
                  agreementVersion: source.agreementVersion,
                  earnedAt: line.earned_at,
                  contentId: q.contentId,
                  kind: e.kind,
                  eligibleBase: e.kind === 'commission' ? money(line.sales!) : null,
                  ratePpm: e.kind === 'commission' ? e.ratePpm : null,
                  amount: money(line.amount),
                  status: e.kind === 'adjustment' ? 'adjustment' : 'confirmed',
                  reason: e.kind === 'adjustment' ? e.reasonRef : null,
                  evidenceRef: source.evidenceRef,
                  originalLineId: e.kind === 'adjustment' ? e.originalLineRef : null,
                  attribution: 'content',
                };
              },
            ),
            totalCount: known ? row.total : null,
            nextCursor,
            excludedCount: known && row.excluded === 0 ? 0 : null,
            unassignedAmount: null,
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
    });
  };
}
