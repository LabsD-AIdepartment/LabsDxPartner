# Recurring acquisition and retained ad history

Local candidate D067, 2026-09-10. Extends the existing Facebook worker and native partner metrics. This does not enable a source account or deploy a worker.

## Behavior

An existing ad association remains useful after an ad is archived. The worker now requests an explicit `history` lookup purpose, while registration retains its default `registration` purpose. Facebook registration rejects ARCHIVED and DELETED objects. History lookup accepts ARCHIVED only if the account, exact object and one creative still pass the same identity checks. DELETED objects are rejected, including before report acquisition. The worker continues checking the creative before and after acquisition and preserves the last good stored report on source failure. This is an attempted read with verified identity, not a promise that Meta returns every archived report.

Daily planning previously committed each window separately and never stopped refreshing older windows. `createMarketingSyncStore.plan` now validates a bounded, contiguous calendar plan, serializes by account, and inserts/updates all windows, the acquisition floor and the plan timestamp in one SQL transaction. A plan older than or equal to the recorded observation timestamp makes no changes. Signal cancellation before commit rolls back the transaction. Source requests occur outside these transactions.

The existing default remains 90 reporting-calendar days: the most recent 7 refresh every 15 minutes and the remainder daily. These are candidate acquisition settings, not a source freshness SLA or a retention policy. The planner moves the job's `refresh_from` boundary as the calendar advances. A newer explicit plan may extend the horizon again. Windows wholly before the boundary are excluded from new claims and normal retry commands. No report, generation pointer or association is deleted. A report already leased may finish once; its window remains excluded from subsequent claims. A crashed worker's existing account lease expires through the normal lease mechanism.

Job summaries count only windows in the recurring horizon and retain the latest successful acquisition time across all windows. Historical source failures remain attached to their stored windows. Missing historical reports stay missing; stopping recurrence never turns unknown metrics into zeros or complete coverage. An out-of-horizon one-off correction workflow is not exposed in this batch; deliberate horizon extension is available to trusted orchestration.

Native partner reads continue returning authorized stored history. A successfully retained window is not classified as overdue merely because the scheduler stopped recurring work for it. The optional `automaticRefreshFrom` public timestamp lets the shared ad detail explain when the selected range includes history outside automatic refresh. This timestamp is separate from the source watermark and fetch timestamp. Unknown source freshness remains unknown. The approved shell, images, typography and financial totals are unchanged.

## Owners and files

- `marketing-ads/provider.ts`: internal lookup-purpose contract; callers without a purpose remain registration callers.
- `facebook/adapter.ts`: source status, ownership and creative validation.
- `sync-worker.ts`: history intent after an authorized durable lease.
- `sync-store.ts`: atomic planning, timestamp ordering, claim eligibility and job summary; no financial writes.
- `sync-plan.ts`: source-calendar windows and cadence; invokes one transactional plan.
- `connections.ts`: retries only active-horizon failed windows.
- `partner-read.ts`, `PartnerAdPerformance` and shared `AdPerformance`: dated history projection and explanation.

## Schema and activation

Additive migration `0022_marketing_refresh_horizon.sql` follows local 0021. It adds nullable `refresh_from` and `plan_as_of` together, a pair invariant, and a `(job_id,period_to,id)` index. Existing unplanned jobs with null fields retain previous behavior until planned. This local number must be checked against main and the target ledger before merge if either advances.

Migration was applied only to the project-owned PostgreSQL test cluster on port 55487; earlier migration checksums were verified. No applied migration was edited. Old code can read the expanded schema, but old workers do not honor the new floor. Stop old workers before enabling the new schedule. On rollback, keep the worker disabled until the chosen artifact's recurrence policy is explicitly reconciled; retaining the expanded schema requires no destructive down migration. Production SHA, grants and deployment are not established by these local checks.

Stored generations are immutable. A storage retention/deletion policy and archive/export operations require a separate decision; this batch does not silently purge evidence. Existing reporting-definition changes and arbitrary whole-period non-additive acquisition remain separate acceptance work.

## Verification

- 369 unit tests in 42 files passed, including archived-history identity checks, deleted-source refusal and shared historical disclosure.
- 209 integration tests in 21 files passed. Added native composition cases cover ACTIVE, PAUSED and ARCHIVED ads through the real adapter with a fake upstream. Rolling-horizon cases cover retained exact reports, restart claim exclusion, an already leased old report finishing once, concurrent/older plans, invalid and pre-cancelled plans, explicit horizon extension and partner history reads.
- Typecheck, production build and development-fixture exclusion passed. SQL migration checksums passed through 0022.
- Evidence: `.agent-work/20260910-sync-history/evidence/`. Focused first run: 39 unit and 43 integration cases; full results above are later.
- No actual upstream, account provisioning, production migration, deployment, real mobile/200% browser check or independent release review was performed. The changed historical disclosure is verified by shared component rendering and native response tests; no new browser screenshot is claimed.

## Source verification and limits

Read on 2026-09-10: [Meta's official JavaScript Business SDK Ad object](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/main/src/objects/ad.js) defines ARCHIVED/DELETED states and the ad insights edge. It supports the identity/status model; it does not prove this application's current grants or historical availability. Direct reads of Meta's storing-ad-objects and Insights documentation failed (unavailable / HTTP 429). Real archived report access remains an activation check. No third-party search snippet was treated as authoritative API behavior.

Next: trusted connection/grant provisioning, real permitted account/report proof when configured, worker health/supervision/load acceptance, then independently available TikTok Shop/Lazada/Shopee/TikTok Ads capabilities. Original finance integration, account/document journey, responsive/200% checks and release/recovery work remain in the main plan.
