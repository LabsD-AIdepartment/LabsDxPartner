# F04 — Overview frontend

> Visual acceptance correction (2026-09-08): the owner rejected the original F04 removal of approved imagery/charts. The original receipt below is historical for presentation; the restoration receipt at the end supersedes its omission rationale. Extra necessary information may lengthen the page; approved elements must remain.

Implemented 2026-09-08 as a solo-authored local candidate. The product feature consumes an injected transport; `/overview-preview` supplies isolated synthetic responses for author verification. `/overview` remains behind the deny-only server gate until A03. This is not real partner financial access or full frontend acceptance.

## Behavior and ownership

- Overview requests one schema-validated response per partner/user/permission scope and normalized date/brand filter key. A response with the wrong earnings period is rejected; an older in-flight filter response cannot replace the current selection. Invalid or overlong date windows issue no request.
- Confirmed and estimated earnings are separate. Eligible sales are labeled as the calculation base. Confirmed unpaid and next scheduled payment have their own obligation timestamp and payout period, independent of content filters. The cards explicitly explain that these balances are not additive.
- The trend uses earned dates and includes signed adjustments. Expandable daily values retain exact satang precision. All displayed totals come from the transport; the product frontend does not sum financial rows or reconstruct payout balances.
- Top content shows up to three supplied rows, original 9:16 covers, exact money and an explanation for already-included partner-only earnings. Earnings links carry generation/date/brand context; payout links carry only their independent obligation as-of. A change in settlement does not manufacture an earnings-generation conflict.
- Loading, initial failure/retry, empty, partial, stale and unavailable states are represented. A failed refresh retains the last snapshot with an explicit warning. Unavailable responses hide financial cards rather than showing fabricated zeros. Export opens an honest availability notice; no file is fabricated.
- Shared shell, Day/Dark tokens, cards, filters, money, chart, cover, dialog and query provider remain authoritative for their concerns. No new runtime, datastore, identity authority, upstream integration or dependency was introduced.

## Contract compatibility and integration seam

`nextPayout.period` is an additive nullable period, defaulting to null when older payloads omit it. Unknown periods display an explicit unknown label. Producers can add the field without breaking existing fixtures; real G04 producers must source it from the published statement, independently of the selected earnings window.

`OverviewPage` receives `scope`, `transport`, `brands` and optional `initialFilters`. The connection phase must supply the approved period/brand options and an authorized API transport. The development fixture uses July–August 2026; this is not a product reporting-period policy. Financial aggregation lives exclusively in the dev transport as a synthetic upstream, using bigint minor units. The real implementation belongs to G02–G04.

The new development alias is replaced with an unavailable module in production. Both the route gate and browser-bundle marker scan remain in effect. Rollback removes the new route/feature/harness/test files and restores the alias/schema changes; there is no external or database state to reverse.

## Author verification

Evidence directory: `.agent-work/20260908-overview/evidence/`.

- `tests-closeout.log`: **71/71 tests in 10 files**. New coverage includes old payload compatibility, wrong-period rejection, exact large amounts, earned-date aggregation, partial attribution, signed refund adjustment, filter races, retry/unavailable, failed-refresh retention, payment updates retaining filters and payment during the initial request.
- `typecheck-closeout.log`, `build-closeout.log`: type generation, TypeScript and production build pass; no development fixture markers in production browser bundles.
- `production-http.json`: nine local production HTTP checks passed: login 200, all three preview routes 404 (including active-query attempt), and three partner routes redirect to login despite synthetic cookies. The final rebuild only followed dev-harness race/watermark and test changes; no production route or feature behavior changed after this HTTP check. Local 4188 verification server was stopped.
- Browser: changing to Axtion yields ฿15,920 while unpaid stays ฿25,520; recording a synthetic payment changes unpaid to ฿15,520 and advances its timestamp while preserving the selected brand and earnings. Reversing the simulated payment restores ฿25,520. Rapid payment during loading was also exercised.
- Browser: mobile partial explanation, unavailable without money/zero, empty without invented payout, stale watermark, loading, error/retry, expanded exact daily values and export disclosure were exercised. Day/Dark and desktop card hierarchy were inspected. `browser-layout.json` records 390/767/1440 CSS px with document width equal to viewport width; screenshots include mobile partial Dark and desktop Day/Dark.
- Initial unit failures were missing jsdom ResizeObserver support, corrected in test setup. Browser checks discovered two dev-harness refresh races: stale query options and reuse of an initial in-flight request. The helper now runs after the query consumer and cancels obsolete requests before invalidation; both flows have regression tests. Original evidence logs are retained.

