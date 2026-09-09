import { randomUUID } from 'node:crypto';
import { OverviewQuery, OverviewResponse } from '@/contracts/overview-http';
import { coverageForPeriod } from '@/contracts/coverage';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { earningsGeneration, instantSqlFormat, publishedPeriodsSql } from './publication';

const dateSql = instantSqlFormat;
// One data statement: publication, metadata, totals and revisions share an MVCC snapshot.
// No current_generation read: unissued import candidates are private to operations.
const query = `with ${publishedPeriodsSql}, rows as materialized (
  select e.earned_at,e.content_id,e.disposition,e.amount_minor,e.eligible_base_minor,
    e.payload->'earning'->>'kind' as kind,e.payload->'earning'->>'channel' as channel,
    (e.payload->'earning'->>'ratePpm')::integer as rate,c.id as metadata_id,c.brand
  from pubs p join portal_imports.earning_rows e on e.generation_id=p.generation_id
  left join portal_content.clips c on c.partner_id=$1 and c.id=e.content_id
  where e.earned_at>=$2::timestamptz and e.earned_at<$3::timestamptz
), selected as materialized (select * from rows where $4::text is null or brand=$4),
 totals as (select
  coalesce(sum(amount_minor) filter(where disposition='included'),0)::text as confirmed,
  coalesce(sum(eligible_base_minor) filter(where disposition='included'),0)::text as sales,
  coalesce(sum(amount_minor) filter(where disposition='included' and content_id is null),0)::text as unassigned,
  count(distinct content_id) filter(where disposition='included')::integer as content_count,
  coalesce(sum(amount_minor) filter(where disposition='included' and kind='commission' and channel='organic'),0)::text as organic,
  coalesce(sum(amount_minor) filter(where disposition='included' and kind='commission' and channel='brand-ads'),0)::text as ads,
  coalesce(sum(amount_minor) filter(where disposition='included' and (kind<>'commission' or channel not in ('organic','brand-ads'))),0)::text as other,
  case when count(distinct rate) filter(where kind='commission' and channel='organic')=1 then min(rate) filter(where kind='commission' and channel='organic') end as organic_rate,
  case when count(distinct rate) filter(where kind='commission' and channel='brand-ads')=1 then min(rate) filter(where kind='commission' and channel='brand-ads') end as ads_rate,
  count(*) filter(where disposition='included' and kind='commission' and brand is null)::integer as missing_sales_brand
  from selected
), days as (select to_char(earned_at at time zone 'Asia/Bangkok','YYYY-MM-DD') as date,sum(amount_minor)::text as minor
  from selected where disposition='included' group by 1),
 brand_sales as (select brand as label,sum(eligible_base_minor)::text as minor from selected
  where disposition='included' and kind='commission' and brand is not null group by brand),
 brands as (select distinct brand from rows where disposition='included' and brand is not null order by brand limit 101),
 ranked as materialized (select content_id,sum(amount_minor) as earned from selected where disposition='included' and content_id is not null
  group by content_id order by sum(amount_minor) desc,content_id limit 3),
 top_clips as (select c.id,c.title,c.brand,to_char(c.published_at at time zone 'UTC',${dateSql}) as published_at,
  c.cover,c.cover_position,c.removed,r.earned::text as earned
  from ranked r join portal_content.clips c on c.partner_id=$1 and c.id=r.content_id order by r.earned desc,c.id),
 balances as materialized (select s.id,s.period_from,s.period_to,s.scheduled_at,
  s.opening_minor+s.new_earnings_minor+s.adjustments_minor-coalesce((select sum(a.cash_minor+a.withholding_minor+a.other_minor)
    from portal_statements.allocations a where a.partner_id=$1 and a.statement_id=s.id),0) as closing
  from portal_statements.statements s where s.partner_id=$1 and $5::boolean),
 next_payout as (select id,to_char(period_from at time zone 'UTC',${dateSql}) as period_from,
  to_char(period_to at time zone 'UTC',${dateSql}) as period_to,
  to_char(scheduled_at at time zone 'UTC',${dateSql}) as scheduled_at,closing::text as amount
  from balances where closing>0 order by scheduled_at,id limit 1)
select to_char(statement_timestamp() at time zone 'UTC',${dateSql}) as as_of,
  (select count(*)::integer from pubs) as publication_count,
  (select to_char(min(data_through) at time zone 'UTC',${dateSql}) from pubs) as through,
  coalesce((select jsonb_agg(jsonb_build_object('from',to_char(period_from at time zone 'UTC',${dateSql}),
    'toExclusive',to_char(period_to at time zone 'UTC',${dateSql}),'timezone','Asia/Bangkok')) from pubs),'[]') as periods,
  (select to_jsonb(totals) from totals) as totals,
  (select count(*)::integer from rows where disposition='excluded') as excluded,
  (select count(*)::integer from rows where disposition='included' and content_id is not null and metadata_id is null) as missing_metadata,
  (select count(*)::integer from rows where disposition='included' and brand is null) as unknown_brand,
  coalesce((select jsonb_agg(to_jsonb(days) order by date) from days),'[]') as days,
  coalesce((select jsonb_agg(to_jsonb(brand_sales) order by minor::numeric desc,label) from brand_sales),'[]') as sales_by_brand,
  coalesce((select jsonb_agg(brand order by brand) from brands),'[]') as brands,
  coalesce((select jsonb_agg(to_jsonb(top_clips) order by earned::numeric desc,id) from top_clips),'[]') as top_clips,
  (select count(*)::integer from balances) as balance_count,
  (select coalesce(sum(closing),0)::text from balances) as outstanding,
  (select exists(select 1 from balances where closing<0)) as has_credit,
  (select to_jsonb(next_payout) from next_payout) as next,
  c.profile,coalesce(c.revision,0)::text as catalogue_revision,
  coalesce(r.statements,0)::text as statements_revision,
  coalesce(m.earnings,0)::text as earnings_revision,coalesce(m.settlements,0)::text as settlements_revision
from (values(1)) singleton(n)
left join portal_content.catalogues c on c.partner_id=$1
left join portal_statements.revisions r on r.partner_id=$1
left join portal_meta.partner_changes m on m.partner_id=$1`;

