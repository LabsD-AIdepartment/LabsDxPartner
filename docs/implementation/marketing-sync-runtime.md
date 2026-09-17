# Marketing acquisition runtime — D064

Follow-up: [D077 process supervisor and health](marketing-worker-supervision.md)
adds an executable foreground host for both acquisition lanes. Deployment service
installation remains separate from this local implementation.

The P03 queue now has native provider composition, persisted request controls, daily planning and an executable worker. These are local implementation results; no real Facebook account or production scheduler has been activated.

## Runtime entrypoints

- `npm run marketing:sync` performs one bounded cycle: plan one eligible association and acquire up to8 due reports, with a60-second cycle signal and the existing25-second provider deadline. Database cleanup is subject to its own bounded timeouts.
- `npm run marketing:sync -- --continuous` repeats the same cycle after a15-second pause. SIGTERM/SIGINT stop further acquisition and close the small database pool. Process supervision/restart belongs to the deployment environment; the command does not install a cron job, daemon or desktop automation.
- Both modes return `disabled` without opening a database or upstream connection unless `LABSD_MARKETING_ENABLED`, `LABSD_MARKETING_SYNC_ENABLED` and `LABSD_FACEBOOK_READ_ENABLED` are all explicitly `1`.

The worker requires the existing identity namespace binding, configured profiles and injected credentials. It uses its own PostgreSQL pool capped at2 connections; it does not start the web server or import its singleton. Namespace validation runs before planning/acquisition and again before publication. Logs contain cycle counts, safe state and a generated request ID; they exclude source payloads, credentials and database errors.

The native web handler now obtains the same configured registry through a lazy marketing factory in the existing server composition. Optional provider configuration is evaluated when the marketing route is used, so an invalid Facebook configuration does not prevent ordinary login. Existing staff capability/account grants still govern lookup and registration. The registry remains empty with the Facebook flag OFF or no available injected credential; no profile automatically creates a connection or grants access.

## Shared request controls

Migration0020 adds `request_limits`, a per-window cadence and planning/claim timestamps. Applied0019 remains unchanged. Every configured Facebook lookup/report request passes through a PostgreSQL-backed gate that checks the exact connection ID, namespace, account ID, enabled state and verified timestamp against the server profile.

Two buckets pace requests: a conservative portal-wide Facebook bucket at one reservation per200ms and a connection bucket at one reservation per500ms. These are protective implementation defaults, not provider entitlement or a throughput guarantee. Waiting occurs outside transactions and supports cancellation. A restarted process observes the existing reservation/cooldown.

App usage headers can cool down all Facebook accounts; account/business usage cools down the affected connection. An unrelated account can continue when only one account is throttled. HTTP429 and throttle errors inside HTTP200 persist a cooldown even on a staff lookup, where no worker exists to record a failure. A later lower usage observation never shortens the cooldown. Malformed later headers cannot erase previously parsed app usage. Future multi-app routing may partition the conservative app bucket after actual app/account ownership is recorded.

The source transport consumes/drops a response if quota recording fails, and exposes sanitized errors. Profile configuration contains secret environment-variable names; values are supplied at runtime. This implementation does not copy tokens, rotate another project's credentials, create grants or mutate advertising campaigns.

## Scheduling and freshness

The planner visits one active registered association per cycle, in least-recently-planned order, and refreshes its plan after15 minutes. It schedules exact account-calendar days, most recent first. The default history horizon is90 days, configurable with `LABSD_MARKETING_HISTORY_DAYS` from1–366. This is the explicit initial acquisition horizon, not a claim that older history has been imported.

Today and the previous6 days refresh on a15-minute per-window cadence; older planned days reconcile daily. Today is a complete *request* for the current calendar date, not a finalized business day. Source data may still change and the source watermark remains unknown. The planner converts midnight using the configured timezone and accounts for23/25-hour daylight-saving days; it rejects unsupported/nonrepresentable calendar midnights.

Repeated planning updates cadence without duplicating windows or clearing actionable failures. Account claims prefer the least-recently-claimed connection; within an account, recent windows take priority over deep backfill. This gives current partner data a path to update while history is loading. Actual queue delay and API throughput still require load measurement; the cadence is not an SLA.

Existing reports outside the configured planning horizon are retained. Retention and explicit retirement of old recurring windows are still required before long-running production operation. No destructive cleanup is included here.

## Publication checks

The worker now inspects the creative both before and after report acquisition. A changed creative stops publication and creates an actionable mapping failure. A changed source revision with the same creative is retried automatically, because ordinary ad metadata changes should not force staff to repair an unchanged clip relation. These checks do not make an external API transactionally consistent; actual provider evidence remains part of activation acceptance.

P03's lease/current-binding/atomic-generation checks and metrics-only revision behavior remain in place. Archived/deleted ads still use the conservative resolver and need a dedicated existing-association history path. P04 must read authorized generations and must not sum overlapping windows, daily reach or ratios into a false range total. Platform metrics remain separate from commission and payment balances.

## Remaining rollout work

1. Explicit connection provisioning and verification/recovery controls, including a practical staff status path and persistent source configuration ownership.
2. Existing-association archived history, retention/window retirement and actual provider account semantics/entitlement.
3. P04 native partner metric queries, range definitions, shared rendering, source control totals and load/latency evidence.
4. Supervisor/deployment configuration, production namespace/credential installation, independent release review and owner-approved activation.

The original account/document/export journey, other ready platforms, observability, backup recovery and release requirements remain open. This runtime implementation does not close the overall project goal.

## Verified local evidence

Final full integration suite:189 cases in19files. Full unit suite:359 cases in40files. Typecheck and final production build/fixture exclusion pass. Seven new runtime integration cases cover account/app cooldown, pacing/cancellation, connection binding, HTTP429 and error-in200, and configured composition -> daily plan -> real adapter with fake fetch -> atomic report. Four calendar unit cases cover Bangkok boundaries, both DST transitions and invalid horizons/zones. Two additional queue cases verify creative/revision changes after acquisition; a new transport case prevents malformed headers from erasing app usage. Both one-shot and continuous executable modes return disabled with the flagOFF and perform no connection setup.

Migration0020 was applied only to isolated project-owned PG55487 with all earlier checksums verified. Current code/evidence/context packet: .agent-work/20260910-p03-runtime/. No browser/real-API/production activation acceptance was inferred.
