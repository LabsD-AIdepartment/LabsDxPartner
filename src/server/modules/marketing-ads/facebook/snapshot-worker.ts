import { buildAdSnapshot } from './snapshot-refresh';
import { deriveRequestedWindowBinding, readAdSnapshotBindings } from './snapshot-config';
import { snapshotBindingKey, type createSnapshotDatabase } from './snapshot-database';

/** Only operator-configured bindings, never the unrelated native/test association catalogue. */
export async function runSnapshotWorkerCycle(options: {
  store: ReturnType<typeof createSnapshotDatabase>;
  env: Record<string, string | undefined>;
  assertBinding: () => Promise<void>;
  signal: AbortSignal;
  acquire?: typeof buildAdSnapshot;
  now?: () => number;
  progress?: () => void;
}) {
  const { store, env, signal, assertBinding } = options;
  const bindings = readAdSnapshotBindings(env);
  const now = options.now?.() ?? Date.now();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const date = (offset: number) =>
    new Date(Date.parse(today) + offset * 86400_000).toISOString().slice(0, 10);
  await assertBinding();
  for (const b of bindings) {
    signal.throwIfAborted();
    for (const [from, to] of [
      [b.from, b.toExclusive],
      [today.slice(0, 8) + '01', date(1)],
      [date(-6), date(1)],
    ])
      await store.request(deriveRequestedWindowBinding(b, from, to));
  }
  const result = { attempted: 0, published: 0, failed: 0 };
  for (let i = 0; i < 8; i++) {
    signal.throwIfAborted();
    await assertBinding();
    const lease = await store.claim(bindings);
    if (!lease) break;
    const current = bindings.find((b) => snapshotBindingKey(b) === lease.bindingKey)!;
    const binding = deriveRequestedWindowBinding(current, lease.from, lease.toExclusive);
    result.attempted++;
    try {
      const { snapshot } = await (options.acquire ?? buildAdSnapshot)(binding, {
        // Intraday reports may be collected by the hourly worker, never by a page visit.
        env: { ...env, LABSD_AD_SNAPSHOT_REFRESH_ON_VISIT: '1' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
      signal.throwIfAborted();
      await assertBinding();
      if (await store.publish(lease, binding, snapshot)) result.published++;
      else {
        await store.fail(lease);
        result.failed++;
      }
    } catch {
      await store.fail(lease);
      result.failed++;
    }
    options.progress?.();
  }
  return result;
}
