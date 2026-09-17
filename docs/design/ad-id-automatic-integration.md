# Marketing Ad ID registration and automatic integration

D052 · 2026-09-10 · planning and boundary reconciliation only. Product baseline: `5639938c92538e4fde722d8f1c728606e969f822`.

## Owner outcome and supersession

Marketing adds an Ad ID and selects Facebook, Shopee, Lazada or TikTok. After initial association to the celebrity/clip/deal, the system obtains and refreshes available data through authorized APIs without routine manual imports or repeated metric approvals. The owner subsequently removed the company Marketplace website from connector scope. Google Ads is also outside the selected scope.

This replaces the planned general source-review/approval UI as the next product batch. Existing reviewed-file imports, exact calculation, immutable statements and audit are preserved. Their current controls are not disabled or bypassed. Financial approval/publication automation remains a separate decision based on the authoritative financial source; saving an Ad ID cannot issue a statement or declare money paid.

## Marketing experience

1. From a celebrity's clip or deal, choose **Add ad**. Partner, clip and agreement are preselected from this context. From the general staff page, choose the target celebrity/clip/deal once.
2. Select one of the four platforms and paste the Ad ID. Reuse an already authorized account/shop connection. Auto-select when only one compatible connection exists; show an account/shop picker only when necessary. Never request a token for each ad.
3. **Find ad** performs a bounded authorized lookup and displays name, thumbnail/creative where supported, actual account/shop, status and recognized source object type. It must distinguish not found, access denied, unsupported report type and temporarily unavailable.
4. Marketing saves the association after seeing the resolved ad. This is a one-time mapping action, not approval of every metric refresh. Existing context and exact known mappings reduce repeated fields. No face/name matching to guess who earns commission.
5. Initial backfill and subsequent refresh run outside the page request. Show syncing, last successful update and a concise issue only when action is needed. Normal refreshes require no user approval.
6. Bulk pasting IDs can reuse the selected platform/account/clip later; it is a convenience after the single-ad flow is reliable, not a launch dependency.

One clip can use several ads. One ad may reference multiple media assets. Preserve source relationships, but only report creative-level values when the source actually provides them. A shared campaign/product total cannot be attributed in full to each celebrity. Ambiguous ownership stays unmapped until an explicit allocation/association is defined.

Keep partner Overview/Content/Transactions design, portrait, covers, minimum 16px typography and Day/Dark. Add data through shared components, not a new dashboard design. Partner-facing views show useful results and freshness; account tokens, retry settings and diagnostics stay staff-side. Spend/ROAS should be exposed only if the partner's agreement/capabilities require them, not because the source returns them.

## Four-platform capability plan

| Platform | Lookup/report path to verify | Boundary and acceptance limit |
|---|---|---|
| Facebook | Existing authorized system API if it preserves ad/account/creative/report provenance, otherwise Meta Marketing API | Validate access to the actual account and ad. No arbitrary ID lookup without account authority. Direct Meta documentation returned a fetch error during this research; public Meta-maintained Postman docs were available. Account capability has not been exercised in this turn. |
| Shopee | Scoped shop connection plus applicable Ads reporting API or an existing system's equivalent API | Existing local research names CPC ads performance endpoints but explicitly leaves in-house-app access unverified. Confirm current permissions, identifier type and whether reports provide ad/campaign/product grain. Seller order access is not proof of advertising report access. |
| Lazada | Scoped seller connection plus relevant Sponsored Solutions report or an existing system API | Current specific ad lookup/report contract and account capability remain unverified. Do not substitute shop sales for ad-level results or promise the same fields as Meta. |
| TikTok | TikTok API for Business for ads; distinct report handling for relevant GMV Max types | Official reporting docs distinguish ordinary auction reports and GMV Max. TikTok Shop order/finance access alone does not prove ads reporting access. Verify actual ad/campaign/video grain and permission before enabling the adapter. |

All four platforms belong in the planned selector. In mock mode all can be exercised with explicitly synthetic data. In native mode each platform is enabled only for verified supported connections/object types, with a clear unavailable reason for missing capability. Product support must not be confused with four live integrations already complete.

A landing URL, including a company website, can remain metadata fetched from an ad. It is not a fifth platform connector and does not by itself establish order attribution.

## Accuracy and automatic operation

