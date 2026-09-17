# Automatic refresh recovery

The shared revision watcher checks the partner's small change-revision response while the page is active. It invalidates affected active queries through the existing scoped TanStack Query client. Server revisions and financial amounts remain server-owned; this change only governs when the client considers a revision successfully applied.

## Failure found and corrected

The prior watcher had no request deadline. A metadata request that never settled kept its in-flight guard occupied indefinitely. Separately, it advanced its revision baseline before reconciliation completed, while the React wrapper discarded the invalidation promise. A failed affected query could therefore stay stale indefinitely when no subsequent source revision arrived.

The complete check now has a ten-second deadline, including metadata and affected-query refresh. The watcher awaits reconciliation and advances its baseline only after success. Timeout or transient failure retains the last successful baseline, so the same server revision can trigger the retry. Existing polling intervals remain: 30–35 seconds after success, then exponential failure backoff starting at 60–65 seconds and capped at 300–305 seconds. These are scheduler delays, not guarantees about upstream freshness or browser rendering.

The deadline aborts network work and scoped refetches. The watcher also races the operation against cancellation so an adapter that ignores AbortSignal cannot occupy its guard forever. Pausing/stopping invalidates the request sequence, aborts work and clears timers; late resolutions cannot advance the baseline. Resuming starts an immediate check. Permission loss retains the existing cache-clear/stop path.

`invalidateChanges` accepts optional signal/error-propagation settings. Defaults preserve existing preview callers; the native `ChangeWatcher` opts into both cancellation and propagated query errors. Existing synchronous watcher callbacks still work; the callback may now return a promise and receives the cancellation signal. The graph remains ChangeWatcher → RevisionWatcher + scoped invalidation → existing query transports. No API schema, database, money writer, provider adapter, layout or deployment boundary changes.

## Evidence and limits

Two new regressions failed on the previous code: a stuck metadata request did not abort/retry, and a failed asynchronous reconciliation was attempted once instead of again for the same revision. Both pass after the change.

Rendered React tests exercise the actual Overview component and query client with synthetic transport responses. They cover a rejected refetch and a never-settling refetch: both retry without another server revision and show the later unpaid balance of ฿15,520 while keeping commission ฿37,360. The timed-out request is aborted, and resolving its old ฿25,520 response later does not replace the new value. After successful reconciliation, subsequent unchanged revision checks do not refetch the page again. Existing hidden/offline, scope switching, access loss, coalescing and stale-response regressions remain required.

These are deterministic fake-timer/React DOM recovery checks, not a measured source-commit-to-visible-browser latency under pilot load. The R01 ≤45-second healthy-session target, actual browser rendering and source lag must still be measured separately. Failure backoff intentionally may take longer than the healthy-session target. No real provider outage, external API or production release is exercised here.
