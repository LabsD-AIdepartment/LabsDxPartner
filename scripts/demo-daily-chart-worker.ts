import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fillEnabled, fillThroughToday } from '../src/server/hosted-demo/daily-chart-fill/store';
import { nextMidnightDelay } from '../src/server/hosted-demo/daily-chart-fill/model';
import { reportWorkerProgress } from '../src/server/modules/marketing-ads/worker-progress';
async function main() {
  if (!fillEnabled()) return;
  if (process.env.LABSD_PRESENTATION_MODE !== 'pitch') throw new Error('Pitch mode required');
  if (process.env.NODE_ENV !== 'development') {
    const config = JSON.parse(readFileSync(resolve('.next/required-server-files.json'), 'utf8'));
    if (
      config.config.env.LABSD_HOSTED_DEMO_ARTIFACT !== '1' ||
      process.env.LABSD_HOSTED_DEMO_ENABLED !== '1'
    )
      throw new Error('Hosted pitch artifact required');
  }
  const abort = new AbortController();
  const stop = () => abort.abort();
  for (const event of ['SIGTERM', 'SIGINT', 'disconnect'] as const) process.once(event, stop);
  let lastDay = '';
  try {
    while (!abort.signal.aborted) {
      const result = await fillThroughToday(process.env);
      if (result.changed || result.through !== lastDay) {
        console.log(JSON.stringify({ worker: 'demo-daily-chart-fill', ...result }));
        lastDay = result.through ?? '';
      }
      reportWorkerProgress(false);
      // Heartbeat at most every30s; wake precisely for00:00 Asia/Bangkok and catch up on restart.
      await delay(Math.max(100, Math.min(30000, nextMidnightDelay(new Date()))), undefined, {
        signal: abort.signal,
      });
    }
  } finally {
    for (const event of ['SIGTERM', 'SIGINT', 'disconnect'] as const)
      process.removeListener(event, stop);
  }
}
main().catch((error) => {
  if (error?.name === 'AbortError') return;
  console.error('Demo daily chart fill unavailable');
  process.exitCode = 1;
});
