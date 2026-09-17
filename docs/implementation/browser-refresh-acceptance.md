# Native browser automatic refresh acceptance

On 2026-09-11 the reviewed automatic-refresh fix was installed into the local synthetic HTTPS preview. The old D095 wrapper/Next processes were stopped only after the new D103 production build passed loopback readiness. Both old listener ports were verified free before the new wrapper bound the existing HTTPS origin. The existing celebrity browser session remained valid; no password reset, new browser cookie injection, identity rebinding or database migration was needed.

The local runtime now serves `https://127.0.0.1:4443` through the D104 wrapper to Next on `127.0.0.1:4196`, build ID `XxbV2GAYPjngP4Q4rvhEl`. It uses the isolated D103 build copy, not a replacement of the root `.next`. The old wrapper/artifact remain available for a scoped local rollback. This is a local dirty-tree acceptance artifact, not a protected-main production release.

## Observed journey

The actual browser loaded the native Overview for July–August 2026 with the original synthetic celebrity account. Initial commission, sales and unpaid balance were ฿37,360, ฿550,000 and ฿37,360. The portrait, six-clip trend and approved page layout remained present.

A guarded local script authenticated the existing synthetic marketing account and called the maintained settlement importer with a synthetic ฿10,000 payment record. It did not execute a transfer or call an external system. The script restricted the exact cluster, database, partner, single statement, empty initial settlement state and source identifiers. It verified the authoritative balance and revision changes after commit.

Without a browser reload, navigation or explicit refocus, the rendered Overview payout changed to ฿27,360. A supported reversal of that same synthetic record subsequently restored it to ฿37,360 automatically. Commission and sales stayed unchanged. The reversal required precisely the known original payment/allocation and checked the final authoritative balance. Both append-only test records remain in local history; nothing was erased to restore the balance.

| Event | Authoritative unpaid balance | Observed DOM update upper bound |
| --- | --- | --- |
| Synthetic payment | ฿27,360 | 15,257 ms |
| Synthetic reversal | ฿37,360 | 15,163 ms |

These bounds run from immediately before the maintained importer's transaction call to the first successful browser DOM observation. Commit completed within 23 ms and 17 ms respectively; the browser may have updated before observation began. These are two observed bounds, not exact paint times, averages or percentiles. No manual change to revision counters, polling clocks or the query cache produced the update.

This D104 run proves the real built client/HTTPS/session/revision-query/refetch/rendered-DOM path for one active local browser. On its own it does **not** close R01's healthy-session latency target under 100 partners/100k earning lines/20 concurrent reads, mobile LCP, actual upstream source lag, or production deployment acceptance. The synthetic settlement source has no measured external-provider latency. The separate D103 fake-timer tests remain the evidence for stalled/rejected-request recovery; this healthy browser run did not inject a network outage.

## Local state and rollback

D104 evidence and exact scripts live under `.agent-work/20260911-live-refresh/`; D103 source/build manifests and frozen reviewed hashes live under `.agent-work/20260911-refresh-recovery/`. Read current runtime ownership before acting: process IDs and port owners are observations, not permanent identifiers. For a local rollback, stop the D104 wrapper, verify its child and ports are gone, then start the retained D095 wrapper with its original root artifact and verify both listeners. Reverting code does not undo the two synthetic settlement history records; their net balance is already zero.

## D105: native browser updates during pilot read load

The same installed build and existing browser session were tested against real local HTTPS while 20 closed-loop readers rotated across 100 synthetic partners, each with 1,000 previously published earning lines. This uses the real Next listener, native authentication/session validation and PostgreSQL reads. It does not substitute direct route calls for HTTP. TLS validation used the local public CA; certificate verification was not disabled.

The fixture selector verifies one statement per partner, zero settlements, 100 distinct partner/user pairs and all 100,000 row amounts/base totals before load. Each response is checked against independent integer controls for that partner and filter: full period, one brand, August only, and brand plus August. Confirmed commission, eligible sales, trend sum, top-content sum, partner isolation and all-period unpaid balance must match. Synthetic session credentials remain in process memory. This measures already authenticated reads, not login throughput.

| Measurement | Observed result |
| --- | --- |
| Measured duration after warm-up | 106.5 seconds |
| Successful, individually validated Overview requests | 58,867 |
| Concurrent closed-loop workers | 20 |
| Partners / earning lines in selected fixture set | 100 / 100,000 |
| Requests per partner/filter combination | 146–148 |
| Warm HTTPS p95 / slowest request | 50.67 / 442.26 ms |
| Largest JSON response | 2,739 bytes |
| Synthetic payment → first observed payout update | ≤14,694 ms |
| Synthetic reversal → first observed payout update | ≤19,634 ms |

There were 8,127 measured reads overlapping the payment-to-observation interval and 11,464 overlapping the reversal-to-observation interval. Both intervals included all 100 fixture partners. The recorded request intervals show 20 outstanding reads at each importer-call start and each DOM observation. Browser navigation, reload, explicit refocus, query-cache manipulation and forced polling were not used during either event.

The authoritative synthetic celebrity balance changed ฿37,360 → ฿27,360 → ฿37,360, while commission ฿37,360 and eligible sales ฿550,000 remained unchanged. The importer verified the two exact D104 historical records before adding the D105 pair; four append-only synthetic settlement records now remain, net zero. There was no real transfer or provider call. All 100 load-created sessions were removed and their exact stored IDs verified absent after the owned worker stopped. The original preview and browser session remain running.

The source-to-DOM bounds begin immediately before the importer call. Its transaction completed in 34 and 47 ms; the page could have updated before the first observation. These are two conservative observation bounds, not exact paint times or a latency percentile. The p95 is warm local HTTPS request latency under this closed-loop workload. It is not cold-cache latency, 20 rendered browsers, mobile LCP, internet/WAN latency, a production capacity prediction, or evidence of upstream API freshness. The tested warm-query and two active-browser update cases meet the corresponding R01 budgets; those broader acceptance items remain open.

Evidence is retained in `.agent-work/20260911-browser-load/`: reviewed helper/script hashes, typecheck, raw per-request timing samples, API result, session cleanup, importer commits and actual browser snapshots. Two pre-load fixture defects were rejected before financial mutation: an incorrect membership column name, then accidental selection of an earlier overlap-test partner with two statements. Attempts and cleanup evidence are retained; the accepted fixture requires precisely one statement per partner. `tests/helpers/native-browser-load.ts` is a local acceptance harness tied to this synthetic fixture/preview, not a production task or ordinary CI test. Read the current handoff before rerunning; evidence is write-once and the D105 payment script intentionally rejects its already-used state.
