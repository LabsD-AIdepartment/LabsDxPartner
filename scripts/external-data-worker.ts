import { setTimeout as delay } from 'node:timers/promises';
import { createSnapshotDatabaseRuntime } from '../src/server/modules/marketing-ads/facebook/snapshot-database-runtime';
import { runSnapshotWorkerCycle } from '../src/server/modules/marketing-ads/facebook/snapshot-worker';
import { reportWorkerProgress } from '../src/server/modules/marketing-ads/worker-progress';

async function main() {
  if (
    process.env.LABSD_AD_SNAPSHOT_DATABASE !== '1' ||
    process.env.LABSD_EXTERNAL_DATA_WORKER_ENABLED !== '1'
  )
    return;
  const runtime = createSnapshotDatabaseRuntime(process.env);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.once('disconnect', stop);
  try {
    while (!abort.signal.aborted) {
      const result = await runSnapshotWorkerCycle({
        ...runtime,
        env: process.env,
        signal: abort.signal,
        progress: () => reportWorkerProgress(false),
      });
      if (result.attempted) console.log(JSON.stringify({ worker: 'external-data', ...result }));
      reportWorkerProgress(result.failed > 0);
      // Poll the durable queue; each successfully acquired window is due once per hour.
      await delay(15_000, undefined, { signal: abort.signal });
    }
  } catch {
    if (!abort.signal.aborted) throw new Error('External data worker unavailable');
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    process.removeListener('disconnect', stop);
    await runtime.close();
  }
}
main().catch(() => {
  console.error('External data worker unavailable');
  process.exitCode = 1;
});
