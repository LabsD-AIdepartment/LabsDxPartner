# Multi-period Overview history acceptance

The Overview data query now groups persisted earning lines by Bangkok day, content, disposition, earning kind, channel and rate **before** repeatedly projecting totals, graphs and top clips. Current partner-scoped clip metadata is joined after that reduction. This prevents repeated materialization and sorting of tens of thousands of raw lines for each summary.

Money remains the sum of already-rounded integer amounts; commission is never recalculated from summed bases. `source_rows` preserves original excluded/missing-metadata counts, and distinct rates remain visible as mixed rates. The query still executes as one data statement under the original authorized transaction and publication snapshot. Issued unpaid obligations remain independent of the selected income date/brand range. No cache, projection table, migration, index, provider request, database-wide setting or extra state writer was introduced.

## Evidence

A new guarded performance scenario issues 24 monthly periods from September2024 through August2026 for one synthetic partner, with5,000 lines per period:120,000 total. Every period goes through the normal approval, import, reconciliation and statement publication services. Financial aggregates are not inserted directly. The scenario preserves audited synthetic records, including cohorts from failed diagnostic runs.

The independent per-line controls are base `100005 + 100*month` minor units and10% commission rounded per line to `10001 + 10*month`. Across24months the base is12,138,600,000minor and commission1,213,920,000minor. Rounding each month's summed base would understate its commission by2,500minor. Five selections cover both annual halves, a range spanning partial months, and brand-filtered annual/partial-month ranges. Every daily point, top-clip amount, brand total, channel total, confirmed/base total and the all-period unpaid obligation is checked exactly. Uncovered dates stay unavailable; requests longer than366days are rejected as before.

| Stage | Transport / pool | p95 / result |
| --- | --- | --- |
| Original query | Native handler, fixture pool2 |1,778.17ms; failed500ms gate |
| Aggregate before repeated scans | Native handler, fixture pool2 |640.20ms; failed500ms gate |
| Aggregate day before metadata join | Native handler, fixture pool2 |569.96ms; failed500ms gate |
| Final query through built app | Native loopback HTTP, unchanged production identity pool10 |**224.34ms**, max260.33ms; passed500ms gate |

The pool was not increased in product code. The test originally measured its setup helper's two-connection pool; final acceptance uses the application's actual existing ten-connection runtime through the built router. Do not attribute the entire first-to-last latency difference to SQL alone. Each diagnostic run constructed an equivalent new24-period cohort; no earlier history was edited or deleted to improve results.

The actual annual data SELECT was214.883ms in the original EXPLAIN ANALYZE, with1,839temporary blocks written and5,083read. The accepted final full annual query was55.424ms with **zero temporary blocks**; the partial-date and brand-filtered plans were also captured. A test-local transaction proxy observes only the authorized Overview data SELECT and then explains that same SQL and arguments outside timed HTTP bursts. It does not enable global SQL debug logging or capture authentication/session SQL.

Final build `s87YfYH8djKL0oQq7axia`:100 measured requests in five bursts of20 after five warm-up selections, maximum JSON25,466bytes. All100 exact financial/graph checks passed. The dedicated native child stopped with its zero-provider-fetch acknowledgement, and its one temporary signed session was deleted through the creating identity adapter and verified absent. The existing synthetic setup actors/sessions and issued history remain under the prior fixture convention.

The local workload uses AppleM2/8logicalCPUs/16GiB and the existing project-owned PostgreSQL cluster. It is a concentrated one-partner history workload, complementary to the earlier100-partner baseline. It uses a warm database and plain proxy-side loopback HTTP, not disk-cold storage, TLS, browser rendering or production network evidence. Fresh process/TLS/source-to-screen acceptance has separate records. No real platform entitlement is required for this financial-query check.

## Verification and operation

`tests/performance/finance-history.test.ts` requires the isolated test DB URL, the existing private local identity config and the D109 isolated build in `.agent-work/20260911-finance-history/build-source`. It checks the build's Overview source matches current source, uses the normal bound native identity runtime and preserves existing credentials/settings. Run from the project root with pinnedNode24:

```sh
LABSD_TEST_DATABASE_URL=postgresql://labsd_test@127.0.0.1:55487/labsd_partner_test node scripts/run.mjs test:performance tests/performance/finance-history.test.ts
```

Accepted raw evidence: `.agent-work/20260911-finance-history/evidence/history-1789119733227.json`, all100timings and three full query plans; `logs/performance-native-first.log` records the completed passing test including final cleanup assertions. Earlier failed results are preserved separately. The source copy/build, fixture-exclusion check and full typecheck pass. Overview regression adds same-day duplicate exclusions and mixed-rate per-line rounding at Bangkok midnight, alongside existing missing metadata, bonus, adjustment, coverage and authorization cases.

Rollback is a compatible code rollback to the retained prior Overview implementation/build. It does not roll back any financial data. The remaining R01/R02 release requirements, operational log retention/alerts, broader restore and real provider readiness are not closed by this measurement.
