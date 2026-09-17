# Synthetic video fleet and report load acceptance

Run the separate performance suite with pinned Node 24 and the project-owned disposable PostgreSQL cluster:

```sh
LABSD_TEST_DATABASE_URL=postgresql://labsd_test@127.0.0.1:55487/labsd_partner_test node scripts/run.mjs test:performance
```

The database guard checks both the connection target and its actual data directory. Temporary files and caches stay under the project. This command creates synthetic accounts and immutable report generations; it does not clean up published evidence or run migrations. Use the dedicated test cluster, never a provider account or production database. The normal unit and integration suites exclude this workload.

The workload uses 100 synthetic shop profiles, 1,000 observations per shop, and four concurrent worker instances with separate PostgreSQL pools capped at two connections each. The authenticated read pool has a further two-connection cap. Each worker uses the real bounded tick, scheduler, account leases, durable page cursor and atomic publication path. The source is an in-process synthetic page reader; no platform credentials or provider network traffic are involved.

One source request deliberately waits while a peer worker advances five other accounts. All shops reuse the same video IDs, but have distinct shop/namespace identity and reported views. The test verifies no overlapping source requests for one account, exactly ten ordered page calls per account, all 100,000 published observations as JSON objects, exact decimal preservation and no remaining staged scans. Source calls never run as part of a page read by the celebrity.

After publication, the test grants the synthetic marketing actor one selected account, uses the real lookup/save service to map its clip, and calls the native authenticated report HTTP handler. One hundred measured requests run in five batches of twenty. Every response must expose only the selected mapping's expected values; anonymous access is rejected and another unmapped clip returns no report. All requests include authorization, database queueing, query execution, projection and JSON response consumption. Warm p95 must remain at or below the planned local 500 ms budget.

On the recorded 2026-09-11 local run, 100,000 observations across 1,000 source page calls completed in approximately 5.14 seconds. The report handler measured p50 11.92 ms, p95 19.74 ms, maximum 21.32 ms, and maximum response size 778 bytes. The first measured request was 5.79 ms; it is not a cold database/cache measurement. Exact machine-run evidence remains in the project context's D097 work area.

These figures describe local synthetic marketing data and one authenticated partner with one selected mapping. They exclude browser rendering, TLS/network latency, provider delays and quotas, production hardware and sustained competing workloads. Four worker instances are test concurrency, not a recommendation to bypass the provider's single credential/quota owner. This does not complete the separate planned 100,000 earnings-row / 100-partner financial workload, many-period/many-mapping query acceptance, real-provider throughput or production capacity planning.
