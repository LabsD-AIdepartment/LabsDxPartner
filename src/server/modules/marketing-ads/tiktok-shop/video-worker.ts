import { VideoScanLimitError } from './video-scan-store';
import { publishVideoPageBatch, type VideoPageReader } from './video-page-cycle';
import { z } from 'zod';
import type { createShopVideoStore } from './video-store';
import type { createShopVideoCollector } from './video-collector';
import { publishClaimedShopVideos } from './video-cycle';
import { SourceReadError } from '../source-error';
import { VideoSchedulePolicy } from './video-schedule';
import { Id } from '@/contracts/common';

const Options = z.strictObject({
  connectionIds: z
    .array(Id)
    .max(100)
    .refine((v) => new Set(v).size === v.length),
  maxJobs: z.number().int().min(1).max(100).default(5),
  budgetMs: z.number().int().min(1000).max(300000).default(65000),
  policy: VideoSchedulePolicy.default(() => VideoSchedulePolicy.parse({})),
});

/** One bounded worker tick. The host owns supervision and the injected collector's single
 * credential/quota owner. No timers, credentials or upstream clients are created by a page read.
 * Account order uses persisted last-claim time so small tick budgets cannot starve later shops. */
export async function runShopVideoTick(
  store: ReturnType<typeof createShopVideoStore>,
  collect: ReturnType<typeof createShopVideoCollector> | { page: VideoPageReader },
  input: z.input<typeof Options>,
  signal: AbortSignal,
) {
  const options = Options.parse(input);
  signal.throwIfAborted();
  const deadline = AbortSignal.timeout(options.budgetMs);
  const bounded = AbortSignal.any([signal, deadline]);
  const results: {
    connectionId: string;
    state: 'published' | 'partial' | 'progress' | 'idle' | 'attention';
    code?: string;
  }[] = [];
  let attempted = 0;
  for (const connectionId of await store.orderConnections(options.connectionIds)) {
    if (bounded.aborted || attempted >= options.maxJobs) break;
    try {
      await store.plan(connectionId, Date.now(), options.policy);
      bounded.throwIfAborted();
      const lease = await store.claimDue(connectionId);
      if (!lease) {
        results.push({ connectionId, state: 'idle' });
        continue;
      }
      attempted++;
      const result =
        typeof collect === 'function'
          ? await publishClaimedShopVideos(store, collect, lease, bounded)
          : await publishVideoPageBatch(store, collect.page, lease, bounded);
      results.push({ connectionId, state: result.state });
    } catch (error) {
      if (bounded.aborted) break;
      results.push({
        connectionId,
        state: 'attention',
        code:
          error instanceof SourceReadError || error instanceof VideoScanLimitError
            ? error.code
            : 'temporary',
      });
    }
  }
  return { attempted, stopped: bounded.aborted, results };
}
