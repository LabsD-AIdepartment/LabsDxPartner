# Acquisition process event contract

The shared Facebook/TikTok supervisor emits one JSON object per state update to stdout. This adds process diagnostics to the existing restart supervisor without introducing another service, changing report retries or exposing source error payloads. Run the existing `scripts/marketing-worker.mjs` entrypoint; no extra logging flag is needed.

## Correlation and compatibility

Each supervisor process generates a random `supervisorRunId`. Within that process, `workerRunId` combines this ID with the supervisor start count, distinguishing replacement children. `sequence` strictly increases within the supervisor. `recordedAt` is the server's UTC observation time, not a provider event time or report freshness timestamp. Sequence remains the ordering key if the machine clock changes. A new supervisor has a new ID and a new sequence; do not join runs solely by start count or platform.

`schemaVersion: 1` identifies the envelope. The existing `platform`, `state`, `starts`, `lastProgressAt`, `attention` and `reason` fields remain available. `/health` exposes the same latest event with the same correlation ID and sequence; reading health does not create a log event. Existing consumers may continue reading the original fields. Health status codes and no-store behavior are unchanged.

## Events and interpretation

| Event / field | Interpretation |
| --- | --- |
| `worker.starting` | About to start a child; not yet healthy |
| `worker.cycle` | A cycle completed, possibly with no due work |
| `worker.stopping` | Awaiting child termination; a signal alone does not prove exit |
| `worker.backoff` | Child exited or could not start; supervisor is waiting before replacement |
| `worker.recovered` | First completed cycle after an interruption within this supervisor |
| `worker.failed` | Restart budget exhausted or supervisor startup unavailable |
| `worker.stopped` | Controlled shutdown completed |
| `worker.disabled` | Required feature flags are off; no worker or health server started |
| `attentionChange: raised / cleared` | Completed-cycle attention boolean changed; intermediate startup resets do not clear it |

`level` is `error` for failed, `warn` for backoff, abnormal stopping or a completed cycle reporting attention, otherwise `info`. Recovery can still carry a warning when the new cycle reports attention. `cleared` only means that the latest cycle no longer reports attention; it does not prove that every account or historical report is repaired. Process recovery likewise does not imply source freshness or successful commission reconciliation. Use the staff import queue and source connection status for report-level investigation.

Safe reasons are limited to `exited`, `shutdown`, `no-progress`, `spawn-failed`, `process-error` and `unavailable`. Events explicitly project known fields. They contain no account ID, SQL statement, source URL, token, raw exception, stack trace, provider payload or IPC extras. Raw child stdout/stderr remain discarded. A failed logging sink does not prevent process cleanup; loopback health remains available while the supervisor is running.

## Operations workflow and limits

Filter captured JSON logs by platform and `supervisorRunId`, then order by `sequence`. Use `workerRunId` to distinguish which attempt stopped and which resumed. Match a current health response to its exact recorded event. A missing health endpoint or timeout is unavailable, never the last saved healthy state. If startup is unavailable, check injected configuration through the existing secret-safe configuration procedure; this log deliberately does not echo rejected settings.

Optional capacity-bounded capture is available in the same entrypoint; see [worker journal](worker-journal.md) for explicit limits, private local storage, rotation and the additive logCapture health status. It is off unless configured. This does not install an alert destination, an OS service or a durable failure-history webpage. Production must configure and verify those facilities before claiming operational history or alert delivery. Do not redirect to an unbounded file as a retention solution. Window issue columns still hold current status and may clear on successful import; they cannot reconstruct past failures. No database migration or data rollback is involved in reverting this formatter.

## Local verification

Focused tests cover correlation across child restarts and separate supervisor runs, repeated cycles, attention changes across restart, sanitized unexpected fields and sink failure. Actual CLI tests cover both disabled platforms, invalid arguments and missing-configuration failure with health-to-log equality and confirmed shutdown. The existing real-child recovery test verifies the shared formatter receives actual supervisor transitions after an unexpected exit. Tests use local synthetic/missing configuration and do not call a real platform or modify the browser preview's database binding.
