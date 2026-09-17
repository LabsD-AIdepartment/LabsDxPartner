# Independent acquisition process check

Run `node scripts/marketing-health.mjs facebook` or `node scripts/marketing-health.mjs tiktok` from a separate process managed by operations. It performs one check, writes one sanitized JSON result and exits. No database, provider token, identity binding or outbound alert destination is needed. It does not start/restart the ingestion worker, retry imports or change source settings.

The target is fixed to HTTP127.0.0.1, path `/health`, default Facebook4191/TikTok4192 or the explicitly configured `LABSD_WORKER_HEALTH_PORT`. There is no arbitrary URL or hostname option and redirects are rejected. Schedule a check only for a lane expected to be enabled: a deliberately disabled/not-installed worker has no endpoint and is reported unavailable. A disabled flag is never silently translated into successful monitoring.

| Exit | Status | Meaning |
| --- | --- | --- |
|0|ok|Current supervisor reports a fresh completed cycle without attention, with acknowledged log capture if enabled|
|1|attention|Current completed cycle reports work needing attention; consult native per-account/source status|
|2|unavailable|Process is not running, stale, unreachable, malformed, has unavailable capture, or monitor configuration is invalid|

Output has schemaVersion1, monitor acquisition-process, platform and check time when configured, status and a fixed reason code. Validated supervisorRunId/workerRunId/sequence are included when available; successful/attention observations also include progressAgeMs. Invalid configuration emits only a generic configuration failure envelope. Never treat reason codes as provider error messages. Raw response fields, URLs, errors and configuration values are not copied into output.

The check validates the platform, envelope version, correlation identifiers, current run, boolean attention and state. A running event must be cycle/recovered with a real lastProgressAt. Both event age and cycle age must be below the existing180-second native watchdog budget, imported from the same supervisor constant; no duplicate independent freshness value. A future observation timestamp is unavailable/clock-skew, not healthy. Clock comparisons require the monitor and supervisor's local host clock to be consistent. A single check cannot prove that a monotonic sequence advances across multiple invocations.

Enabled capture must be ready and acknowledge this exact event sequence. Otherwise the monitor reports log-unavailable, including when the endpoint returns503 for an otherwise running worker. A503 response can explain a known unavailable state; it cannot become healthy. Unexpected statuses, non-JSON, malformed/oversized bodies and inconsistent running envelopes are unavailable. HTTP200 alone is insufficient.

An absolute2-second deadline covers connect, headers and the entire response, including a peer that keeps sending bytes. The body limit is8KiB. Sockets are destroyed on timeout or rejected/oversized responses; this checker does not follow redirects or use proxy environment settings. These are process-check engineering bounds, not upstream API SLAs.

## Interpretation and deployment

A completed idle cycle can be healthy without a connected shop or recent provider report. This check is process/capture health only: it does not validate per-shop last-success, report lag, imported totals, agreements, payouts or financial correctness. Report-lag monitoring remains a separate requirement using the existing authoritative import/source state. It intentionally reads no cached last-known healthy file.

Connect exit codes and JSON to an approved service monitor/alert receiver. Repeated failures and recoveries should be grouped by platform and current supervisorRunId; external scheduling, notification suppression and delivery remain the monitor deployment's responsibility. An alert receiver and schedule have not been installed by this change. No external messages are sent. The checker does not create a persistent polling service itself, and it cannot observe if its own scheduler is not running; production needs an independently supervised scheduler/monitor. Host-local HTTP assumes a trusted service host, not authentication against a hostile process holding that port.

Rollback removes the monitor command from its scheduler; the worker remains unaffected. The supervisor constant extraction preserves its original180-second default and optional internal test override. If a custom programmatic supervisor override is deployed, this fixed native checker is not evidence for that custom budget; review both settings together.

## Local evidence

Tests use real loopback HTTP servers for healthy/attention/backoff, stale/future timestamps, wrong platform, malformed/oversized JSON, redirects, slow streaming and capture failure/acknowledgement. Actual CLI processes prove0/1/2exit behavior and generic invalid-configuration output. A separate synthetic HTTP host is paused with SIGSTOP: the actual checker exits2/timeout; the test resumes and terminates that verified host and confirms exit0. This proves an independent process can detect a frozen health host; it is not a live-provider outage test. No provider, database, browser state or installed worker is changed. Relevant existing supervisor lifecycle tests also pass.
