# TikTok Shop Video — durable daily scheduling

D072, 2026-09-10. Builds on the existing collector, SQL store and shared video UI.
The worker tick now executes planning -> due claim -> collection -> atomic publication
against the native database. It is callable by a supervised host, but no daemon,
live account, credential resolver or second token-refresh owner is installed by this batch.

## Responsibilities and execution

- `video-schedule.ts` defines validated shop-calendar windows and retry policy.
- `video-store.ts` owns persisted horizons, due times, account leases, attempts,
  immutable publication and partner revision advancement. `plan`, `claimDue` and
  `orderConnections` extend its worker-only interface.
- `video-worker.ts` exposes `runShopVideoTick(store, collector, options, signal)`.
  The injected collector must already own the verified source binding, signed
  transport, single credential-refresh owner and per-request quota enforcement.
- `video-cycle.ts` shares one publication/failure path between scheduled leases
  and explicit diagnostic acquisition. Automatic callers must use `claimDue`;
  the existing `claim(connectionId, period)` deliberately permits diagnostic re-fetch.
- Partner reads consult persisted freshness and never schedule source requests.

Example composition once the verified dependencies exist:

```ts
await runShopVideoTick(store, collector, {
  connectionIds: verifiedProfiles.map(profile => profile.connectionId),
  maxJobs: 5,
  budgetMs: 65000,
  policy: { historyDays: 90, recentDays: 7, recentSeconds: 3600, historySeconds: 86400 },
}, shutdownSignal);
```

These are configurable conservative defaults, not a provider freshness SLA. This
lane uses completed shop days (T-1): it does not promise same-day realtime TikTok
analytics. Portal polling and source acquisition have different clocks.

Each tick visits at most100 configured shops and attempts at most5 jobs by default,
with a65-second abort budget. At most one period per shop is attempted in a tick.
Persisted last-claim order prevents a small job budget repeatedly favoring the
same accounts across host restarts. A busy or cooling account does not block a
later shop. Native SQL binding failures before account processing abort the tick;
account-specific failures produce only safe source-error codes. Cancellation
stops further claims and uses the same failure/release path; a hard process death
recovers through the existing90-second lease expiry.

The host must supervise and repeat ticks, honor shutdown, surface non-actionable
idle/cooldown separately from meaningful incidents, and use database connection
and statement timeouts. The tick budget propagates to acquisition but is not an
absolute deadline for an already-running SQL statement. No browser route creates
such a host or resolves source credentials.

## Durable schedule

Migration0025 expands0024 with `video_schedules` and due/retry fields on existing
windows. The schedule owns one active shop-calendar horizon, profile digest,
connection revision and monotonic `plan_as_of`. Daily periods are disjoint and
exclude the current day in the configured shop timezone; DST does not turn a
civil day into a rolling UTC24-hour range. History is bounded to1–366 days.

Planning uses an account lock and one batched upsert. Replanning preserves due
times, attempts, last-good observations and provider cooldowns. Older plans are
ignored. Shrinking/moving the horizon stops new claims outside it without deleting
historical rows. Scheduled publication rechecks the current profile, connection
revision and horizon under the same account lock after source I/O has finished.
A revoked, replaced, expired or out-of-horizon worker cannot publish over its successor.

Successful publication resets attempts and schedules the next refresh from the
stored cadence. Failed temporary/throttled/not-yet-ready collections delay retry
60s,120s,240s,... capped at1h; a larger valid provider Retry-After always wins.
Provider cooldown applies to the account across all its windows. The collector's
existing per-request quota callback is still required: a lease is not a provider
rate limiter.

Access or invalid-source failures hold automatic collection across the shop,
including newly planned days, while that failed connection revision remains
current. A verified revision change allows replanning and retry. A page-limit
failure pauses only its period until an appropriate controlled recovery; simply
repeating a2000-video-limited collector cannot complete a larger collection.
Unchanged replanning does not silently clear these holds. Resumable large-shop
staging and an audited operator recovery path remain separate follow-ups.

Active scheduled reports past their due time display as stale while retaining
exact last-good values. Superseded connection evidence, expired workers and
account access/schema holds are stale too. Historical periods outside the active
refresh horizon remain retained evidence with their original fetched timestamp.
No financial ledger, payable amount or commission formula changes.

## Compatibility, rollback and evidence

Apply0025 before this worker code. All prior migration bytes remain unchanged;
0025 has a locally assigned numeric filename that must be reconciled against the
merge/deployment ledger before release. Existing observations/mappings are not
rewritten or deleted. Old direct-acquisition code is schema-compatible with the
additive fields, but must not run alongside the automatic scheduler because it
intentionally bypasses due selection. Rollback stops the new worker, retains the
additive tables and last-good evidence, then resumes the prior supported path.

Local verification uses the real store, collector, publication and member read
against owned PostgreSQL55487, with synthetic upstream responses. It covers
calendar boundaries, retry minimums, repeat planning, fresh-window skipping,
worker recreation, concurrent claims, expired-owner rejection, changed profile/
horizon fencing, shop holds, cancellation, cross-account fairness, source-error
redaction and partner stale projection. Existing Facebook sync regressions are
also exercised. Exact final counts and logs live in the D072 context receipt.

Remaining before live enablement: trusted TikTok provisioning and analytics
entitlement proof, single credential/refresh/quota composition, supervised runtime
and monitoring, large-shop collection, native browser/load acceptance and release
review. D071's frontend is complete local progress; this does not close P05 or
the original remaining finance, account/export, other-platform and release phases.
