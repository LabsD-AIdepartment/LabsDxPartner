# TikTok Shop video frontend — local candidate

Updated 2026-09-11. Continues the collector and native persistence described in
[tiktok-shop-video-persistence.md](tiktok-shop-video-persistence.md).

Marketing uses a dedicated Video ID form, alongside existing ad registration.
Select an agreed clip and a permitted shop, inspect the source title and creator,
then confirm the mapping. A video is never coerced into a Facebook Ad ID.
Typing the clip/partner search loads at most 100 matching targets after 250 ms;
`hasMore` prompts a narrower search. SQL treats the search as literal text.
The options endpoint returns only granted TikTok Shop Video connections; a shop
is selectable only after a complete report at its current connection revision.
This is discovery of stored evidence, not live verification of API entitlement.

## Registration usability follow-up (2026-09-11)

Search trims surrounding whitespace and waits 250 ms before loading matches. The
form hides old choices during that delay and while new options load. No matches
shows a specific message; clearing the search restores the choices. The development
adapter now applies partial, case-insensitive matching rather than returning the
same clip for every search. Native literal SQL matching and API schemas are unchanged.

Temporary option-loading failures show a retry action. HTTP 401/403 asks the staff
member to reauthenticate; 404 explains that the integration is not enabled. Those
three statuses stop scheduled options polling and offer no redundant retry action.
Lookup/save authorization, source receipts and idempotency stay with existing services.

Focused tests: 42 cases across video UI, ad registration and connection controls;
TypeScript passed on Node 24. Existing browser preview verified unmatched and
partial searches, surrounding whitespace and video lookup/confirmation/save.
Measured CSS widths 280, 375, 540, 800, 1100 and 1440 in both themes had no page or
form-control horizontal overflow and inspected form text remained 16px. Browser
zoom affected requested viewport sizes, so evidence records actual DOM widths;
this does not prove 200% zoom or native authenticated/live-platform acceptance.
Temporary viewport and theme changes were restored. No database or API calls to
platforms, production activation or release occurred in this follow-up.

## Contracts and ownership

- `src/contracts/shop-video.ts` owns public response and request schemas.
- `src/features/shop-video/transport.ts` owns HTTP transport and response binding:
  partner, permission revision, clip, date range, duplicate mappings, ordered
  disjoint source series, staff actor, target and saved result. Requests are copied
  before transport injection, and responses are rejected after cancellation.
- `ShopVideoRegistration` renders shared Card/Button/Text/forms. Edits invalidate
  source proof; pending requests abort on edits/unmount/scope change. A saved
  request retries with the same idempotency key after an uncertain network result.
  Server-side grants and current source/target revisions remain authoritative.
- `ShopVideoPanel` loads when clip-performance disclosure opens. The React Query
  key contains user, partner, permission revision, clip and date range; it carries
  metrics invalidation metadata and polls portal projection every 60 seconds.
  Changing the scope cannot display the previous scope's cached values. Errors
  hide cached values. No browser filter or page read calls a platform API.
- `MetricValueList` and `ReportCountChart` are shared UI used by TikTok and existing
  Facebook performance. Counts/money retain decimal strings; only graph coordinates
  use Number. Unknown intervals break graph lines. Totals and source intervals
  use the same renderer. Source GMV/SKU counts are distinct from payable commission.

Native route addition: GET `/api/v1/staff/shop-videos` with staff scope and optional
`q`. Existing lookup/save/member routes remain. Both native marketing and TikTok
Video runtime switches must be enabled; this batch does not change their defaults.
No source tokens or raw provider payloads are exposed by the public projection.

## Earlier verification and limits (2026-09-10)

Full unit suite: 441 cases passed; final affected UI/chart suite: 15 cases passed.
Native TikTok and existing marketing registration: 25 integration cases passed.
Final optimized build, TypeScript and production fixture exclusion passed.
Browser used shared preview components on the existing tab: clip metrics/period
breakdown and Marketing lookup -> confirmation -> saved status. Day/Dark and
narrow layout inspected; observed CSS widths 433/416 (browser zoom affected nominal
viewport sizes), with document scroll width equal to width and inspected text
minimum 16px. This is not native authenticated browser or exact 200% zoom acceptance.

Earlier failed integration logs are retained: prior repeated test runs accumulated
541 active synthetic targets in the project-owned disposable database. Their IDs
and prior state were recorded, and only those old synthetic targets were deactivated
(no history deleted) before the final integration run. Video option discovery now
supports bounded search rather than failing when the target catalogue grows. The
older Facebook registration list still has its existing 500-target cap; that separate
scalability item and repeatable fixture lifecycle remain follow-ups.

Development preview transports stay under `dev/` and are excluded from production
bundles. They are UI evidence, not a claim that a shop has been connected. Native
DB/HTTP tests exercise the real registration and read services with synthetic data.

Remaining at the original UI checkpoint: native TikTok provisioning/connection lifecycle, one verified credential
refresh/quota owner, durable scheduler/supervision, larger-shop resumable acquisition,
actual account acceptance, native browser journey and release review. No deployment,
source-account call, credential change or live activation occurred. Disable the new
lane or remove its UI wiring to roll back; retain immutable source history.

## Native browser follow-up — 2026-09-11

The Marketing-to-partner path was exercised using a production Next build over
trusted localhost HTTPS, the native API routes and an isolated PostgreSQL database.
Synthetic staff created a clip/deal target, searched partial text, resolved a
synthetic Video ID against a stored report and confirmed its mapping. A separately
authenticated synthetic partner saw the exact report values: 24,000 views, 18 paid
SKU orders, 22 items and 21,500.50 THB GMV. An unrelated period showed unavailable
metrics. The mapping and values survived runtime restart and reload. The upstream
response was synthetic; this does not establish real TikTok API access.

Target creation now refreshes both ad-registration and TikTok video choices using
their existing actor/permission scoped query prefixes. This fixes the native case
where adding a clip succeeded but the TikTok form stayed empty until polling or a
manual search. A test mounts both real components and requires the new option
immediately after creation. Nineteen affected tests, TypeScript and the optimized
build passed, with independent review of the two-file correction. The final native
browser run confirmed the new choice without refreshing the page.

Native 200% zoom, complete responsive acceptance and load testing remain open.
Further UX work should reconcile content navigation/filter behavior with preview,
keep clips discoverable when performance exists without published commission,
and clarify the generic missing-metrics message above provider-specific values.
No production rollout or live platform call was performed in this follow-up.
