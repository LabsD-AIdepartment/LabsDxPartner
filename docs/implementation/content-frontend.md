# F05 — Content library and clip/ad detail

Date: 2026-09-08. Local frontend candidate on `feat/portal-foundation`, following F04 baseline `1d476f7`. This is not a production integration or release. Owner acceptance and independent implementation review remain open.

## Delivered behavior

- The library retains the six supplied portrait covers, 9:16 framing, shared shell, Inter typography and Day/Dark green theme. Clips appear together in one continuous responsive grid. **No library page buttons**: this supersedes the initial F05 pagination presentation following the owner's explicit correction. Search, dates, brand and reset remain.
- Source cursor batches append automatically to the same grid; the fixture supplies all six in its first batch. Covers load lazily. Each subsequent batch pins the first response's generation; duplicate IDs across batches and repeated cursors are rejected. No money is aggregated by the browser.
- Clip detail shows earned commission, eligible sales, eligible orders and earnings status. Unknown counts/metrics remain unavailable rather than zero. Removed covers have an explicit placeholder while historical earnings remain inspectable.
- Earnings basis/rate, agreement version and source/evidence references load when their section opens. Associated ads load separately on demand; ad and earning lists retain internal detail pagination for larger responses. Performance definitions, period and source freshness are disclosed beside each metric.
- Platform-attributed orders/value are visibly separate from eligible sales and commission. Ads never repeat clip earnings. Reach is non-additive. Spend/ROAS are hidden unless the injected capability is present; this is a presentation rule, not server authorization.
- Overview → clip → ad → clip → Overview preserves dates, brand, origin and earnings generation. Library search is preserved on its detail/back path. Obsolete library cursor/history parameters are cleared from generated library links. A generation mismatch hides incompatible amounts and links to the latest Overview.
- Loading, retry, empty, partial, stale, unavailable, removed and generation-change scenarios are available in the isolated development harness. Export remains an explicit later-phase dialog; no fake download or message sending.

## Modules and contracts

- `src/features/content/`: transport validation/model, scoped query hooks, library/card, clip/ad detail, earnings/ad sections and metric definitions. Components depend on shared/contracts, never on Overview internals.
- `src/shared/routing/report-context.ts`: serializable reporting state, date validation and internal link formatting. Shared date formatting moved into `src/shared/ui/format-date.ts`; Overview keeps compatibility re-exports.
- `ContentDetailResponse.data.earningsStatus` is a compatible extension: older responses default to `unavailable`, never implicitly confirmed.
- `loadContent` validates response schema, selected period, generation, requested content/ad identity, selected brand, duplicate page IDs and earnings-line date/content grain. Query keys include user, partner, permission revision, resource, filters and generation; requests consume abort signals.
- Only `dev/content-transport.ts` synthesizes values. It reuses `overviewRows` so earned-date selection, partial attribution and adjustments reconcile with F04. Lifetime cover-card view counts are not reused as selected-period performance values; missing period views remain unavailable.
- There is no real HTTP data adapter yet. G04/I02 must inject authenticated scoped read APIs, enforce capability projection server-side, provide stable generation/cursors and metric definitions/freshness, and replace development transports. UI capability filtering cannot protect data already sent to a client.

## Routes and production boundary

- Dev: `/content-preview`, `/content-preview/:clip`, `/content-preview/:clip/ads/:ad`; Overview preview links use these destinations.
- Production: `/content`, `/content/:clip`, `/content/:clip/ads/:ad` remain deny-only via `requirePartnerAccess`, pending A03. No simulated session or preview flag grants production access.
- The development route is guarded by `notFound` and a build-phase alias; synthetic content code is excluded from production browser bundles. `scripts/verify-no-demo.mjs` checks the new markers too.
- No provider/credential/DB/upstream, deployment, remote, push or merge changes. Node 24.18/npm 11.16, existing dependencies only.

## Verification performed

Evidence: `.agent-work/20260908-f05/evidence/` (ignored project-local artifacts).

- `tests-03.log`: **91/91 unit/contract/component tests in 11 files passed**, including 17 F05 cases and existing F04 regressions. `typecheck-03.log`: passed. `build-02.log`: production build and browser fixture exclusion passed.
- Reconciliation covers all clip source batches plus unassigned income against Overview under ready/partial/adjustments/empty, all/Axtion and narrowed earned dates. Tests cover wrong IDs/period/generation, wrong earnings grain, older status compatibility, abort/late responses, lazy requests, removed/unavailable data, capability visibility and automatic batch continuation/duplicate rejection.
- Real in-app browser: library displayed six distinct images in one grid with no page buttons; search Axtion showed two. Overview Axtion 15,920 → clip 12,800 → ad 81,200 impressions → back returned Axtion 15,920 with the same reporting context (`journey.json`). Partial showed no 12,800; generation-change showed a latest-Overview action instead of amounts.
- `responsive.json`: library Day at 280/375/800 CSS px and Dark at1440; all six image boxes approximately9:16 with loaded assets, no document or visible-control overflow. Detail Dark at280/800/1440 also had no overflow, including open earnings at800. Native viewport1162 library was also inspected, then viewport reset and Day restored.
- Images: `library-day.png`, `library-mobile.png`, `library-dark.png`, `detail-mobile.png`, `ad-day.png`. Emulated screenshots can have stale/clipped compositor regions; DOM dimensions and interactions were checked independently. Native200% browser zoom remains unverified, not substituted by narrow viewport testing.
- `production-http.json`: local production4188 returned307 to login for all three content paths and404 for all three content-preview paths plus Overview preview. Production verification server stopped afterward; dev4187 remains running. Port4187 listener cwd verified against this checkout.
- Three F05 browser specs were authored in `tests/e2e/content.spec.ts`; there are11 E2E specs total. The standalone Playwright runner/hosted CI was **not run**; browser actions above were exercised through the permitted in-app browser instead.

## Remaining gates / next task

F05 is an implemented local candidate, not independently reviewed or owner-approved. F06 is next: transactions, statement bridge/detail, export states and later-payment cross-page acceptance. F07/F08, native zoom, real identity/source/API performance and release gates remain open. No realtime latency or SQL/query-performance claim is made here.

Rollback: revert the F05 product commit; no schema migration or data rollback is needed. The prior contract remains readable and the approved design-preview project is unchanged.
