import { z } from 'zod';
import { PartnerShopVideoQuery } from '@/contracts/shop-video';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { sumExact } from '../partner-performance';
import { ShopVideoConnection, ShopVideoPeriod, VideoObservationSchema } from './video-contract';
import { Instant } from '@/contracts/common';

const Metadata = z.object({
  connection: ShopVideoConnection,
  period: ShopVideoPeriod,
  fetchedAt: Instant,
  latestAvailableDate: z.iso.date(),
  reportDefinition: z.literal('tiktok.shop-video.202605.local.all.v1'),
});
type Segment = {
  metadata: z.infer<typeof Metadata>;
  observation: z.infer<typeof VideoObservationSchema> | null;
  stale: boolean;
};
export function projectShopVideoPeriod(
  period: { from: string; toExclusive: string },
  segments: Segment[],
) {
  const exact = segments.filter(
    (s) =>
      s.metadata.period.from === period.from &&
      s.metadata.period.toExclusive === period.toExclusive,
  );
  const selected = (exact.length ? exact : segments)
    .slice()
    .sort((a, b) => a.metadata.period.from.localeCompare(b.metadata.period.from));
  if (selected.length > 366) throw new AccessFailure('conflict');
  const key = (s: Segment) => JSON.stringify([s.metadata.connection, s.metadata.reportDefinition]);
  for (let i = 0; i < selected.length; i++) {
    const s = selected[i];
    if (
      s.metadata.period.from < period.from ||
      s.metadata.period.toExclusive > period.toExclusive ||
      (i > 0 &&
        (key(s) !== key(selected[0]) ||
          selected[i - 1].metadata.period.toExclusive > s.metadata.period.from))
    )
      throw new AccessFailure('conflict');
  }
  let cursor = period.from;
  let complete = selected.length > 0;
  for (const s of selected) {
    if (s.metadata.period.from !== cursor || !s.observation) complete = false;
    cursor = s.metadata.period.toExclusive;
  }
  complete = complete && cursor === period.toExclusive;
  const values = selected.map((s) => s.observation);
  const sum = (key: 'paidSkuOrders' | 'itemsSold') =>
    complete && values.every((v) => v?.[key] != null)
      ? sumExact(values.map((v) => v![key]!))
      : null;
  const gmv =
    complete && values.every((v) => v?.gmv != null)
      ? {
          amount:
            values.length === 1
              ? values[0]!.gmv!.amount
              : sumExact(values.map((v) => v!.gmv!.amount)),
          currency: selected[0].metadata.connection.currency,
        }
      : null;
  const sourceDates = selected.map((s) => s.metadata.latestAvailableDate).sort();
  return {
    state: !selected.length
      ? ('unavailable' as const)
      : !complete
        ? ('partial' as const)
        : selected.some((s) => s.stale)
          ? ('stale' as const)
          : ('ready' as const),
    timezone: selected[0]?.metadata.connection.timezone ?? null,
    fetchedAt:
      selected
        .map((s) => s.metadata.fetchedAt)
        .sort()
        .at(-1) ?? null,
    latestAvailableDate: sourceDates[0] ?? null,
    // Views are a private audience count: never expose them in the public partner response (summary
    // or series). The raw value stays in the internal observation store; only this projection masks.
    views: null,
    paidSkuOrders: sum('paidSkuOrders'),
    itemsSold: sum('itemsSold'),
    gmv,
    productClickThroughRate:
      complete && values.length === 1 ? values[0]!.productClickThroughRate : null,
    series: selected.map((s) => ({
      period: { ...s.metadata.period },
      available: s.observation !== null,
      views: null,
      paidSkuOrders: s.observation?.paidSkuOrders ?? null,
      itemsSold: s.observation?.itemsSold ?? null,
      gmv: s.observation?.gmv ?? null,
      productClickThroughRate: s.observation?.productClickThroughRate ?? null,
    })),
  };
}
/** Every source row is selected through current membership -> clip -> agreed target -> exact mapping. */
export function createPartnerShopVideoRead(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const parsed = PartnerShopVideoQuery.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const q = parsed.data;
    return access.withPartner(headers, q.partnerId, 'view_content', async (tx, scope) => {
      if (scope.permissionRevision !== q.permissionRevision) throw new AccessFailure('conflict');
      const [clip] =
        await tx`select id from portal_content.clips where partner_id=${scope.partnerId} and id=${q.clipId} and not removed for share`;
      if (!clip) throw new AccessFailure('forbidden');
      const [snapshot] =
        await tx`with mappings as materialized(select m.*,(c.enabled and c.verified_at is not null) as enabled,c.revision as connection_revision from portal_marketing.video_mappings m
        join portal_marketing.targets t on t.id=m.target_id and t.active and t.partner_id=${scope.partnerId} and t.clip_id=${q.clipId}
        join portal_marketing.connections c on c.id=m.connection_id and c.namespace=m.namespace and c.account_id=m.shop_id
        and c.platform='tiktok' and c.capability='tiktok.shop_video'
        order by m.created_at,m.id limit 51)
        select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('reports',r.reports) order by m.created_at,m.id),'[]'::jsonb) as items,
          coalesce((select metrics::text from portal_meta.partner_changes where partner_id=${scope.partnerId}),'0') as metrics_revision
        from mappings m left join lateral (
          select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) as reports from (
            select g.metadata,o.observation,
              case when (w.state='running' and w.lease_until<=statement_timestamp())
                or g.connection_revision<>m.connection_revision
                or exists(select 1 from portal_marketing.video_schedules s where s.connection_id=w.connection_id
                  and s.timezone=w.timezone and w.period_from>=s.period_from and w.period_to<=s.period_to
                  and w.period_to-w.period_from=1 and w.next_attempt_at<=statement_timestamp())
                or exists(select 1 from portal_marketing.video_windows held where held.connection_id=w.connection_id
                  and held.connection_revision=m.connection_revision and held.retry_paused and held.issue in ('access','invalid-source'))
                then 'needs-attention' else w.state end as state
            from portal_marketing.video_windows w
            join portal_marketing.video_generations g on g.id=w.current_generation and g.window_id=w.id
            left join portal_marketing.video_observations o on o.generation_id=g.id and o.video_id=m.video_id and o.creator_id=m.creator_id
            where w.connection_id=m.connection_id and w.period_from>=${q.from}::date and w.period_to<=${q.toExclusive}::date
            order by w.period_from,w.period_to limit 1001
          ) x
        ) r on true`;
      const rows = snapshot.items as {
        id: string;
        connection_id: string;
        namespace: string;
        shop_id: string;
        video_id: string;
        creator_id: string;
        enabled: boolean;
        reports: { metadata: unknown; observation: unknown; state: string }[];
      }[];
      if (rows.length > 50) throw new AccessFailure('conflict');
      const items = [];
      for (const mapping of rows) {
        const reports = mapping.reports as {
          metadata: unknown;
          observation: unknown;
          state: string;
        }[];
        if (reports.length > 1000) throw new AccessFailure('conflict');
        const segments: Segment[] = reports.map((r) => {
          const metadata = Metadata.parse(r.metadata);
          const observation = r.observation ? VideoObservationSchema.parse(r.observation) : null;
          if (
            metadata.connection.connectionId !== mapping.connection_id ||
            metadata.connection.namespace !== mapping.namespace ||
            metadata.connection.shopId !== mapping.shop_id ||
            (observation &&
              (observation.videoId !== mapping.video_id ||
                observation.creator.openId !== mapping.creator_id ||
                (observation.gmv && observation.gmv.currency !== metadata.connection.currency)))
          )
            throw new AccessFailure('conflict');
          return {
            metadata,
            observation,
            stale: !mapping.enabled || r.state === 'needs-attention',
          };
        });
        items.push({
          id: mapping.id as string,
          source: 'TikTok Shop Video' as const,
          performance: projectShopVideoPeriod(
            { from: q.from, toExclusive: q.toExclusive },
            segments,
          ),
        });
      }
      return {
        schemaVersion: 1 as const,
        partnerId: scope.partnerId,
        permissionRevision: scope.permissionRevision,
        clipId: q.clipId,
        period: { from: q.from, toExclusive: q.toExclusive },
        metricsRevision: snapshot.metrics_revision as string,
        items,
      };
    });
  };
}