## Open acceptance and next work

- F05 and F06 must implement the linked destinations. The complete Overview → Transactions later-payment journey cannot be accepted before F06 exists. Current evidence verifies link context, independent timestamps and the Overview refresh, not a completed statement page. F05 must likewise prove Overview → clip → ad → back context persistence.
- The F03 return-path sanitizer intentionally rejects query strings. A03/F08 must integrate typed reporting context without relaxing that sanitizer into arbitrary return URLs.
- F08/A03 must connect revision notifications to invalidate Overview when either earnings generation or settlement revision changes, and verify the cross-page race. This batch proves manual/synthetic refresh, not live realtime latency. G04 supplies the real first-screen contract; R01 measures query/load behavior.
- Sales has no invented brand chart and there is no invented profile/earning-mix data: the current contract does not supply these projections. The original visual prototype remains unchanged and separate from this functional candidate. Revisit presentation with the integrated F05–F07 journeys during F08.
- Native 200% zoom, independent different-model code review, remote/protected-main/hosted CI and full F08 acceptance remain open. Two E2E specs were added (eight total); the standalone runner was not run. Browser validation used the prescribed in-app runtime.
- During dev config restart, the existing browser tab became a `data:` error page. Browser URL policy then rejected navigation and closing that old tab. The app opened a replacement local preview tab; all later checks reused it, and its viewport was reset. The old error tab could not be closed through the supported tool; do not open more tabs to work around it.

Next local implementation task: **F05 content library, clip detail and ad detail**, under the unchanged canonical plan. No agents, credentials, real OAuth, database migration, source-system access, merge, push or deployment occurred.

## Approved composition restored — 2026-09-08

- Restored the original portrait and identity overlay with byte-identical existing assets, header avatar/notifications, welcome, Organic/Brand ads values and rate labels, brand bars, trend total/clip count, payout progress rail and the earning-mix card. Desktop remains portrait left spanning two rows; sales/payout above the wide trend; top content and mix side by side. Tablet/mobile reflow retains all six cards.
- Existing F04 estimate, exact daily values, partial mapping, timestamps, independent payment balances and explanations remain visible or accessible exactly as before. The owner explicitly accepts additional length when useful; restoration is not a mandate to hide information in accordions or shrink content.
- Added nullable default-null salesByBrand, channelBreakdown (with nullable per-channel rates) and contentCount to the earnings snapshot. Older responses keep the visual slots with missing-data labels; they never synthesize a breakdown. Financial projection ownership remains upstream. Profile is presentation input; dev supplies the approved sample only.
- Compared the approved design-preview/app.js data with F01 fixtures: original Organic10% / Brand ads3% yields eligible sales550000 THB, Axtion232000 THB and confirmed37360 THB. Corrected the synthetic fixture's accidental all10% rate/base while preserving commission/payout amounts. These are not real agreement terms. Dev projection sums reconcile for ready, empty, partial and adjustment scenarios; product UI only consumes them.
- Verification: .agent-work/20260908-overview-restore/evidence/tests-2.log has74/74 tests in10files; typecheck-final.log and build-final.log pass, with production fixture exclusion. New regressions preserve portrait/bars/mix/six cards, old-payload unknown slots and projection-to-total reconciliation. Existing filter and payment race tests still pass. Standalone E2E runner was not run.
- Rendered source comparison and image hashes verified. Browser captures/layout.json/tablet.json record six-card composition at1440,767,390 CSS px with no horizontal overflow. A rapid resize in layout.json retained1440 for its intermediate sample; the separate tablet.json records settled767. Day/Dark inspected, actual portrait/cover images loaded. Native200% zoom and independent review still unproven.
- No changes to original design-preview assets/source, no real auth/data/API/DB or deployment. F05 remains next after this correction; prior visual candidate is not owner-approved merely because code tests passed.

## Responsive correction — 2026-09-08

