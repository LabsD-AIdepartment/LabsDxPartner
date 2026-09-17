import { VideoScanLimitError } from './video-scan-store';
import type { createShopVideoStore, VideoLease } from './video-store';
import type { VideoPeriod } from './video-contract';
import type { VideoPageEvidence } from './video-page';
import { SourceReadError } from '../source-error';
export type VideoPageReader = (
  id: string,
  period: VideoPeriod,
  cursor: string | null,
  signal: AbortSignal,
) => Promise<VideoPageEvidence>;

/** Two bounded page operations fit the existing90s lease; ticks rotate connections.
 * Each page commits independently. Reclaim reads the last committed cursor, including
 * a terminal page awaiting publication. Provider I/O never holds a SQL transaction. */
export async function publishVideoPageBatch(
  store: ReturnType<typeof createShopVideoStore>,
  page: VideoPageReader,
  lease: VideoLease,
  signal: AbortSignal,
) {
  try {
    signal.throwIfAborted();
    let cursor = await store.pages.begin(lease);
    for (let n = 0; n < 2 && (!cursor.pageCount || cursor.pageToken !== null); n++) {
      signal.throwIfAborted();
      const evidence = await page(
        lease.connection.connectionId,
        lease.period,
        cursor.pageToken,
        signal,
      );
      signal.throwIfAborted();
      cursor = await store.pages.append(lease, cursor, evidence);
    }
    signal.throwIfAborted();
    if (cursor.pageCount && cursor.pageToken === null) {
      const result = await store.pages.publish(lease, cursor);
      if (result.state === 'published') return result;
      await store.pages.discard(lease);
      await store.fail(lease, 'source-not-ready', 60000);
      return { state: 'partial' as const };
    }
    await store.pages.release(lease);
    return { state: 'progress' as const };
  } catch (error) {
    let code =
      error instanceof SourceReadError || error instanceof VideoScanLimitError
        ? error.code
        : 'temporary';
    try {
      if (error instanceof VideoScanLimitError) await store.pages.discard(lease);
      // One clean retry for a stale cursor or inconsistent scan. Further failures
      // use the existing attention policy instead of repeatedly restarting at page1.
      if (code === 'invalid-source' && (await store.pages.discard(lease))) code = 'temporary';
      await store.fail(
        lease,
        code === 'not-found' ? 'invalid-source' : code,
        error instanceof SourceReadError ? (error.retryAfterMs ?? 0) : 0,
      );
    } catch {
      /* Lost/expired lease cannot alter a successor's state. */
    }
    if (signal.aborted) throw error;
    throw error instanceof SourceReadError || error instanceof VideoScanLimitError
      ? error
      : new SourceReadError('temporary');
  }
}
