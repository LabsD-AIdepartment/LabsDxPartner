# Video worker hard-stop recovery acceptance

This regression exercises the configured worker service in separate Node processes with the real PostgreSQL scan/window/lease/publication code and a real loopback owner HTTP server. Provider responses and credentials are synthetic. It is an extension to durable scan tests, not proof of live TikTok entitlement or production deployment.

Run with the pinned Node24 and the project-owned disposable PostgreSQL target:

```sh
LABSD_TEST_DATABASE_URL=postgresql://labsd_test@127.0.0.1:55487/labsd_partner_test node scripts/run.mjs test:integration tests/integration/video-resume.test.ts
```

The crash case normally takes over90seconds. It first publishes a last-good observation, starts acquisition of2101video records, commits the first100rows, and deliberately holds the second source page. The native planner skips the already-fresh day and chooses an outstanding day. The test records the actual staged window ID, verifies that this window has no published partial generation, then kills only its captured child with SIGKILL and waits for the process exit event. It verifies that the existing published day remains unchanged and a new claim cannot steal the live lease.

The test waits for actual database lease expiry, without updating lease timestamps or mocking clocks. A new process runs the same configured worker, resumes at the persisted page token, completes the remaining pages, then publishes. Assertions require2101distinct video IDs, exact large decimal amounts, no second request for the first page, a current generation on the exact resumed window, an unchanged last-good generation on the previously published day, and no remaining scan staging. The incomplete source page is correctly requested again. Test-owned child and server handles are closed in finally paths.

The child entrypoint is tests/helpers/video-worker-child.ts. It checks the explicitly supplied synthetic connection namespace rather than modifying the portal identity namespace used by the browser preview. This acceptance therefore covers the configured acquisition worker core and durable recovery across process loss. CLI credential namespace binding, supervisor restart/health behavior and production process-group shutdown have separate tests/acceptance; do not conflate them. This is one large synthetic scan, not a concurrent fleet throughput benchmark or a retention policy.

A platform cursor can expire while a worker is down. Existing invalid-cursor logic and separate durable scan tests cover bounded restart/hold behavior. Successful synthetic cursor recovery does not establish how long a real provider preserves its cursor or whether its data can shift during pagination. Keep those source-specific readiness checks before exposing a capability.

The process test also exposed a persistence defect hidden by the auth test pool: Drizzle changes the shared postgres.js JSON serializer, so a pre-stringified value bound directly to JSONB can become a JSON string in a standalone worker. Both publication paths now bind serialized JSON as text before PostgreSQL casts it to JSONB, for observations and generation metadata. Existing stored generations are immutable and are not rewritten by this fix; the normal reacquisition path produces a new corrected generation. The fixture failures remain local evidence.