Owner requested responsive support while preserving the approved composition, imagery and necessary details. This batch changes presentation only; F05 remains unstarted.

- The profile's zero padding now wins against the shared Card rule regardless of stylesheet order, restoring the full-width portrait. At intermediate widths the portrait has a bounded height instead of growing with all financial explanations.
- The Overview content band uses its actual available width: three columns above 1079px, paired sales/payout below that, and stacked cards at 680px or below. The desktop portrait / sales+payout / trend / clips+ring composition remains intact. All six cards and all supplied imagery remain present on small screens.
- FilterBar owns date/brand/export arrangement and a grouped action row. Its optional `actions: ReactNode` slot lets Overview provide refresh alongside reset; existing callers can omit it. Date inputs receive one full row below 320px of available space and two columns on ordinary phones. Brand and export retain equal widths. Controls remain at least 46px tall.
- The small profile channel breakdown stacks rather than breaking money across lines. The ring adapts to its own card; clip arrows get enough track width. Header identity remains visible on phones, with wrapped header rows and bottom navigation.
- Containers are limited to the filter and content bands. The export dialog and shell overlays remain outside them; financial authority, query scope, calculation, transport and auth behavior did not change.

### Boundary disposition

Change Mode, B3/B4: backward-compatible shared UI extension. Overview still owns filters, validation and refetch; FilterBar owns presentation and invokes supplied callbacks. Dependency remains feature → shared UI. FoundationGallery, which omits `actions`, was exercised at 280px. No B1/B2/B5–B10 boundary changes, data migration or deployment changes. Existing user authorization covers local implementation and verification. Roll back this presentation commit if controls or required imagery regress; no storage rollback is involved. READY FOR DECLARED SCOPE applies to this local responsive correction only.

### Verification

Evidence: `.agent-work/20260908-overview-responsive/evidence/`.

- 74/74 tests in 10 files passed (`tests.log`); typecheck and final production build passed, including fixture exclusion (`typecheck.log`, `build-final.log`).
- Browser DOM geometry at actual CSS widths 280, 375, 540, 700, 800, 1120, 1440 and 1920: no document or inspected main-content overflow, all six cards retained, all five main images loaded. `layout.json` records exact widths and control/card rectangles; the capture named `376-day` actually measured 375px. Day/Dark were sampled across the matrix, not every Cartesian combination. Fixed rail has no expanded/collapsed state.
- Narrow-screen export opens and closes; Axtion filter shows both confirmed totals at ฿15,920; reset and Day/Dark toggle work. Adjustment and error/retry layouts were checked at 280px. FoundationGallery's existing FilterBar caller still fits at 280px without the optional action.
- Screenshot capture can show stale/clipped compositor regions during viewport emulation; these screenshots alone are not pixel-perfect visual acceptance. DOM geometry and interaction evidence are recorded separately. Viewport restored to native after checks; one tab reused and returned to `/overview-preview`.
- Native 200% browser zoom, independent implementation review, and owner visual acceptance remain open. No standalone E2E runner, real API/auth/database integration, deployment or F05 completion is claimed.

## Commission panel organization — 2026-09-08

Owner requested a more orderly and space-efficient earnings pane at 1162px. Grouped the confirmed heading/caption/amount, aligned Organic and Brand ads in equal bordered cells with their rates, placed estimated amount beside its status, and grouped the source link with the adjustment note. All amounts, explanations, rates, links and imagery remain; no query/financial/public contract changed. This is a feature-local presentation change.

Measured pane height at 1162px fell from 552.93px to 429.46px (22.3%). Removing the portrait image's contribution to intrinsic grid sizing lets the portrait match the pane without an empty strip below. Narrow channel cells reflow into label/value rows using the pane's own available width. Desktop six-card composition remains unchanged.

Author verification: final 74/74 tests, typecheck and production build/fixture exclusion passed. Actual browser widths 280/375/1162 Day and 1440 Dark retain complete panel text, loaded images and no pane/document horizontal overflow. Evidence `.agent-work/20260908-earnings-layout/evidence/` includes `geometry.json`, screenshots and command logs. Screenshot compositor limitations and native-zoom/independent/owner acceptance debt remain as documented above. Browser returned to Day/native viewport in the same tab; no F05, upstream, auth, DB or deployment work.
