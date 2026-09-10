import { z } from 'zod';
import { Instant } from '@/contracts/common';
import { ShopVideoConnection, ShopVideoPeriod, VideoPage } from './video-contract';
import type { VideoConnection, VideoPeriod } from './video-contract';
import { SHOP_VIDEO_PATH, type VideoCollectorDependencies } from './video-collector';
import { abortable } from './video-transport';
import { SourceReadError } from '../source-error';

export const VideoPageToken = z.string().min(1).max(2000).nullable();
function validPeriod(period: VideoPeriod, connection: VideoConnection, at: string) {
  const days = (Date.parse(period.toExclusive) - Date.parse(period.from)) / 86400000;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: connection.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const today = ['year', 'month', 'day']
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join('-');
  return { valid: days >= 1 && days <= 31 && period.toExclusive <= today, today };
}
/** Server-to-server evidence only. A page cannot satisfy CompleteVideoCollection. */
export const ShopVideoPageEvidence = z
  .strictObject({
    kind: z.literal('shop-video-page'),
    schemaVersion: z.literal(1),
    connection: ShopVideoConnection,
    period: ShopVideoPeriod,
    requestedPageToken: VideoPageToken,
    fetchedAt: Instant,
    page: VideoPage,
  })
  .superRefine((v, ctx) => {
    const data = v.page.data;
    const { valid, today } = validPeriod(v.period, v.connection, v.fetchedAt);
    if (
      !valid ||
      data.latest_available_date >= today ||
      data.videos.length > data.total_count ||
      new Set(data.videos.map((row) => row.id)).size !== data.videos.length ||
      data.videos.some((row) => row.gmv && row.gmv.currency !== v.connection.currency) ||
      (data.next_page_token &&
        (data.videos.length === 0 ||
          data.next_page_token === v.requestedPageToken ||
          data.videos.length === data.total_count)) ||
      (v.requestedPageToken === null &&
        !data.next_page_token &&
        data.videos.length !== data.total_count)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid video page evidence' });
    }
  });
export type VideoPageEvidence = z.infer<typeof ShopVideoPageEvidence>;

/** One fixed signed read. Durable scan state and cross-page validation belong to the caller. */
export function createShopVideoPageReader(
  rawConnections: readonly VideoConnection[],
  deps: VideoCollectorDependencies,
) {
  const connections = new Map<string, VideoConnection>();
  for (const raw of rawConnections) {
    const p = ShopVideoConnection.safeParse(raw);
    if (!p.success || connections.has(p.data.connectionId))
      throw new SourceReadError('invalid-source');
    connections.set(p.data.connectionId, p.data);
  }
  return async (
    connectionId: string,
    rawPeriod: VideoPeriod,
    rawToken: string | null,
    parent: AbortSignal,
  ): Promise<VideoPageEvidence> => {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(20000)]);
    try {
      signal.throwIfAborted();
      const connection = connections.get(connectionId);
      if (!connection) throw new SourceReadError('access');
      const period = ShopVideoPeriod.safeParse(rawPeriod),
        token = VideoPageToken.safeParse(rawToken);
      if (!period.success || !token.success) throw new SourceReadError('invalid-source');
      const now = deps.now ?? Date.now;
      const startedAt = new Date(now()).toISOString();
      // Validate calendar bounds before credential lookup / quota / source traffic.
      if (!validPeriod(period.data, connection, startedAt).valid)
        throw new SourceReadError('invalid-source');
      const page = await abortable(
        deps.request(
          {
            connectionId,
            path: SHOP_VIDEO_PATH,
            query: {
              start_date_ge: period.data.from,
              end_date_lt: period.data.toExclusive,
              page_size: '100',
              sort_field: 'gmv',
              sort_order: 'DESC',
              currency: 'LOCAL',
              account_type: 'ALL',
              ...(token.data === null ? {} : { page_token: token.data }),
            },
          },
          signal,
        ),
        signal,
      );
      signal.throwIfAborted();
      const evidence = ShopVideoPageEvidence.safeParse({
        kind: 'shop-video-page',
        schemaVersion: 1,
        connection,
        period: period.data,
        requestedPageToken: token.data,
        fetchedAt: new Date(now()).toISOString(),
        page,
      });
      if (!evidence.success) throw new SourceReadError('invalid-source');
      return evidence.data;
    } catch (error) {
      if (parent.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error instanceof SourceReadError) throw error;
      throw new SourceReadError('temporary');
    }
  };
}
