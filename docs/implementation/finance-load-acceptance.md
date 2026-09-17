# Published finance load acceptance

Run separately from ordinary unit/integration tests using pinned Node 24:

```sh
LABSD_TEST_DATABASE_URL=postgresql://labsd_test@127.0.0.1:55487/labsd_partner_test node scripts/run.mjs test:performance tests/performance/finance-load.test.ts
```

The existing database guard requires the dedicated local endpoint and verifies that its data directory is inside the project. This test retains synthetic audited data and immutable financial generations. It does not migrate schemas, rewrite history, contact providers or access actual partner accounts.

The test creates 100 distinct partners with distinct authenticated viewers, publishes their catalogues, and runs 1,000 source rows each through the actual approval, import, reconciliation and statement publication services. It does not insert prepared financial aggregates directly into the read tables. Each partner has two earning clips, two earning dates and one issued period. The underlying database can contain earlier synthetic runs; workload assertions restrict themselves to the 100 new generation IDs.

For partner index `i` from 0 through 99, each line has base `100005 + 100*i` minor units and a 10% commission. Per-line half-away-from-zero rounding yields `10001 + 10*i` minor units. Source controls and test expectations use this independent closed-form arithmetic, not the application calculator. Rounding the summed base instead would understate each partner's commission by 500 minor units. Across the complete workload, the expected base is `10495500000` minor units and commission is `1049600000` minor units.

One hundred first-pass requests are followed by 400 measured warm requests, in batches of twenty distinct viewers, using the native Overview HTTP handler and the existing two-connection auth/database pool. Each partner is checked under four scopes: complete period, one brand, August only, and August plus that brand. Every response must match the expected commission and eligible base, organic channel total, sum of daily chart points, sum of both top clips, and brand totals. The already-issued unpaid obligation must stay unchanged when date or brand filters change. Cross-partner access and stale permission revision return 403, anonymous access returns 401, and a stale report generation returns 409.

Performance setup uses an explicit test-only persisted-session option in the shared fixture. Sessions are created through the identity adapter and signed with the synthetic test configuration; normal authorization and session validation still execute on every report read. This prevents the setup burst from benchmarking the login throttle. Existing tests default to the unchanged ordinary username/password login path. No production rate limit is relaxed, and this test makes no login-throughput claim.

Recorded local run on 2026-09-11: approximately 24.36 seconds to set up and publish the workload; warm handler p50 39.17 ms, p95 81.88 ms and maximum 126.60 ms; maximum response 2,739 bytes. First-pass p95 was 111.62 ms, but this is not a cold-cache measurement. The warm p95 gate is 500 ms and the response-size gate is 100,000 bytes. The ordinary Overview integration suite also passed its ten regression cases after the fixture extension.

The measured handler includes authorization, database queueing, query execution, projection and JSON consumption. It excludes browser rendering, TLS/network latency, provider acquisition and production hardware. The ordinary Overview regression suite ran during the early setup stage and had finished before timed report reads began. This is the planned initial 100,000-row / 100-partner / 20-reader local baseline, not a sustained-production capacity guarantee. [Controlled publication-overlap acceptance](publication-overlap-acceptance.md) now checks 20 concurrent requests across a held statement transaction and commit for one synthetic partner; it is a separate workload. Larger single-partner histories, cold starts, exports and browser-visible update latency still need their own acceptance evidence.
