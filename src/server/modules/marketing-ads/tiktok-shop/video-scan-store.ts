import { createHash, randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import type { VideoLease } from './video-store';
import { ShopVideoPageEvidence } from './video-page';
import { VideoObservationSchema } from './video-contract';
import { SourceReadError } from '../source-error';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class VideoScanLimitError extends Error {
  readonly code = 'page-limit' as const;
  constructor() {
    super('Video scan operational limit');
  }
}
export type VideoScanCursor = { id: string; pageCount: number; pageToken: string | null };
type Authority = {
  lock(tx: TransactionSql, lease: VideoLease): Promise<unknown>;
  clear(tx: TransactionSql, lease: VideoLease): Promise<void>;
  changed(tx: TransactionSql, connectionId: string): Promise<void>;
};
/** Native-only disposable staging. Source reads never run inside these transactions. */
export function createVideoScanStore(sql: Sql, authority: Authority) {
  async function current(tx: TransactionSql, lease: VideoLease, cursor: VideoScanCursor) {
    await authority.lock(tx, lease);
    const [scan] =
      await tx`select *,latest_date::text,created_at>clock_timestamp()-interval '2 hours' as fresh
      from portal_marketing.video_scans where connection_id=${lease.connection.connectionId} for update`;
    if (
      !scan ||
      scan.id !== cursor.id ||
      scan.window_id !== lease.windowId ||
      scan.connection_revision.toString() !== lease.connectionRevision ||
      scan.profile_hash !== hash(lease.connection) ||
      scan.page_count !== cursor.pageCount ||
      scan.next_token !== cursor.pageToken ||
      !scan.fresh
    )
      throw new SourceReadError('invalid-source');
    return scan;
  }
  return {
    async begin(lease: VideoLease): Promise<VideoScanCursor> {
      return sql.begin(async (tx) => {
        await authority.lock(tx, lease);
        const [scan] = await tx`select *,created_at>clock_timestamp()-interval '2 hours' as fresh
          from portal_marketing.video_scans where connection_id=${lease.connection.connectionId} for update`;
        if (
          scan &&
          scan.window_id === lease.windowId &&
          scan.connection_revision.toString() === lease.connectionRevision &&
          scan.profile_hash === hash(lease.connection)
        ) {
          if (!scan.fresh) throw new SourceReadError('invalid-source');
          return { id: scan.id, pageCount: scan.page_count, pageToken: scan.next_token };
        }
        // Binding/window replacement discards only unfinished staging, never published history.
        await tx`delete from portal_marketing.video_scans where connection_id=${lease.connection.connectionId}`;
        const id = randomUUID();
        await tx`insert into portal_marketing.video_scans(connection_id,id,window_id,connection_revision,profile_hash)
          values(${lease.connection.connectionId},${id},${lease.windowId},${lease.connectionRevision},${hash(lease.connection)})`;
        return { id, pageCount: 0, pageToken: null };
      });
    },
    async append(lease: VideoLease, cursor: VideoScanCursor, input: unknown) {
      const parsed = ShopVideoPageEvidence.safeParse(input);
      if (!parsed.success) throw new SourceReadError('invalid-source');
      const evidence = parsed.data,
        data = evidence.page.data;
      if (
        hash(evidence.connection) !== hash(lease.connection) ||
        hash(evidence.period) !== hash(lease.period) ||
        evidence.requestedPageToken !== cursor.pageToken
      )
        throw new SourceReadError('invalid-source');
      const bytes = Buffer.byteLength(JSON.stringify(evidence));
      return sql.begin(async (tx) => {
        const scan = await current(tx, lease, cursor);
        const count = scan.row_count + data.videos.length,
          pages = scan.page_count + 1;
        const next = data.next_page_token || null;
        const [clock] =
          await tx`select ${evidence.fetchedAt}::timestamptz<=clock_timestamp() as valid`;
        if (
          pages > 200 ||
          count > 20000 ||
          scan.byte_count + bytes > 33554432 ||
          data.total_count > 20000 ||
          (next && pages === 200)
        )
          throw new VideoScanLimitError();
        if (
          !clock.valid ||
          (scan.expected_count !== null && scan.expected_count !== data.total_count) ||
          (scan.latest_date !== null && scan.latest_date !== data.latest_available_date) ||
          count > data.total_count ||
          (!next && count !== data.total_count) ||
          (next && count >= data.total_count)
        )
          throw new SourceReadError('invalid-source');
        const [seen] =
          await tx`select 1 from portal_marketing.video_scan_pages where scan_id=${scan.id}
          and cursor_hash in ${tx(next ? [hash(cursor.pageToken), hash(next)] : [hash(cursor.pageToken)])} limit 1`;
        if (seen) throw new SourceReadError('invalid-source');
        if (data.videos.length) {
          const [duplicate] =
            await tx`select 1 from portal_marketing.video_scan_rows where scan_id=${scan.id}
            and video_id in ${tx(data.videos.map((row) => row.id))} limit 1`;
          if (duplicate) throw new SourceReadError('invalid-source');
          const rows = data.videos.map((row) => {
            const observation = VideoObservationSchema.parse({
              videoId: row.id,
              title: row.title,
              creator: {
                openId: row.creator.open_id,
                username: row.creator.user_name,
                nickname: row.creator.nick_name,
                authorType: row.creator.author_type,
              },
              views: row.views == null ? null : String(row.views),
              paidSkuOrders: row.sku_orders == null ? null : String(row.sku_orders),
              itemsSold: row.items_sold == null ? null : String(row.items_sold),
              gmv: row.gmv ?? null,
              productClickThroughRate: row.click_through_rate ?? null,
            });
            return observation;
          });
          // Drizzle changes shared JSON serializers. Bind text and expand on the database.
          await tx`insert into portal_marketing.video_scan_rows(scan_id,video_id,creator_id,observation)
            select ${scan.id},v->>'videoId',v->'creator'->>'openId',v
            from jsonb_array_elements(${JSON.stringify(rows)}::text::jsonb) as v`;
        }
        await tx`insert into portal_marketing.video_scan_pages(scan_id,ordinal,cursor_hash,page_hash,request_id)
          values(${scan.id},${pages},${hash(cursor.pageToken)},${hash(evidence)},${evidence.page.request_id})`;
        await tx`update portal_marketing.video_scans set next_token=${next},page_count=${pages},row_count=${count},
          byte_count=byte_count+${bytes},expected_count=${data.total_count},latest_date=${data.latest_available_date}::date,
          fetched_at=${evidence.fetchedAt}::timestamptz where id=${scan.id}`;
        return { id: scan.id as string, pageCount: pages, pageToken: next, complete: !next };
      });
    },
    async publish(lease: VideoLease, cursor: VideoScanCursor) {
      return sql.begin(async (tx) => {
        const scan = await current(tx, lease, cursor);
        const lastDay = new Date(Date.parse(lease.period.toExclusive) - 86400000)
          .toISOString()
          .slice(0, 10);
        const [actual] =
          await tx`select count(*)::integer as count from portal_marketing.video_scan_rows where scan_id=${scan.id}`;
        if (
          !scan.page_count ||
          scan.next_token ||
          scan.row_count !== scan.expected_count ||
          actual.count !== scan.expected_count
        )
          throw new SourceReadError('invalid-source');
        if (scan.latest_date < lastDay) return { state: 'not-ready' as const };
        const pages =
          await tx`select request_id,page_hash from portal_marketing.video_scan_pages where scan_id=${scan.id} order by ordinal`;
        if (pages.length !== scan.page_count) throw new SourceReadError('invalid-source');
        const metadata = {
          schemaVersion: 1,
          capability: 'tiktok.shop_video',
          apiVersion: '202605',
          grain: 'shop-video-period',
          connection: lease.connection,
          period: lease.period,
          fetchedAt: new Date(scan.fetched_at).toISOString(),
          latestAvailableDate: scan.latest_date,
          sourceRequestIds: pages.map((p) => p.request_id),
          reportDefinition: 'tiktok.shop-video.202605.local.all.v1',
          completeness: 'complete',
          reason: null,
        };
        await tx`insert into portal_marketing.video_generations(id,window_id,lease_token,connection_revision,report_hash,metadata)
          values(${scan.id},${lease.windowId},${lease.token},${lease.connectionRevision},${hash({ metadata, pages })},${JSON.stringify(metadata)}::text::jsonb)`;
        await tx`insert into portal_marketing.video_observations(generation_id,video_id,creator_id,observation)
          select ${scan.id},video_id,creator_id,observation from portal_marketing.video_scan_rows where scan_id=${scan.id}`;
        await tx`update portal_marketing.video_windows set current_generation=${scan.id},state='ready',issue=null,last_success_at=clock_timestamp(),
          attempt_count=0,retry_paused=false,next_attempt_at=clock_timestamp()+refresh_seconds*interval '1 second' where id=${lease.windowId}`;
        await tx`delete from portal_marketing.video_scans where id=${scan.id}`;
        await authority.clear(tx, lease);
        await authority.changed(tx, lease.connection.connectionId);
        return { state: 'published' as const, generationId: scan.id as string };
      });
    },
    async release(lease: VideoLease) {
      await sql.begin(async (tx) => {
        await authority.lock(tx, lease);
        await tx`update portal_marketing.video_windows set state='queued',issue=null,next_attempt_at=clock_timestamp() where id=${lease.windowId}`;
        await authority.clear(tx, lease);
      });
    },
    async discard(lease: VideoLease) {
      return sql.begin(async (tx) => {
        await authority.lock(tx, lease);
        await tx`delete from portal_marketing.video_scans where connection_id=${lease.connection.connectionId}`;
        const [window] =
          await tx`select attempt_count from portal_marketing.video_windows where id=${lease.windowId}`;
        return window.attempt_count === 0;
      });
    },
  };
}