const money = (minor: string) => ({ currency: 'THB' as const, minor });
type MinorRow = { minor: string };
export function createOverviewReader(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const parsed = OverviewQuery.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const q = parsed.data;
    return access.withPartner(headers, q.partnerId, 'view_earnings', async (tx, scope) => {
      if (scope.permissionRevision !== q.permissionRevision) throw new AccessFailure('forbidden');
      const period = {
        from: q.from + 'T00:00:00+07:00',
        toExclusive: q.toExclusive + 'T00:00:00+07:00',
        timezone: 'Asia/Bangkok' as const,
      };
      const canPay = scope.capabilities.includes('view_statements');
      const [row] = await tx.unsafe(query, [
        scope.partnerId,
        period.from,
        period.toExclusive,
        q.brand ?? null,
        canPay,
      ]);
      if (!row || row.publication_count > 1000 || row.brands.length > 100)
        throw new Error('Overview bounds exceeded');
      const generation = earningsGeneration(
        scope.partnerId,
        period.from,
        period.toExclusive,
        q.brand ?? null,
        row.statements_revision,
        row.catalogue_revision,
      );
      if (q.generation && q.generation !== generation) throw new AccessFailure('conflict');
      const coverage = coverageForPeriod(period, row.periods);
      const known = coverage.status !== 'unavailable';
      const t = row.totals;
      const reasons: string[] = [];
      if (!known) reasons.push('ยังไม่มีรายได้ที่เผยแพร่ในช่วงวันที่เลือก');
      else if (coverage.status === 'partial') reasons.push('มีข้อมูลเฉพาะงวดที่เผยแพร่แล้ว');
      if (row.missing_metadata)
        reasons.push('บางคลิปยังไม่มีข้อมูลชื่อหรือแบรนด์ ยอดที่ไม่กรองแบรนด์ยังรวมรายได้เหล่านี้');
      if (q.brand && row.unknown_brand)
        reasons.push('ยอดที่กรองแบรนด์รวมเฉพาะรายการที่จับคู่แบรนด์แล้ว');
      const payoutKnown = canPay && row.balance_count > 0;
      const unpaid = BigInt(row.outstanding);
      const next = payoutKnown && !row.has_credit ? row.next : null;
      return OverviewResponse.parse({
        partnerId: scope.partnerId,
        permissionRevision: scope.permissionRevision,
        brand: q.brand ?? null,
        earningsRevision: row.earnings_revision,
        settlementsRevision: row.settlements_revision,
        catalogueRevision: row.catalogue_revision,
        data: {
          dataState: !known && !payoutKnown ? 'unavailable' : reasons.length ? 'partial' : 'ready',
          generatedAt: row.as_of,
          dataThrough: row.through,
          reasons,
          requestId: randomUUID(),
          profile: row.profile ?? null,
          brands: row.brands,
          earnings: {
            generation,
            period,
            coverage,
            estimated: null,
            confirmed: known ? money(t.confirmed) : null,
            eligibleSales: known ? money(t.sales) : null,
            unassignedAmount: known ? money(t.unassigned) : null,
            excludedCount: known && (!q.brand || row.excluded === 0) ? row.excluded : null,
            salesByBrand:
              known && !t.missing_sales_brand
                ? row.sales_by_brand.map((r: MinorRow & { label: string }) => ({
                    label: r.label,
                    value: money(r.minor),
                  }))
                : null,
            channelBreakdown: known
              ? {
                  organic: money(t.organic),
                  brandAds: money(t.ads),
                  other: money(t.other),
                  organicRatePpm: t.organic_rate,
                  brandAdsRatePpm: t.ads_rate,
                }
              : null,
            contentCount: known ? t.content_count : null,
            trend: known
              ? row.days.map((r: MinorRow & { date: string }) => ({
                  date: r.date,
                  amount: money(r.minor),
                }))
              : [],
            topContent: known
              ? row.top_clips.map((r: Record<string, string | boolean | null>) => ({
                  id: r.id,
                  title: r.title,
                  brand: r.brand,
                  publishedAt: r.published_at,
                  cover: r.cover,
                  coverPosition: r.cover_position,
                  removed: r.removed,
                  views: null,
                  earned: money(String(r.earned)),
                  unavailableReason: null,
                }))
              : [],
          },
          obligation: {
            asOf: row.as_of,
            confirmedUnpaid: payoutKnown ? money(String(unpaid > 0n ? unpaid : 0n)) : null,
            nextPayoutReason: !canPay
              ? 'บัญชีนี้ไม่ได้รับสิทธิ์ดูข้อมูลการจ่ายเงิน'
              : row.has_credit
                ? 'มีเครดิตคงเหลือ รอยืนยันการนำไปหักในรอบจ่าย'
                : null,
            nextPayout: next
              ? {
                  statementId: next.id,
                  scheduledAt: next.scheduled_at,
                  amount: money(next.amount),
                  period: {
                    from: next.period_from,
                    toExclusive: next.period_to,
                    timezone: 'Asia/Bangkok',
                  },
                }
              : null,
          },
        },
      });
    });
  };
}