- Canonical identity is platform + connection/account/shop + object type + external ID, all IDs retained as strings. A bare ID is not a globally unique object. Duplicate saves return the existing mapping; cross-partner assignments require explicit resolution and audit.
- Metric snapshots carry source, account, object grain, metric definition/version, currency, source timezone, reporting interval, attribution settings and report-time basis, data-through, fetch time, completeness and revision. A fetch timestamp is not a source freshness timestamp.
- Resolve the source's API semantics before designing exact concrete request/response schemas. Use an adapter capability description rather than forcing nonexistent fields into a generic report.
- Backfill all pages/chunks for the declared range. Incremental jobs reread a configurable lookback window for delayed or revised conversions and periodically reconcile historical ranges as permitted by source retention. The concrete interval/lookback depends on platform evidence and quota; no arbitrary freshness SLA is promised yet.
- Upsert a unique scoped report grain; never sum the same snapshot twice, overlapping windows or both breakdown and total rows. Incomplete jobs do not replace a complete published window. Replayed jobs produce the same result.
- Sum only additive metrics with compatible definitions/grain. Reach is not summed across ads/platforms; ratios use compatible numerator/denominator totals. Cross-platform attributed conversions are not deduplicated orders and must not be presented as a single unique-sales total.
- API failure is not zero performance. Retain last good data, mark stale/unknown, retry transient failures with bounded backoff/jitter and use isolated job leases. Permanent permission loss requests connection repair. Refresh tokens only where supported; token revocation or changed external grants cannot always be repaired automatically.
- Ad paused/deleted, creative changed, mapping changed mid-job, permission revoked, partial pages and delayed refunds must have explicit handling. Recheck mapping revision and authorization before committing a result. Keep history rather than rewriting past payee ownership.
- Financial amounts remain exact integers/decimal representations with currency scale. Current `Metric.value` is a JavaScript number including some THB fields; reconcile this contract before using it for money-bearing platform projections. Do not widen the scope into a silent current API rewrite.

## Separate performance from payable money

Platform-reported views, clicks, conversions and attributed value feed performance. They do not automatically prove paid, non-refunded orders or the contract's commission base. The earnings module continues to own exact entitlement under the agreed rule. The existing finance source owns payment and reversal evidence.

If an existing system API already provides authorized, finalized, attributed earning inputs at the required grain, consume it automatically and preserve its source approval/revision. Do not require Marketing to reapprove that fact on every sync. The current file-specific approval contract cannot simply be faked for API ingestion: introduce an explicit source-attested/versioned input contract with appropriate source authority and compatibility tests.

If order-to-ad/clip lineage is absent, show platform performance and existing trustworthy commission separately. Never fill the gap with the whole shop's sales or guessed attribution. A commission rule explicitly based on a platform metric needs a separately documented agreement definition; it is not inferred from this owner request.

## Change Mode boundary map

| Classes | Owner and change |
|---|---|
| B1 system/context | Portal registers ad associations and projects results; external systems/platforms own their reported facts. Four platforms only. |
| B2 domain, B3 module | Content/integrations own mapping and acquisition; earnings own entitlement; statements own issued obligations/settlements. No shared ad-import money writer. |
| B4 component | Shared marketing Ad ID form, resolved-ad preview, connection picker and sync-state display; reuse staff shell/forms/theme. |
| B5 package/build | Keep the current application and same-artifact command, no new package required by this plan. |
| B6 process/runtime | HTTP handles validation/registration/bounded lookup; durable sync jobs run as bounded scheduled commands with independent connection budget and leases. No provider fan-out during partner render. |
| B7 deployment | No new independently deployed service selected. Future scheduling uses the same known version; enabling each adapter is configurable. |
| B8 state authority | Platform owns metrics; Marketing owns explicit mapping; agreement/source owns entitlement; finance owns settlement. PostgreSQL owns portal projection/job state and audit. |
| B9 trust | Marketing session → current staff capability → allowed connection → external API; secrets stay server-side. Partner reads are separately restricted to the permitted partner and fields. Source text/URLs are data, not instructions or arbitrary fetch destinations. |
| B10 operations | Marketing handles registration/ambiguous mappings; connection owner handles access renewal; system handles healthy sync/retry/reconciliation; finance retains its existing role. Alert only persistent actionable failures. |

Acyclic direction: staff route/UI → registration service → mapping repository and adapter interface; bounded sync runner → provider/internal API adapter → validated metric projection; partner readers → scoped projection. Earnings consumes a separate authoritative financial input contract, not display metrics. No cross-project private-code imports or direct source SQL.

