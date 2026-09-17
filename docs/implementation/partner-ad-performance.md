# Partner ad performance from published reports

Local implementation D066, 2026-09-10. P04 now has native authorized ad list/detail reads and shared V2 rendering. Actual source account activation, full-scale load acceptance and the remaining rollout tasks are still open.

## What partners see

The existing clip page links to its associated ads. The ad detail uses the same approved page shell and metric cards, adding exact totals, a trend chart, the platform's attribution/reporting definition and expandable period observations. Counts and money remain strings through the native DTO and display; only chart coordinates use approximate numbers. The chart breaks at unknown observations or missing intervals.

Platform-attributed orders/value remain visually separate from commission. Spend and ROAS are removed on the server without `view_ad_spend`, from both totals and period observations. The shared UI also filters them as a second display check. No account ID, connection ID, namespace, token reference or source response body is projected to the partner.

When the source's ad delivery status has not been collected, the page says it is unknown. It does not substitute connection enabled/paused for the ad's delivery status. Native ad counts are available on clip detail, without requiring an earnings publication.

## Read path and state ownership

`/api/v1/partner/content` preserves its existing identity/finance feature gate. Marketing reads are additionally selected by `LABSD_MARKETING_ENABLED`. With marketing disabled, previous unavailable ad behavior remains. With it enabled, ad list/detail use `marketing-ads/partner-read.ts` after the existing current-session/membership authorization. Staff source-account grants are not required for a celebrity to read a legitimately mapped ad belonging to their own active membership.

One data SQL statement reads the authorized partner/clip/brand, active target, immutable association/current mapping job, selected report generation pointers, counts and revision metadata. Removed clips and mismatched clip/ad/partner identifiers return not found or deny access. Paused connections retain readable last-good history and mark it stale. Source credentials/providers are never loaded for a page read.

The current association/target and marketing publication tables remain authoritative. No new table or migration was added. Finance retains its existing writer and earnings generation. The public `Ad` contract adds optional `performance` with a separately versioned V2 DTO. Legacy preview metrics remain supported, but native reports never downcast to their numeric V1 shape. Deployment must keep the marketing flag off until the compatible server/browser artifact is installed; older strict clients are not declared compatible with newly enabled payloads.

## Range and aggregation rules

- Select observations fully inside the requested Bangkok date interval. Never prorate an account-calendar observation that straddles a selected boundary.
- Prefer an exact-period observation over overlapping daily observations. Otherwise require compatible source identity, API/report version, attribution, action-report-time and source timezone, with disjoint periods.
- Reject overlapping reports, incompatible metric definitions and mixed currencies. Only current generation pointers are read; old corrections are not added a second time.
- Sum additive values with BigInt decimal scaling. Missing segments or missing metric values produce an unknown total with a reason; covered observations remain inspectable.
- Do not sum reach or ROAS over several windows. An exact-period source report may supply these values; otherwise show the per-period observations and explain why a total is unavailable. The daily worker does not currently request arbitrary whole-range reports just because the user changes a filter.
- Coverage is based on completed requested reports. It is not an upstream finality guarantee. Null source watermarks remain null; fetch time is shown separately. Account calendars other than Bangkok can leave boundary coverage incomplete and are not silently relabeled as Bangkok days.

List reads use 50 rows plus one continuation sentinel, ordered by creation time/UUID. The cursor binds partner, permission revision, earnings/catalogue generation, metrics revision, clip and brand. A changed revision rejects continuation rather than mixing two snapshots. Report projection is bounded to 1,000 input observations and 366 selected segments; overflow fails explicitly. The current clip library remains continuous; this implementation does not change that behavior.

## Automatic refresh

The existing partner change watcher invalidates metric-dependent queries. In addition to successful report publication, registration, connection operations and failed acquisition now advance the existing metrics revision in their successful database transaction. Replay does not advance it again. Finance revisions do not change.

The shared ad query hook also refreshes portal data every 60 seconds while active, so a stopped acquisition worker can age into stale status even if it emits no revision. Hidden-page background polling is not enabled. Source report windows more than 15 minutes past their next scheduled run are considered overdue for this read projection. Neither polling nor the grace period promises a provider realtime SLA. Source acquisition cadence remains separately configured in `marketing-sync-runtime.md`.

## Verification

Project-wide run: 368 unit cases / 42 files and 202 integration cases / 21 files passed. Subsequent affected checks passed: 12 native content/ad cases after adding native ad counts; 26 content/projection UI cases; final 5 native ad cases and 6 pure/UI projection cases after adding the public attribution definition. Typecheck and production build with development fixture exclusion passed.

Coverage includes owned read without finance publication, foreign partner/clip, stale permission revision, removed clip, exact wide values, missing segment/metric, overlap, non-additive reach, exact-period preference, mixed currency/definition rejection, spend redaction in all observations, pause/stale history, 52-ad pagination and cursor revision invalidation. Existing marketing registration/worker/connection suites were included in the broad run after their revision invalidation changes.

The native tests use real local authentication, HTTP handlers and PostgreSQL, with synthetic published reports. No platform API was called. Initial focused failures came from a fixture sending an empty `adId` on a list request and a fixture changing capabilities without advancing its permission revision; those fixture errors were corrected, with failed logs retained.

Measured baseline: 52 associations, two report observations for the detail under test, 20 authenticated in-process HTTP requests at concurrency four on the isolated local PostgreSQL cluster. Three runs produced p50 roughly 9.8–12.3 ms and p95 roughly 29.6–41.0 ms. EXPLAIN ANALYZE execution was roughly 0.19–0.23 ms for the small report fixture. These results exclude network/browser latency and do not prove production-scale latency, a large historical dataset or worker throughput.

Existing browser tab navigated from clip to ad detail and the explicit `platform-v2` scenario. It showed 120,000 impressions, 2,400 clicks, 42,000 video views, 120 platform orders, the chart and expandable period observations. Day/Dark inspected; measured viewport 1016 CSS pixels with document width 1016, paragraph/definition text 16px. This is shared synthetic rendering evidence; native HTTPS journey, mobile widths and actual 200% browser zoom remain separate acceptance items.

## Remaining work

P04 still needs broader native browser/range-change/load acceptance, verified real reports, and a policy for acquiring exact-range non-additive metrics when required. Source native delivery status is currently unknown. P02 trusted account/grant provisioning and live entitlement proof remain. P03 archived-ad acquisition, old-window retirement/retention and operational supervision remain. Shopee/Lazada/TikTok proceed independently as capabilities become available. Original account/document/export journeys, financial source integrations, recovery, independent review and deployment remain in the full plan.
