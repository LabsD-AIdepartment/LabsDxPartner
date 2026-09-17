import { SourceReadError } from './source-error';
import { ZodError } from 'zod';
import { type createMarketingProviderRegistry } from './provider';
import { type createMarketingSyncStore, SyncSuperseded } from './sync-store';

/** One invocation handles at most one report. External scheduling/runtime activation is separate. */
export function createMarketingSyncWorker(
  store: ReturnType<typeof createMarketingSyncStore>,
  providers: ReturnType<typeof createMarketingProviderRegistry>,
  assertBinding: () => Promise<void> = async () => {},
) {
  return async (connections: readonly string[], parent: AbortSignal) => {
    parent.throwIfAborted();
    await assertBinding();
    const lease = await store.claim(connections);
    if (!lease) return { state: 'idle' as const };
    const signal = AbortSignal.any([parent, AbortSignal.timeout(25_000)]);
    try {
      // Race the whole adapter, including implementations that ignore AbortSignal.
      const work = async () => {
        const resolved = await providers.resolve(lease.identity, signal, 'history');
        if (
          !resolved.creativeIds ||
          resolved.creativeIds.length !== 1 ||
          resolved.creativeIds[0] !== lease.creativeIds[0]
        )
          throw new SourceReadError('invalid-source');
        const report = await providers.report(lease.identity, lease.period, signal);
        const current = await providers.resolve(lease.identity, signal, 'history');
        if (current.creativeIds?.length !== 1 || current.creativeIds[0] !== lease.creativeIds[0])
          throw new SourceReadError('invalid-source');
        if (current.sourceRevision !== resolved.sourceRevision)
          throw new SourceReadError('temporary');
        return report;
      };
      let abort = () => {};
      const report = await Promise.race([
        Promise.resolve().then(work),
        new Promise<never>((_, reject) => {
          abort = () => reject(new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]).finally(() => signal.removeEventListener('abort', abort));
      signal.throwIfAborted();
      if (report.completeness !== 'complete') {
        const failed = await store.fail(lease, 'incomplete');
        return {
          state: !failed
            ? ('superseded' as const)
            : lease.attempt >= 8
              ? ('needs-attention' as const)
              : ('retry' as const),
        };
      }
      await assertBinding();
      signal.throwIfAborted();
      await store.publish(lease, report);
      return { state: 'published' as const };
    } catch (error) {
      if (error instanceof SyncSuperseded) return { state: 'superseded' as const };
      const issue =
        error instanceof SourceReadError
          ? error.code
          : error instanceof ZodError
            ? 'invalid-source'
            : 'temporary';
      const failed = await store.fail(
        lease,
        issue,
        error instanceof SourceReadError ? (error.retryAfterMs ?? 0) : 0,
      );
      return {
        state: failed
          ? ['access', 'not-found', 'invalid-source'].includes(issue) || lease.attempt >= 8
            ? ('needs-attention' as const)
            : ('retry' as const)
          : ('superseded' as const),
      };
    }
  };
}
