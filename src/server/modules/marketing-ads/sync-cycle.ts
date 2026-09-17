import type { Sql } from 'postgres';
import { z } from 'zod';
import type { createConfiguredMarketingProviders } from './composition';
import { createMarketingSyncStore } from './sync-store';
import { createMarketingSyncWorker } from './sync-worker';
import { planNextMarketingJob } from './sync-plan';

/** Bounded cycle shared by one-shot scheduler invocations and the stoppable worker loop. */
export async function runMarketingSyncCycle(
  sql: Sql,
  native: ReturnType<typeof createConfiguredMarketingProviders>,
  assertBinding: () => Promise<void>,
  parent: AbortSignal,
  historyDays = 90,
) {
  z.number().int().min(1).max(366).parse(historyDays);
  const signal = AbortSignal.any([parent, AbortSignal.timeout(60_000)]);
  await assertBinding();
  signal.throwIfAborted();
  const plan = await planNextMarketingJob(sql, native.profiles, Date.now(), historyDays, signal);
  const worker = createMarketingSyncWorker(
    createMarketingSyncStore(sql),
    native.providers,
    assertBinding,
  );
  const counts = {
    planned: plan.planned,
    attempted: 0,
    published: 0,
    retry: 0,
    attention: 0,
    superseded: 0,
  };
  for (let i = 0; i < 8; i++) {
    if (signal.aborted) break;
    const result = await worker(
      native.profiles.map((p) => p.id),
      signal,
    );
    if (result.state === 'idle') break;
    counts.attempted++;
    if (result.state === 'published') counts.published++;
    else if (result.state === 'retry') counts.retry++;
    else if (result.state === 'needs-attention') counts.attention++;
    else counts.superseded++;
  }
  return {
    ...counts,
    state: parent.aborted
      ? ('stopped' as const)
      : signal.aborted
        ? ('budget-exhausted' as const)
        : ('complete' as const),
  };
}
