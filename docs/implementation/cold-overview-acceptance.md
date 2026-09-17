# Fresh-process Overview acceptance

The local production-build test on 2026-09-11 measured the **first API burst after starting each new Next process**, without an API warm-up request. It used five separate processes, twenty concurrent distinct partner requests per process, and the existing 100-partner / 100,000-earning-line synthetic population. This closes a process-start evidence gap; PostgreSQL and operating-system caches were not emptied.

| Measurement | Observed |
| --- | --- |
| First-burst requests | 100, across 100 distinct partners |
| New server processes | 5, each stopped successfully |
| Concurrency per first burst | 20 |
| API p95 | 164.61 ms |
| API maximum | 165.69 ms |
| Maximum JSON response | 2,832 bytes |
| Process launch to listening | 553.06–883.23 ms |
| Largest launch-to-listening plus corresponding request time | 1,047.97 ms |
| Test sessions removed and verified absent | 100 |
| Child provider fetch attempts | 0 |

The provisional first-use API budget is 1,500 ms and Overview payload budget is 100,000 bytes. The measured first-burst API values meet them. API timing includes lazy route loading, session authorization, pool/connection establishment, database reads, projection and response body/schema parsing. Process readiness is measured separately. Adding readiness and request duration describes this local sequential harness, not a measured serverless request waiting for deployment startup.

The artifact is the isolated D106 production build `lDDpRieBrnD-t6G1Eiu94`. Each child loads the existing built Next router, uses an OS-assigned loopback port, and receives only the existing explicit runtime configuration allowlist. Requests retain the original logical HTTPS origin and ordinary signed synthetic session cookies. The transport is proxy-side plain loopback HTTP, so this is not TLS latency, browser rendering or browser cookie-policy evidence. The owner-visible HTTPS service is not stopped or rebuilt.

The fixture preflight verifies 100 distinct synthetic partners and viewers, one unpaid statement per partner, no settlements, and 1,000 earning rows per generation with independently controlled amounts and bases. Every response checks the partner, confirmed commission, eligible base, organic/brand-ad breakdown, sum of graph points, top-clip sums, brand totals and unfiltered unpaid obligation. Four selections are balanced across each burst: annual range, annual range plus brand, August, and August plus brand. The annual selection contains the existing two months of fixture data; it does not prove performance over years of accumulated statements or daily points.

Hardware: Apple M2, 8 logical CPUs, 16 GiB RAM, same local machine and existing project-owned PostgreSQL cluster. This is a five-process local sample, not a production percentile guarantee. Other local development work may run on the same host. Database/OS disk-cold reads, large individual partner histories/query plans, mobile LCP and production network/load acceptance remain open. Warm native TLS and active-browser update evidence are recorded separately in [browser refresh acceptance](browser-refresh-acceptance.md).

## Reproduction and evidence

From this project root, use the pinned Node 24 runtime:

```sh
/opt/homebrew/opt/node@24/bin/node --import tsx tests/helpers/cold-overview-acceptance.ts
```

This is a local pilot acceptance entrypoint, not a generic production benchmark. It requires the retained D106 build and the project-owned synthetic environment/fixtures at the guarded paths in the helper. It rejects another origin, database location, build ID or fixture population. Runtime secrets remain in memory and are not emitted into evidence. It creates and then removes only its own synthetic sessions; it does not rewrite financial history, account permissions, source settings or the database credential binding. Do not change the guards to point it at actual customer data.

Each invocation writes a distinct timestamped result and child logs under `.agent-work/20260911-cold-overview/`. Accepted result: `evidence/result-1789118502457.json`, containing all 100 samples, each process readiness time, confirmed child stop and zero provider fetch attempts, hardware and session cleanup. Full typecheck passed. Existing production HTTP transport supplies bounded response reads, timeouts and child cleanup; no transport or product code changed in this batch.
