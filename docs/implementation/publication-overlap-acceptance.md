# Publication and concurrent Overview reads

Run with the pinned Node 24 runtime:

```sh
LABSD_TEST_DATABASE_URL=postgresql://labsd_test@127.0.0.1:55487/labsd_partner_test node scripts/run.mjs test:performance tests/performance/publication-overlap.test.ts
```

This uses the existing dedicated-database guard, native identity/session validation, approval/import/reconciliation services, statement publisher and Overview HTTP handler. It creates one new synthetic partner, two periods of 1,000 commission rows each and two earning clips. All working data remains in the project-owned test cluster. No production configuration, schema, provider connection or owner preview is changed.

The first period contains 1,000 lines with base 100,005 minor units and commission 10,001 minor units per line. The second contains 1,000 lines with base 200,005 and commission 20,001. Both use 10% per-line half-away-from-zero rounding. Independent literal controls require confirmed commission to move from 10,001,000 to 30,002,000 minor units and the combined eligible base to become 300,010,000. Two clips each receive half the rows. The final daily totals, clip totals, brand bases and unpaid balance are asserted independently; the test does not reuse the application calculator to derive its oracle.

There are four batches of 20 simultaneous requests, all using the same authenticated partner viewer:

- A reconciled second-period candidate has not been issued: every response must retain the first published period.
- The actual publisher is blocked by a separate transaction holding only this partner's statement-revision row. PostgreSQL activity and blocking-PID evidence must confirm that the publisher reached its revision insert/upsert. Its preceding statement insert, notification trigger and scope closure are still uncommitted. All 20 responses must remain the complete old snapshot, and a separate database connection must still see only one statement.
- Twenty requests are dispatched as the lock is released and the publisher commits. Every response must equal either the complete old snapshot or the complete new snapshot, including generation, earnings/settlement revisions, coverage, metadata and obligation. Mixed snapshots fail.
- After commit, all 20 requests must equal the new snapshot. A request pinned to the old report generation returns 409; the current generation returns 200. Exactly two issued statements must exist for this partner.

The import itself legitimately advances the earnings change counter while its candidate remains private. Therefore the old comparison snapshot is captured after candidate preparation; publication must advance earnings and settlement counters by one more step. Request IDs and wall-clock response timestamps are excluded from snapshot equality, but report values, source freshness and revisions are not.

The lock is released and the publisher/control connections are settled in `finally`, including assertion failures. The test neither alters application functions nor adds database triggers. Earlier attempts at holding the general change-metadata row blocked earlier in the existing notification trigger, so the harness now locks the statement-revision row to establish the intended point explicitly.

The first successful local run on 2026-09-11 returned 80 responses with p95 93.35 ms, maximum 112.93 ms and maximum payload 2,765 bytes. The first two phases each saw 20 old snapshots; both the commit-overlap and committed phases saw 20 new snapshots. The handler p95 gate is 500 ms; the payload gate is 100,000 bytes. The read/auth pool has two connections (one occupied by the publisher while blocked); the test adds a separate two-connection control/observer pool.

This verifies publication visibility and coherent handler responses during the controlled schedule. It does not prove every possible interleaving, a SELECT spanning the exact commit instant, multiple authenticated users, simultaneous settlements/catalogue edits, browser polling/render latency, cold-cache performance or production throughput. The separate [finance load baseline](finance-load-acceptance.md) covers 100 partners and 100,000 earning rows. Actual 200% browser zoom and saving a downloaded report into a permitted project directory remain separate acceptance items; the currently connected browser capabilities do not provide those controls.