## Ordered implementation and evidence

1. **Registration contracts and shared mock UI (F07 + I01/I02 seam).** Add four-platform selector, context-bound Ad ID registration, resolved preview, deduplication and readable status using synthetic provider adapters. Test wrong ID/account, denied connection, duplicate, ambiguous mappings, creative-to-clip relationship and cross-partner denial. Preserve layout and original routes.
2. **First live adapter plus source capability discovery.** Start with Facebook as a proposed implementation order, not an owner-mandated platform priority. Check existing system API read-only before building duplicate acquisition. Prove account/ID/media/metric response with a scoped authorized connection when available. Inspect Shopee/Lazada/TikTok report-grain and grant availability concurrently as research, not proof of live support. No new connection or account grant is implicitly provisioned.
3. **Durable automatic sync.** Add additive versioned mapping/job/snapshot storage with uniqueness, leases, retries and lookback; connect scheduled selection to the existing bounded worker pattern. Prove pagination completeness, crash/restart, idempotency, revision races, missing-vs-zero, conversion restatement and source freshness. Reuse current change metadata for partner refresh.
4. **Remaining three adapters.** Implement one verified contract at a time. Add platform-specific reports including GMV Max when applicable; expose only supported grain/metrics. A missing provider capability does not block independent mock/UI work, nor permit fake live data.
5. **Automatic financial source composition.** Reuse existing authoritative API if it supplies sufficient earning/reversal controls; reconcile source-attested approval contracts and existing statement publication policy before automating them. Marketing is not a recurring finance reviewer.
6. **Acceptance and release.** Compare equivalent source report/API/portal values with the same filters, timezone, attribution and cutoff. Prove partner isolation, read-model speed, healthy incremental refresh, token-expiry behavior and field visibility. Complete outstanding native account/zoom/export and R01/R02 gates from the original plan.

## Compatibility, rollback and authority

This turn adds a design and updates local planning context only. No application code, data migration, API account calls, credentials, external write, scheduler or deployment is changed. Existing file import/native partner reads remain valid and available. Do not delete the importer/approval store or weaken its checks to accommodate new sources.

Future persistence changes must be additive migrations, never edits to applied migrations. Keep old native contracts working or use explicit versioning; exact metric decimal changes need coordinated producer/consumer tests. Roll back a new adapter by disabling registration/scheduling for it, retaining mapping/history and last good data with a truthful stale label. Existing financial data/closed statements remain unchanged. Unknown source authority, unavailable ad grain, mapping conflicts and wrong account rights stop publication of that affected slice rather than converting it to zero.

Planning is supported by the owner request. Real platform/account and financial-source acceptance remain pending actual evidence; no universal live-readiness claim follows from this document.

## Sources checked and limitations

- Current repo `src/contracts/content.ts`, reviewed-file adapter and `docs/runbooks/imports.md` establish the existing interfaces and approval limitation.
- [Meta-maintained Marketing API collection](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi): public reference retrieved 2026-09-10. No actual account API request was made.
- [TikTok reporting filters](https://business-api.tiktok.com/gateway/docs/index?doc_id=1751625296192514): official documentation search result explicitly excludes Shop-created Product/LIVE GMV Max from ordinary synchronous auction reports.
- [TikTok Business API reference](https://business-api.tiktok.com/gateway/docs/index?doc_id=1735713875563521): official reference lists a dedicated GMV Max Campaign report. Concrete selected report metrics/grain require further verification.
- Shopee/Lazada skills and Sale Dashboard integration docs are historical discovery pointers, not current account capability proof. Public documentation searches did not establish account-specific ad reporting access. Own Marketplace was removed by the owner before this design was finalized.


## Implementation checkpoint — 2026-09-10 (D058)

Step 1 is implemented locally: shared Marketing registration contracts/UI plus synthetic scoped adapters at /ops-preview/ads.42 focused tests, typecheck, production build and fixture exclusion pass; browser lookup/save/automatic simulated status and Day/Dark inspected. This updates implementation status only: actual provider adapters, native registration persistence, scheduled acquisition and partner metrics remain pending. Details and evidence limits: [Marketing registration receipt](../implementation/marketing-ad-registration.md). Original compatibility/authority statements above describe the planning-only D052 turn.
