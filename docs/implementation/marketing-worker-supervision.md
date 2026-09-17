# Acquisition worker supervision

D077 provides a shared process supervisor for the existing Facebook and TikTok
Shop Video workers. It does not install an OS service, enable a platform, or alter
source ownership, SQL leases, report schedules, commission or payment data.

## Run and observe

From the project root with the pinned Node 24 runtime and injected server settings:

```sh
npm run marketing:worker -- facebook
npm run marketing:worker -- tiktok
```

Each starts one foreground supervisor and its fixed native worker. All existing
capability/sync flags must be enabled; otherwise it exits successfully with a safe
disabled result before starting a child or health server. There is no arbitrary
command argument or shell execution. Source credentials remain runtime settings;
do not put them in CLI arguments or log them.

For a deployment service manager, execute the Node process directly as its managed
process: `node scripts/marketing-worker.mjs facebook` or the TikTok equivalent.
Use a process-group/container termination policy so a forced host shutdown also
removes descendants. This repository has not installed that deployment service.

The supervisor listens on `127.0.0.1:4191/health` for Facebook and
`127.0.0.1:4192/health` for TikTok. Set `LABSD_WORKER_HEALTH_PORT` to another free
port if required. It binds before spawning; a port conflict fails without launching
a duplicate local lane. Cross-host or separately configured instances still rely
on native PostgreSQL leases to avoid overlapping acquisition.

The loopback endpoint accepts GET only and returns private process metadata:
platform, state, start count, last observed cycle time, whether that cycle reported
attention, and a safe restart reason. It returns 200 only after a cycle has
completed in the current process; startup, stopping, backoff and failure are not
healthy. Unknown paths return 404. Responses are no-store; the endpoint is not
public and exposes no shop IDs, source errors, tokens or report contents.

**Healthy means the worker process is making progress.** It does not prove current
platform data, successful imports for every shop, correct commission totals or
that an enabled shop exists. A cycle that finds no due work still proves process
progress. Use the native per-shop status/report freshness for data health. The
endpoint disappears when the supervisor exits; a monitor must treat refusal or
timeout as unavailable, not as the last saved healthy state. The independent
[one-shot process checker](worker-health-monitor.md) provides bounded loopback
validation and actionable exit codes; operations still owns its scheduling and
alert delivery. Optional [log capture](worker-journal.md) adds capture status and
returns503 if diagnostic storage is unavailable, even when process state is running.

## Restart and shutdown behavior

The actual child sends a tiny IPC message after a native cycle returns. Only the
expected two-field cycle/attention message counts as progress. Arbitrary output
does not reset the watchdog. Raw stdout/stderr are drained and discarded rather
than forwarded because dependency errors can contain sensitive information. The
supervisor emits safe structured state transitions instead.

If no cycle completes for 180 seconds, the supervisor sends SIGTERM. It gives the
child 15 seconds to finish cleanup, then sends SIGKILL if necessary. It waits for
the child's exit event before launching any replacement. Sending a signal alone
is never treated as proof that the child is gone.

Unexpected exit or a stalled process triggers exponential backoff from one second
up to 60 seconds. Five failures inside a rolling ten-minute window stop the
supervisor with exit 1. Slow failures outside that window can continue retrying;
this is a burst limit, not a lifetime retry cap. The deployment manager should not
override this with an unlimited immediate restart policy.

SIGTERM/SIGINT to the supervisor cancels further starts and stops the current child
with the same bounded shutdown path. Workers also abort when their parent IPC
connection closes. An OS kill of a blocked process cannot run JavaScript cleanup;
production process-group supervision remains required. No daemon is installed by
running the tests.

Restart resumes native durable planning and due work. SQL leases and publication
guards remain authoritative, including lease expiry after a hard stop. The
supervisor does not clear source cooldowns, recreate jobs, reset retries or discard
last-good observations. The worker loop's existing 15-second pause does not mean
each source is fetched every 15 seconds.

## Evidence and remaining deployment work

Real-child tests cover progress, clean shutdown, TERM-ignoring stalled children,
KILL escalation, burst termination, restart after exit, invalid IPC messages,
observer exceptions, spawn failure and cancellation during backoff. Test child
handles are cleaned up explicitly.

A native integration runs this CLI and its actual TikTok worker against the
project-owned PostgreSQL database and a real loopback owner HTTP service. It
observes an additional report acquisition, health 200 after the completed cycle,
safe logs and clean supervisor/child shutdown. Only platform API responses and
credentials are synthetic. Database binding is set temporarily and restored in
the isolated test target.

Real source service installation, account entitlement and credential provisioning,
OS/container service installation, external health monitoring, deployment kill
semantics, sustained load, retention and independent release review remain. This
is an executable local host with tested lifecycle behavior, not proof that a
production worker is running.
