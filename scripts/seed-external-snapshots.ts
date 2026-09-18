import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AdPerformanceSnapshot } from '../src/contracts/ad-performance-snapshot';
import {
  adSnapshotDir,
  deriveRequestedWindowBinding,
  readAdSnapshotBindings,
} from '../src/server/modules/marketing-ads/facebook/snapshot-config';
import { createSnapshotDatabaseRuntime } from '../src/server/modules/marketing-ads/facebook/snapshot-database-runtime';

// One-time, additive import of existing observations, retaining original source timestamps.
async function main() {
  const runtime = createSnapshotDatabaseRuntime(process.env);
  const bindings = readAdSnapshotBindings(process.env),
    directory = adSnapshotDir(process.env);
  let imported = 0,
    skipped = 0;
  try {
    await runtime.assertBinding();
    for (const file of await readdir(directory)) {
      if (!/^[a-z0-9][a-z0-9-]*__[A-Za-z0-9_-]+\.json$/.test(file)) continue;
      try {
        const raw = await readFile(resolve(directory, file), 'utf8');
        if (raw.length > 256_000) {
          skipped++;
          continue;
        }
        const snapshot = AdPerformanceSnapshot.parse(JSON.parse(raw));
        const binding = bindings.find(
          (b) => b.identity === snapshot.binding.identity && b.clipId === snapshot.binding.clipId,
        );
        if (!binding) {
          skipped++;
          continue;
        }
        await runtime.store.seed(
          deriveRequestedWindowBinding(
            binding,
            snapshot.requestedPeriod.from.slice(0, 10),
            snapshot.requestedPeriod.toExclusive.slice(0, 10),
          ),
          snapshot,
        );
        imported++;
      } catch {
        skipped++;
      }
    }
    console.log(JSON.stringify({ imported, skipped }));
  } finally {
    await runtime.close();
  }
}
main().catch(() => {
  console.error('Snapshot import unavailable');
  process.exitCode = 1;
});
