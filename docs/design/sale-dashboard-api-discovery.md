# Sale Dashboard API discovery for Marketing Ad ID registration

Read-only discovery on 2026-09-10. Source checkout: `/Volumes/workspace/dev/web-apps/202605_Sale_Dashboard`, clean at `39cab21502729e63530cf749fcc563b5e25a0119` (Shopee raw order-item ingest S1, #55). The private source handoff still points to an older SHA; current source wins. This is source/document verification, not a fresh production/account/API probe.

## Outcome

Facebook has an implemented ad identity/creative/insights read path. Shopee, Lazada and TikTok have implemented store authentication, token lifecycle and acquisition, but their marketplace Ads reporting adapters are still separate planned work. Reuse the existing acquisition and connection ownership where possible; do not infer per-ad/per-clip attribution from shop, product or campaign totals.

| Platform | Implemented in current source | Ad reporting opportunity | Evidence still needed |
| --- | --- | --- | --- |
| Facebook | Graph v25.0 client, account/ad/creative reads, per-ad insights, Redis cache, background acquisition and daily/permanent facts | Best first candidate for a small read-only API bridge over the existing read service | Current account/ID access, complete response, explicit report timezone/attribution/currency and authorized partner mapping |
| Shopee | Open Platform v2 signed client, shop OAuth callback with state cookie, encrypted per-shop credentials, guarded refresh, order/item ingestion | Existing docs list CPC daily/hourly reports, product campaign reports and GMS campaign/item performance | Actual app Ads entitlement and exact report grain/field definitions; a product campaign ID is not automatically a celebrity clip ID |
| Lazada | Separate global auth/TH business hosts, signed client, seller connection, encrypted rotating credentials, order/item and finance acquisition | Existing app may already have Sponsor Solution group; investigate Sponsored Solutions report/campaign APIs using that app first | Current group status, seller participation and a successful report response at useful grain |
| TikTok | TikTok Shop client, per-credential app identity, shop authorization/cipher, encrypted tokens, shop/product analytics, order/settlement/returns | API for Business advertising and GMV Max reporting are a separate adapter surface | Advertiser access and appropriate Business app/token; creative/video-level report compatibility, not only campaign/shop share |

## Traceable source paths

All paths in this section are relative to the Sale Dashboard checkout above.

### Facebook

- `src/lib/integrations/graphClient.ts:24`: configured Graph v25.0 URL. `:166` follows paging links with a 50-page bound. Header authentication, budget gate, timeout and retry live in this client.
- `src/modules/ads-manager/facebook/adsRead.ts:494`: account/adset ad lists with IDs, name, account, campaign, creative, thumbnail and story reference. `:578` reads scope insights; `:606` reads entity insights including video/action metrics.
- `src/modules/ads-manager/adsQueryService.ts:61`: reusable read service wiring cached readers and token resolution.
- `app/api/ads-manager/ads/route.ts`: account/adset listing. `app/api/ads-manager/insights-rows/route.ts`: account + level + since/until. `app/api/ads-manager/_ads.ts:38`: staff-session `ads:read` permission gate. These are existing internal UI endpoints, not a ready-made restricted server-to-server celebrity API.
- `src/lib/integrations/tokenResolver.ts:16`: encrypted DB credential lookup; account-scoped misses do not fall back to another account's environment token.
- `src/modules/ads-manager/compositeMetrics.ts`: recent daily data and permanent facts use non-overlapping date slices. `cache.ts`: current hot TTL 30 minutes; settled-range TTL 7 days. These are source configurations, not measured freshness promises.

Accuracy concerns before reuse: some legacy projections replace absent metrics with zero or convert money strings to Number. The ad insights adapter warns at 500 rows; its old no-pagination comment conflicts with the shared client's actual paging loop. The actual client stops after 50 pages without a completeness flag. A portal bridge must explicitly report incomplete acquisition and preserve unknowns/decimal amounts. Do not copy the warning/comment as a platform-wide API limit.

Prefer exact-ID resolution with account validation over loading every account's ads for each Marketing lookup. For chart reads, serve the registered ad's filtered daily projection. Preserve provider IDs as opaque strings, enforce celebrity mapping on the portal server, and do not send staff-wide results or platform tokens to the browser.

### Shopee

- `src/integrations/shopee/client.ts:60`: HMAC request signing. Auth exchange `/api/v2/auth/token/get`, rotation `/api/v2/auth/access_token/get`; shop metadata `/api/v2/shop/get_shop_info`, orders `/api/v2/order/get_order_list` and `/api/v2/order/get_order_detail`.
- `app/api/auth/shopee/initiate/route.ts` and `callback/route.ts`: settings permission, authorization redirect, matching state cookie, store connection.
- `src/integrations/shopee/connectStore.ts`: seller/account-bound encrypted credentials. `tokenManager.ts:65`: PostgreSQL advisory lock protects token rotation.
- `src/lib/jobs/shopeeSync.ts`: daily 03:00 Asia/Bangkok configuration. `shopeeTokenRefresh.ts`: two-hour refresh checks. `worker/index.ts:1211` wires scheduled acquisition.
- `docs/reviews/2026-09-09-marketplace-uplift-plan.md:89` and `.agent-work/plans/shopee-docs/get_order_detail-and-modules.md`: recorded official-document discovery lists `get_all_cpc_ads_daily_performance`, `get_product_campaign_daily_performance`, `get_gms_campaign_performance`, `get_gms_item_performance`, plus AMS conversion-report candidates. Endpoint existence is not confirmed app entitlement or a verified clip-level response.

The old uppercase `docs/integrations/SHOPEE.md` mentions deleted server.js/MySQL and is stale against current code. Do not use its pending OAuth/sync statements as today's status. Do not run a second process rotating the same existing token pair: keep a single credential owner and consume its read-only data service.

### Lazada

- `src/integrations/lazada/client.ts`: HMAC-SHA256 of path + sorted parameters, uppercase hex; global auth at `auth.lazada.com/rest`, business calls at `api.lazada.co.th/rest`. Order/item and finance methods exist; a Sponsored Solutions report method was not found in this client.
- `app/api/auth/lazada/{initiate,exchange,callback}/route.ts` and `src/integrations/lazada/connectStore.ts`: current settings-gated connection flow, seller identity validation, encrypted credentials. Callback comments explicitly defer full OAuth-state binding, so do not copy it unchanged into a new public connection flow.
- `src/integrations/lazada/tokenManager.ts`: refresh under cross-process lock. `src/lib/jobs/lazadaSync.ts` and `lazadaTokenRefresh.ts`: daily 02:30 sync and six-hour refresh checks, wired in `worker/index.ts`.
- `docs/integrations/lazada-api-access.md:126`: historical 2026-06-13 console record says all 19 groups, including Sponsor Solution, were Active on the existing Seller In-house app. This is stronger than assuming permissions are absent, but it is not a 2026-09-10 entitlement check.
- The September marketplace uplift plan names Sponsored Solutions overview/metric reports as candidate work. Check existing app/seller capabilities first; request a new group/app only if actually required. Finance fees labeled Sponsored Affiliates are not a substitute for per-ad performance or this portal's agreed celebrity commission.

### TikTok

- `src/integrations/tiktok/client.ts`: signed calls to `open-api.tiktokglobalshop.com`, token endpoint on `auth.tiktok-shops.com`, authorization shops + `shop_cipher`. Implemented analytics routes include `/analytics/202509/shop/performance`, product performance and `/analytics/202605/shop_products/performance`; order, finance and return methods are separate.
- `src/integrations/tiktok/connectShops.ts` and `tokenManager.ts:29`: configuration bound to each credential/app; no arbitrary shared shop-app selection. `app/api/auth/tiktok/{initiate,callback,relay}/route.ts` implements current setup.
- `src/lib/jobs/tiktokSync.ts`, `tiktokOrderSync.ts`, `tiktokTokenRefresh.ts`: configured 02:45 analytics, 03:15 order/finance, six-hour refresh checks; wired worker jobs.
- Shop GMV Max/non-GMV-Max revenue shares already exist, but they describe the shop revenue distribution, not spend, orders or commission of one celebrity video. API for Business and a verified matching report are needed for the advertising path.

## Recommended integration boundary

Use Sale Dashboard as an upstream data provider where its verified report can supply the required detail. Keep the portal's stack and modules independent. A small read-only bridge can expose allowed connections, resolve an external identifier, and return per-identifier daily metrics plus source metadata. These are proposed operations, not endpoints already implemented.

The bridge must have its own restricted service identity and account allowlist; existing staff cookies/`ads:read` alone are not a celebrity authorization boundary. Sale Dashboard retains token refresh and upstream quota ownership. The portal retains celebrity/clip/agreement mapping and its own cached read model. If a report is not implemented upstream, add a provider adapter with explicit capability rather than present synthetic values as live.

Every response needs account, external identifier/object type, timezone, currency, requested interval, report attribution definition, source cutoff, fetch time and completeness. Translate the portal's exclusive end date explicitly to the source's inclusive date contract. Preserve absent values and decimal money; compute ratios from matching populations. Platform-attributed sales remain performance indicators until a financial source/contract establishes commission entitlement.

For D058, the four-platform mock remains useful, but its single `objectType=ad` / single creative assumption is provisional. If a verified Shopee/Lazada/GMV Max report is product/campaign-grain, adapt the identifier contract and show that grain explicitly. Do not silently allocate a campaign total across celebrity clips. That schema change is future implementation, not part of this discovery.

## Next bounded work

1. Verify existing connection capabilities without changing grants; Facebook exact-ID/creative/day-report first. Probe existing Lazada Sponsor Solution and Shopee Ads entitlement before asking for new apps. Check TikTok Business advertiser access independently of its Shop connection.
2. Freeze the small read-only bridge contract, including completeness, date translation and identifiers. Implement exact-ID lookup and persistent mapping through the D058 transport seam.
3. Connect bounded automatic refresh/backfill/retry and expose only supported metrics. Configure cadence by provider availability and usage budget; current nightly marketplace schedules cannot support an instantaneous source-data promise.

No Sale Dashboard edits, upstream calls, credential reads, production queries, grants or job execution were performed. No test suite was run for this read-only discovery. Source hashes are stored under `.agent-work/20260910-sale-dashboard-api-discovery/evidence/`.

## Public reference cross-check

- [Meta-maintained Ad Insights example](https://www.postman.com/meta/facebook-marketing-api/request/u07tack/get-ad-insights-l1) confirms an Ad ID insights surface. This verifies API shape existence, not current credentials.
- [TikTok API for Business reference](https://business-api.tiktok.com/gateway/docs/index?doc_id=1735713875563521) lists a dedicated `/gmv_max/report/get/` report. Specific supported creative/report dimensions remain to verify.
- [Lazada Open Platform](https://open.lazada.com/) lists Advertising separately from Orders and Finance; its detailed report page and Shopee's SPA did not yield readable current documentation in this web check. Their detailed endpoint candidates above are attributed to the repository's recorded research, not falsely presented as a fresh account test.

Meta's direct developer page returned 429; the Meta-maintained public collection supplied the cross-check. Public browsing made no changes to accounts or platform access.
