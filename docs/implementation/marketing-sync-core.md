# Durable marketing report acquisition — P03 core

Implemented and verified locally on 2026-09-10. This is a server-side queue and publication core, not an activated periodic service or live Facebook connection. D064 adds lazy native runtime wiring, quota controls and the executable/daily planner; see marketing-sync-runtime.md for current status. No source account is activated; the development preview continues to use synthetic data.

## What this delivers

Registration already commits an association and an acquisition job together. The new store schedules explicit reporting windows beneath that job. A window is identified by job, exact start/end instants, timezone and a hash of the complete report definition. Repeated scheduling returns the same window. Different or overlapping periods are separate reports; their totals must never be added together simply because both exist.

`createMarketingSyncStore(sql)` owns scheduling, leases, retries and publication. `createMarketingSyncWorker(store, providers)` executes at most one leased report per invocation. The worker receives an explicit server-configured connection allowlist. No HTTP route accepts these orchestration commands, and no partner page calls an upstream API during rendering.

The dependency direction is shared contracts → provider adapter and queue store → bounded worker. The queue has no Facebook transport dependency; `SourceReadError` supplies provider-independent sanitized failure categories. The Facebook adapter retains its previous error export as an alias. Finance modules remain the only writers of commission and settlement facts.

## Durable state and transaction boundaries

Migration `0019_marketing_sync_reports.sql` adds three structures, without changing applied migration0018 or any financial table:

| Structure | Responsibility |
| --- | --- |
| `connection_runtime` | One acquisition lease per connection and persisted throttle cooldown |
| `report_windows` | Idempotent report scope, due time, attempts, lease and current-generation pointer |
| `report_generations` | Immutable normalized complete report and SHA256 digest |

The same-window foreign key prevents a pointer from referencing another report window. Existing registration-job status is summarized from its windows for the current staff interface. Its source watermark stays unknown: a successful fetch time is not proof of upstream data freshness. Successful publication advances only the partner's `metrics` revision through the existing revision service.

Claiming uses short PostgreSQL transactions and `FOR UPDATE SKIP LOCKED`. One account can have only one report acquisition in progress, even when separate worker processes compete. Another account may proceed independently. An expired lease can be reclaimed with a new random token; the previous worker cannot publish or release the new owner's lease.

Provider I/O happens outside database transactions. The worker bounds the provider phase to25 seconds, below the minimum30-second configurable database lease; default lease is120 seconds. Cancellation also fences adapters that ignore AbortSignal. A late provider promise does not publish after cancellation.

Before publication, the store locks and rechecks the current connection, target, partner and clip. Disabled connections, suspended partners, removed clips, inactive targets or changed target/connection revisions reject publication. The report identity, window and exact API/report/attribution definition must match the lease. Generation insertion, current-pointer change, job status and partner revision commit together. A failed transaction rolls them all back.

## Correctness and recovery

- Only a validated complete report with exhausted pagination is eligible for publication. Partial/unavailable acquisition keeps the last complete generation and schedules a retry.
- A late correction replaces the current pointer; it does not add corrected and previous values. Both immutable generations remain available as evidence.
- Monetary and count values remain exact strings inside the report. No float conversion, commission calculation or payout write is introduced.
- Transient failures use persisted exponential delay, starting at60 seconds and capped at one hour. A longer provider retry hint is honored up to seven days. There is no immediate retry loop.
- Throttling also persists an account cooldown, affecting other windows for that account. A failed account does not prevent another account from claiming work.
- Access failures, missing objects, invalid source evidence or eight failed attempts produce `needs-attention`. Only a safe category is stored; raw upstream messages, URLs and tokens are excluded.
- The worker checks the registered creative before requesting metrics and refuses a changed/ambiguous mapping. Staff-account grant removal affects staff access; it does not automatically revoke a previously agreed background association. Connection/target controls own that lifecycle.

## Verification

15 new PostgreSQL integration cases cover registration-to-worker publication, exact large decimal preservation, metrics-only revision changes, immutable reports, schedule deduplication, concurrent workers, service recreation, lease expiry and fencing, partial-result retention, correction replacement, connection/target/partner/clip changes during acquisition, definition/period/identity mismatch, account cooldown/isolation, changed creatives, cancellation of a noncooperative adapter and atomic rollback.

The complete suite passed180 integration cases in18 files,354 unit cases in39 files, typecheck and production build including fixture exclusion. Migration0019 was applied only to the project-owned isolated PostgreSQL cluster on55487. All prior migration checksums verified. No production migration or real upstream request was performed.

## Remaining work recorded at D063

D064 implements request-level quota hooks, native adapter composition, the bounded executable and daily/lookback planning from items1–3 below. The current activation gaps and verification are in marketing-sync-runtime.md. The following list preserves the D063 handoff scope.

1. Implement persistent request-level usage-header quota controls for both staff lookup and worker acquisition; the current core persists worker throttle failures but is not the complete P02 quota-hook installation. App-wide limits also require coordination beyond one account.
2. Complete explicit connection provisioning/verification and install the adapter behind the existing OFF switches. Keep one credential/acquisition owner; do not copy another project's production credentials.
3. Add the bounded executable and scheduling policy that plans daily backfill, recent lookback and reconciliation windows. The900-second refresh default applies only to explicitly scheduled windows, is a local implementation default, and is not a promise of provider freshness.
4. Add controlled retry/recovery after staff repairs an actionable exception, report retention, and bounded operational cleanup. Never delete the current generation as part of cleanup.
5. Verify archived-ad history and creative changes during acquisition against the concrete provider behavior. Current worker metadata lookup uses the conservative registration resolver; archived/deleted objects stop rather than inventing a mapping. Pre-fetch creative checks do not establish an upstream transactional snapshot.
6. Implement P04 authorized partner metric queries selecting a consistent generation and correct requested scope, with no summing overlapping periods, reach or ROAS. Verify load, query plans, source control totals and the existing responsive UI.

Rollback for this local additive slice is to stop invoking the worker and keep native activation OFF. Retain associations, windows and report evidence. A code rollback does not require a destructive down migration. No independent release review, deployment, live account entitlement or mobile/200% acceptance is claimed by these backend tests.
