// Development-only, OPT-IN automatic local preview acquisition for the ad-performance snapshot cache.
// Server-only: it is imported ONLY by the dev handler (never the browser, never app/ code). When the
// operator has opted in (LABSD_AD_SNAPSHOT_AUTO_REFRESH=1) and the window-specific cache is missing or
// stale, the handler asks this coordinator to acquire ONE bounded read-only snapshot for the SAME
// already-verified ad identity on the EXACT requested window and write it to the project-local cache.
//
// Guarantees:
//   * Single-flight per full scope + window: concurrent handler invocations for the same derived
//     binding + destination file share ONE provider read (no duplicate calls).
//   * The shared flight owns its OWN bounded provider deadline (default 20s) as a REAL wall-clock race
//     (not merely an AbortController): even a non-compliant build/fetch that never resolves settles the
//     flight `unavailable` at the deadline, and a build resolving after the deadline never writes. It is
//     NEVER tied to a single client's abort, so a client that disconnects early still lets the server
//     finish (within the deadline) and populate the cache for a subsequent normal refetch.
//   * Absent credentials / provider error / deadline are swallowed to `unavailable`: no env var, token,
//     Graph URL, raw error or raw count ever leaks. The cache is simply left as-is.

import { buildAdSnapshot } from '@/server/modules/marketing-ads/facebook/snapshot-refresh';
import type { AdSnapshotBindingConfigValue } from '@/server/modules/marketing-ads/facebook/snapshot-config';
import { writeSnapshotFile } from './store';

/** Local-preview cache freshness policy: a cache newer than this is served with no provider call. */
export const AUTO_CACHE_FRESH_MS = 300_000;
/** Bounded provider deadline for one automatic acquisition. */
export const AUTO_PROVIDER_DEADLINE_MS = 20_000;

export type AutoRefreshOutcome = 'refreshed' | 'unavailable';

export interface AcquireDeps {
  env: Record<string, string | undefined>;
  dir: string;
  fileName: string;
  binding: AdSnapshotBindingConfigValue;
  now?: () => number;
  fetch?: typeof fetch;
  // Seams for unit tests; production uses the real builder/writer.
  build?: typeof buildAdSnapshot;
  write?: (dir: string, fileName: string, contents: string) => void;
  deadlineMs?: number;
}

const inflight = new Map<string, Promise<AutoRefreshOutcome>>();

/** The single-flight key: the FULL scope (derived binding) + destination (dir + file). */
function scopeKey(deps: AcquireDeps): string {
  return JSON.stringify([deps.dir, deps.fileName, deps.binding]);
}

async function runAcquire(deps: AcquireDeps): Promise<AutoRefreshOutcome> {
  const controller = new AbortController();
  const deadline = deps.deadlineMs ?? AUTO_PROVIDER_DEADLINE_MS;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A REAL wall-clock deadline, not merely an AbortController. An injected or non-compliant
  // build/fetch that ignores the abort signal and never resolves must NOT hold the single-flight open
  // forever: the deadline promise wins the race and the flight settles `unavailable` after `deadline`.
  // We still fire the abort so a compliant provider tears its request down too.
  const onDeadline = new Promise<AutoRefreshOutcome>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve('unavailable');
    }, deadline);
  });

  const buildAndWrite = (async (): Promise<AutoRefreshOutcome> => {
    const build = deps.build ?? buildAdSnapshot;
    const { snapshot } = await build(deps.binding, {
      env: deps.env,
      fetch: deps.fetch,
      now: deps.now,
      signal: controller.signal,
    });
    // A build that resolves LATE (after the deadline/abort already lost the race) must never write a
    // stale cache behind the deadline's back. Re-check immediately before the synchronous writer.
    if (timedOut || controller.signal.aborted) return 'unavailable';
    const write = deps.write ?? writeSnapshotFile;
    write(deps.dir, deps.fileName, JSON.stringify(snapshot, null, 2));
    return 'refreshed';
    // Never leak the underlying cause (missing credential, provider error, deadline, validation, …);
    // the `.catch` keeps a late rejection from surfacing as an unhandled rejection after the race.
  })().catch<AutoRefreshOutcome>(() => 'unavailable');

  try {
    return await Promise.race([buildAndWrite, onDeadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Acquire (or join an in-flight acquisition of) the window-specific snapshot. Returns `refreshed` when a
 * fresh cache file was written, otherwise `unavailable`. The returned promise is shared across all
 * concurrent callers for the same scope + window and is not cancellable by any one caller.
 */
export function acquireAutoSnapshot(deps: AcquireDeps): Promise<AutoRefreshOutcome> {
  const key = scopeKey(deps);
  const existing = inflight.get(key);
  if (existing) return existing;
  const flight = runAcquire(deps).finally(() => {
    if (inflight.get(key) === flight) inflight.delete(key);
  });
  inflight.set(key, flight);
  return flight;
}
