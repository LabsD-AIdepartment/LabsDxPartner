# Web liveness and readiness

The web process now exposes two small operational endpoints. They are separate from the worker's loopback health service and never fetch a platform report or calculate earnings.

| Endpoint | GET result | Meaning |
|---|---|---|
| `/api/health` | 200 `{"status":"ok"}` | The web route can respond; no identity, database or provider initialization |
| `/api/ready` | 200 `{"status":"ready"}` or 503 `{"status":"unavailable"}` | The configured web mode passes its bounded dependency check |

HEAD preserves the status and has no body. Responses use `private, no-store`. Mutation methods are not supported. Public output contains no version digest, account, migration name, connection string, credential or underlying exception. These endpoints grant no access and do not replace authorization on application routes.

## Configured readiness

With identity disabled and all dependent web features disabled, the closed deployment is ready to serve its closed surface without contacting a database. If finance, marketing, TikTok-video or account-profile functionality is enabled while identity is disabled, readiness fails. With identity enabled, invalid configuration or unavailable runtime fails.

Enabled identity checks its existing credential namespace binding and every migration required by the current application artifact, in one read-only transaction using the existing ten-connection web pool. The lookup compares the expected binding digest and the required ledger IDs/checksums. It reads neither sessions nor business rows. Missing ledger/table, missing migration, wrong checksum or wrong binding means unavailable.

`db/required-migrations.json` is imported into the application bundle; SQL files are not read by the runtime probe. Before the project's build and typecheck commands run, `scripts/verify-migration-manifest.mjs` compares the exact ordered SQL file list and SHA-256 checksums against this manifest. A missing, changed or added SQL file without a reconciled manifest stops the command. When adding an ordered migration, update its manifest entry in the same reviewed candidate. Do not edit applied migration SQL or rewrite the database ledger to silence a readiness failure.

All required entries must match; additional later migrations are allowed for a compatible expand rollout. Compatibility still requires release testing. The check trusts the controlled migration ledger: it is not a full physical-schema drift scan or proof that someone has not performed out-of-band DDL or forged ledger rows. Migration execution, immutable-ledger discipline and application acceptance remain necessary. It does not prove data correctness, source freshness, private media availability or worker health.

## Bounds and recovery

Each web process permits only one underlying readiness operation at a time. Concurrent callers share it. Callers receive unavailable after a two-second deadline, including while waiting for a saturated pool. A timed-out operation is **not represented as cancelled**: it retains the single-flight slot until it actually settles, so repeated checks cannot accumulate queued database operations. A late success does not retroactively become healthy. Once the operation ends, a subsequent check can recover after a one-second result cache.

Settled results are cached for one second using a monotonic clock. The transaction applies local statement and lock timeouts of1500ms and500ms, which disappear when it commits or rolls back; ordinary web query settings remain unchanged. These limits bound each SQL statement, not the entire socket or pool lifetime. If the driver remains stuck indefinitely, callers stay unavailable and no replacement operation is created; process/DB recovery belongs to the operator. No new connection pool, timer daemon or monitoring service is installed.

Operators can use liveness for process response and readiness for traffic admission; a failed readiness response alone should not trigger unbounded restarts of a working process during a database outage. Check worker health and report freshness separately. A closed feature-flag deployment returning ready is not permission to enable partner exposure or publication.

## Verification — D117, 11 September 2026

- Eight unit cases across the web/probe and manifest suites passed: GET/HEAD/methods, disabled/inconsistent flags, generic failures, concurrent coalescing, deadline without query accumulation, late success, recovery, and exact manifest mismatch rejection. Manifest tests mutate only a newly created project-local copy.
- Four isolated PostgreSQL cases passed: actual existing binding; same-backend transaction settings restored; wrong binding; valid binding with a missing required future migration or wrong expected checksum; two-connection test pool deliberately occupied, one queued check times out,20 more callers do not enqueue more checks, and release permits recovery. No binding, applied SQL or migration-ledger value was changed.
- Full typecheck, isolated production build and fixture exclusion passed. All342 app/src files match the final frozen build `ChaELby6GYAfEir16WKP1`.
- Four separate built Next processes exercised closed flags (ready200), inconsistent flags, invalid config and wrong binding (ready503), while health remained200. GET/HEAD/no-store and unsupported POST were checked. All four processes were stopped and their exit results recorded.
- Actual trusted local HTTPS with enabled identity and the existing fully migrated database returned200 for health and readiness GET/HEAD. First recorded ready GET was74.79ms, including HTTP/TLS behavior; this is a single observation, not a latency percentile or production capacity claim.

The first review rejected a binding-only candidate because it could mark an incompletely migrated deployment ready. That candidate was never served in the owner's preview. The schema manifest/ledger check and regressions above fix that finding. Initial header and test-only reserved-handle failures remain in their original logs; accepted logs are explicitly named below.

Evidence: `.agent-work/20260911-web-readiness/`; `logs/unit-schema.log`, `integration-schema.log`, `typecheck-schema.log`, `build-schema.log`, `built-negative-schema.log`; `evidence/build-schema-verification.json`, `built-negative-schema.json`, `native-https.json` and final candidate/reviewer receipts. No external provider, production deployment, source-project change or financial mutation occurred. The previous local D115 build is retained; local HTTPS now routes to Next4204. Rollback is to a compatible code artifact; there is no data migration in this change.
