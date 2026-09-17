# TikTok Shop video acquisition — P05a

Follow-up: [D070 native persistence and API](tiktok-shop-video-persistence.md) adds
durable publication, staff mapping and partner reads. The status below describes
the original P05a acquisition slice; it is not the latest status of the whole lane.

Status: local collector and injectable signed transport implemented and tested,
2026-09-10. **No native TikTok registration, database publisher, runtime composition
or live account is enabled by this change.** Facebook remains the only installed native ad adapter. This is the first
bounded implementation slice of TikTok Shop Video, not completion of P05.

## What it supplies

`src/server/modules/marketing-ads/tiktok-shop/video-collector.ts` collects a shop's
video performance for a closed calendar interval through an injected authorized
request port. The collector fixes the official 202605 endpoint, local currency,
all creator account types, descending GMV and page size 100. It reads the entire
bounded result before returning any publishable observations. Schedule this once
per shop/period and share the validated result among authorized clip mappings;
never perform a whole-shop scan for each celebrity or page request.

The server-only contract in `video-contract.ts` deliberately retains separate
video semantics. It does not widen the Facebook-only `SourceIdentityV2`,
`SourceReportV2` or existing SQL constraints. No public DTO/UI migration is hidden
inside this acquisition step.

| Value | Interpretation / rule |
| --- | --- |
| Video ID | Opaque exact string, scoped by configured shop and namespace |
| Creator open ID | Stable provider identity; usernames and nicknames are display only |
| Views | Source video views, not ad impressions or reach |
| Paid SKU orders | Source SKU-order count; not unique ERP orders or eligible commission |
| Items sold | Source unit count, separate from orders |
| GMV | Exact source amount/currency; not payable commission, settlement or ERP revenue |
| Product CTR | Source decimal ratio; no summing/averaging across reports |
| Latest available date | Shop-local ready date, distinct from request completion time |

Missing/null measurements stay null, while reported zero stays zero. Money and
ratios stay decimal strings. Documented JSON integer counts are accepted only
within JavaScript's safe integer range before converting to strings. Larger
numeric counts are rejected rather than pretending precision can be recovered.
No spend, ROAS or commission is inferred from these observations.

## Completeness and failures

A publishable collection requires exhausted pagination, unique video IDs, stable
`total_count` and ready date across pages, a row count matching that total, the
configured currency and data available through the requested final day. A missing
video is not evidence of a zero-valued report. A complete empty collection contains
no video observations.

The local guardrails are 1–31 shop-calendar days, at most 20 pages of 100 rows and
a 60-second collection deadline. These are candidate application limits, not
claims about TikTok's quota or maximum history. Current/future shop days are not
requested. A source watermark behind the interval or the page cap returns partial
with **no publishable rows**; cap failures require a later bounded staging strategy
before larger shops can open. Transport failure after an earlier successful page
throws a safe error instead of returning those earlier rows. Repeated cursors,
empty pages with continuation, changing totals/watermarks, duplicates, malformed
metrics and incompatible creator identity fail closed.

The API does not document a transactional snapshot token. These checks detect
several changing-scan cases but cannot detect every same-count upstream change.
Do not describe this as a transactionally consistent source snapshot. Keep source
request IDs for operator evidence. They and all unrelated shop rows stay out of
partner responses.

## Transport and activation still required

The request port accepts only connection ID, fixed path, known query dimensions
and cancellation. The caller cannot provide a URL, token, shop cipher or arbitrary
fields. `video-transport.ts` supplies a tested fixed-host signed GET implementation;
it is not composed into the native application yet. It enforces 15-second request
deadlines, a 2 MB streamed-body cap, strict query dimensions, expected-shop matching
against the injected credential metadata, no redirects, safe errors and separate
HTTP/business-code throttle handling. Valid numeric/date Retry-After minima are
preserved. It resolves the exact credential snapshot, then calls the required quota reservation hook with its app/shop identity before any upstream fetch (D080).
These are injectable dependencies, not a newly installed credential owner or quota
store. Before runtime composition:

1. Bind the configured connection to a currently authorized exact shop, currency
   and timezone, checking mapping/config revisions around acquisition. This
   endpoint's result does not itself echo shop identity, so configuration alone
   cannot serve as account verification.
2. Use the existing credential/refresh owner where possible, through an explicit
   restricted bridge. The existing Sale Dashboard staff-session routes are not
   that bridge. Do not copy or concurrently rotate its credentials.
3. If a separately owned direct connection is selected, wire the signed transport
   to that credential resolver and shared quota owner. The durable worker owns
   retries; the transport never refreshes tokens or loops on an authorization error.
   Unknown source errors remain safely classified without message parsing.
4. Prove the exact account has `data.shop_analytics.public.read` and this video
   endpoint available. Shop order access is not analytics entitlement.

Then implement a backward-compatible video association and publication lane:
explicit shop + video + creator identity; configured/verified capability; a single
durable acquisition per shop/period; staged validated publication; mapping and
permission recheck; scoped partner projection using existing components. Marketing
must see a **Video ID** label for this capability, never an Ad ID label pretending
the identifiers are interchangeable. A video associated with multiple paid ads
must not have whole-video performance repeated as each ad's performance.

Activation should remain independent of Facebook, Shopee, Lazada and TikTok Ads /
GMV Max. This collector does not prove paid advertising access. Preserve all
existing approved layouts, imagery, typography, invitation login and finance
ownership.

## Evidence and sources

Collector author tests cover 32 cases: full pagination, precision, null/zero, partial-ready
dates, drift, duplicates, count mismatch, wrong currency, creator identity, bounds,
shop-calendar/DST behavior, redacted failures, throttling and cancellation/deadline.
Additional transport tests verify a separately constructed signature input, token
header placement, query/path rejection, wrong-shop binding, HTTP/business errors,
Retry-After date minimum, streamed size limit, malformed JSON and stalled-body
cancellation. A composed collector/transport test uses a synthetic fetch response.
Full suite and build results are in the D069 local receipt. No database migration
or database test was necessary for these isolated new files; no browser change is
claimed. Independent release review and real account acceptance remain open.

Primary reference: [Get Shop Video Performance List 202605](https://partner.tiktokshop.com/docv2/page/get-shop-video-performance-list-202605),
retrieved 2026-09-10 including the complete response schema and scope metadata via
the public documentation API used by that page. [TikTok's May 2026 analytics
announcement](https://partner.tiktokshop.com/docv2/page/kpkfccsa) describes creator
identity additions and next-day data availability. Also checked the current
[signature guide](https://partner.tiktokshop.com/docv2/page/sign-your-api-request),
[common errors](https://partner.tiktokshop.com/docv2/page/common-errors) and
[rate-limit guidance](https://partner.tiktokshop.com/docv2/page/rate-limits).
The KB `tiktok-shop-api` and
Sale Dashboard client supplied local context, not fresh live permission proof.

Source-project refresh checked HEAD
`759a3c335bbfc8978a69e768ad43c3ab215ac7dd`; differences from the D059 discovery
snapshot concern Shopee order/product rollups, not a new video reporting reader.
No source-project edits, source-account calls or credentials were copied. Local
public-document evidence: `.agent-work/20260910-source-readiness/raw/`.
