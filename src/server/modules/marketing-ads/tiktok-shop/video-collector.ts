import { z } from 'zod';
import { SourceReadError } from '../source-error';
import {
  ShopVideoConnection,
  ShopVideoPeriod,
  VideoPage,
  type VideoConnection,
  type VideoPeriod,
  type VideoCollection,
  type VideoObservation,
} from './video-contract';

export const SHOP_VIDEO_PATH = '/analytics/202605/shop_videos/performance';
export const SHOP_VIDEO_SCOPE = 'data.shop_analytics.public.read';
export type VideoRequest = {
  connectionId: string;
  path: typeof SHOP_VIDEO_PATH;
  query: {
    start_date_ge: string;
    end_date_lt: string;
    page_size: '100';
    sort_field: 'gmv';
    sort_order: 'DESC';
    currency: 'LOCAL';
    account_type: 'ALL';
    page_token?: string;
  };
};
/** The owning transport binds connectionId to a verified shop, signs requests and enforces quota.
 * No source URL, shop cipher, credentials or caller-controlled dimensions cross this port.
 * Its response must already be bounded in bytes; public registration must not call this directly.
 */
export type VideoCollectorDependencies = {
  request: (request: VideoRequest, signal: AbortSignal) => Promise<unknown>;
  now?: () => number;
};
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SourceReadError('invalid-source');
  return parsed.data;
};
function shopToday(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key)!.value).join('-');
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Bounded one-scan-per-shop acquisition. Only a fully validated scan yields publishable rows. */
export function createShopVideoCollector(
  rawConnections: readonly VideoConnection[],
  deps: VideoCollectorDependencies,
) {
  const connections = new Map<string, VideoConnection>();
  for (const raw of rawConnections) {
    const c = parse(ShopVideoConnection, raw);
    if (connections.has(c.connectionId)) throw new SourceReadError('invalid-source');
    connections.set(c.connectionId, c);
  }
  const now = deps.now ?? Date.now;
  return async (
    connectionId: string,
    rawPeriod: VideoPeriod,
    parent: AbortSignal,
  ): Promise<VideoCollection> => {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(60_000)]);
    try {
      signal.throwIfAborted();
      const connection = connections.get(connectionId);
      if (!connection) throw new SourceReadError('access');
      const period = parse(ShopVideoPeriod, rawPeriod),
        startedAt = now();
      const days = (Date.parse(period.toExclusive) - Date.parse(period.from)) / 86_400_000;
      const today = shopToday(startedAt, connection.timezone);
      if (days < 1 || days > 31 || period.toExclusive > today)
        throw new SourceReadError('invalid-source');
      const requestIds: string[] = [],
        tokens = new Set<string>(),
        ids = new Set<string>();
      const videos: VideoObservation[] = [];
      let token: string | undefined, latest: string | undefined, total: number | undefined;
      const result = (): Omit<VideoCollection, 'completeness' | 'reason' | 'videos'> => ({
        schemaVersion: 1,
        capability: 'tiktok.shop_video',
        apiVersion: '202605',
        grain: 'shop-video-period',
        connection: { ...connection },
        period: { ...period },
        fetchedAt: new Date(now()).toISOString(),
        latestAvailableDate: latest!,
        sourceRequestIds: requestIds,
        reportDefinition: 'tiktok.shop-video.202605.local.all.v1',
      });
      for (let page = 0; page < 20; page++) {
        signal.throwIfAborted();
        const response = parse(
          VideoPage,
          await abortable(
            deps.request(
              {
                connectionId,
                path: SHOP_VIDEO_PATH,
                query: {
                  start_date_ge: period.from,
                  end_date_lt: period.toExclusive,
                  page_size: '100',
                  sort_field: 'gmv',
                  sort_order: 'DESC',
                  currency: 'LOCAL',
                  account_type: 'ALL',
                  ...(token ? { page_token: token } : {}),
                },
              },
              signal,
            ),
            signal,
          ),
        );
        signal.throwIfAborted();
        const data = response.data;
        if (
          (latest !== undefined && latest !== data.latest_available_date) ||
          (total !== undefined && total !== data.total_count) ||
          data.latest_available_date >= today
        )
          throw new SourceReadError('invalid-source');
        latest = data.latest_available_date;
        total = data.total_count;
        requestIds.push(response.request_id);
        for (const row of data.videos) {
          if (ids.has(row.id) || (row.gmv && row.gmv.currency !== connection.currency))
            throw new SourceReadError('invalid-source');
          ids.add(row.id);
          videos.push({
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
        }
        if (videos.length > total) throw new SourceReadError('invalid-source');
        token = data.next_page_token || undefined;
        if (!token) {
          if (videos.length !== total) throw new SourceReadError('invalid-source');
          const lastDay = new Date(Date.parse(period.toExclusive) - 86_400_000)
            .toISOString()
            .slice(0, 10);
          if (latest < lastDay)
            return { ...result(), completeness: 'partial', reason: 'source-not-ready', videos: [] };
          return { ...result(), completeness: 'complete', reason: null, videos };
        }
        if (tokens.has(token) || data.videos.length === 0 || videos.length === total)
          throw new SourceReadError('invalid-source');
        tokens.add(token);
      }
      return { ...result(), completeness: 'partial', reason: 'page-limit', videos: [] };
    } catch (error) {
      if (parent.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error instanceof SourceReadError) throw error;
      // Raw transport failures can contain signed URLs or source response text.
      throw new SourceReadError('temporary');
    }
  };
}
