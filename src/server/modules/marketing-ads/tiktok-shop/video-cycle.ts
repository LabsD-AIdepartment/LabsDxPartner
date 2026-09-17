import type { createShopVideoStore, VideoLease } from './video-store';
import type { createShopVideoCollector } from './video-collector';
import type { VideoPeriod } from './video-contract';
import { SourceReadError } from '../source-error';

/** One whole-shop acquisition, with no source I/O in a database transaction. */
export async function collectAndPublishShopVideos(
  store: ReturnType<typeof createShopVideoStore>,
  collect: ReturnType<typeof createShopVideoCollector>,
  connectionId: string,
  period: VideoPeriod,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const lease = await store.claim(connectionId, period);
  if (!lease) return { state: 'busy' as const };
  return publishClaimedShopVideos(store, collect, lease, signal);
}

export async function publishClaimedShopVideos(
  store: ReturnType<typeof createShopVideoStore>,
  collect: ReturnType<typeof createShopVideoCollector>,
  lease: VideoLease,
  signal: AbortSignal,
) {
  try {
    signal.throwIfAborted();
    const report = await collect(lease.connection.connectionId, lease.period, signal);
    signal.throwIfAborted();
    if (report.completeness !== 'complete') {
      await store.fail(lease, report.reason, 60_000);
      return { state: 'partial' as const };
    }
    return { state: 'published' as const, ...(await store.publish(lease, report)) };
  } catch (error) {
    const code = error instanceof SourceReadError ? error.code : 'temporary';
    try {
      await store.fail(
        lease,
        code === 'not-found' ? 'invalid-source' : code,
        error instanceof SourceReadError ? (error.retryAfterMs ?? 0) : 0,
      );
    } catch {
      /* An expired/revoked lease must not mutate the newer owner's state. */
    }
    throw error instanceof SourceReadError || signal.aborted
      ? error
      : new SourceReadError('temporary');
  }
}
