# F08 — Frontend acceptance and adapter boundary

2026-09-09 local frontend candidate. The UI is tested against synthetic contracts; this does not certify real OAuth, financial source correctness, database performance or production readiness. Original portraits, six supplied 9:16 covers, chart composition, three partner menus and the shared minimum16px type scale remain.

## Changes and proof

Shared queries now declare all revision groups on which their responses depend. A settlement revision refreshes Overview's outstanding obligation even though its primary query group is earnings; content summaries/lists also depend on metric revisions. One matching active query refetches once, unrelated scopes remain untouched, and inactive cached queries become stale without being eagerly fetched. Cancellation precedes invalidation, including initial pending reads, so late old responses cannot replace the current values. No event payload is added to a financial total.

The watcher accepts an initial validated scope watermark. The real A03 shell must fetch this before mounting financial observers; otherwise a change between an initial page read and the first poll could be treated as an unchanged baseline. A mismatched initial partner/permission is refused. The first subsequent poll compares against that watermark. G04 must serve authorized snapshots from a read store at least as current as the bootstrap watermark. Polling stays paused while hidden/offline and checks on resume; failures back off and permission loss clears the cache. Actual source-to-screen latency is R01 work.

The standard typecheck command now builds a fresh TypeScript graph after Next type generation. Repeated TS7 incremental runs had produced `Route extends never` errors from changed generated declarations; the complete nonincremental check passes without excluding files or suppressing diagnostics. Playwright output directories now carry a per-run timestamp/id, preserving previous evidence.

Evidence in `.agent-work/20260909-f08/evidence/`:

- `e2e-long-field-final.log`: **28/28 standalone browser tests passed**, single worker. Covers login/access denial, Overview→clip→ad→back, full six-cover library, later payment across pages, document states, account unlink/conflict, complete native datetime payment form and staff revision refusal. The earlier F07 browser payment-form gap is now closed by this runner.
- Ten route/state cases cover implemented partner and staff pages through loading/error/partial/stale/unavailable/empty/ready where applicable, with Day/Dark at375/1440, minimum16px, no document overflow, and no page errors. Existing content/transactions cases additionally check280/800/1162 widths and9:16 covers. Accessible modal keyboard/focus restoration is exercised by the foundation journey.
- E2E final artifacts: `.agent-work/runtime/evidence/playwright/2026-09-09T04-36-04-129Z-3785/`. Each matrix route includes geometry attachments and a desktop Day screenshot. Account desktop screenshot visually inspected; F07 staff mobile Dark screenshot also inspected.
- Initial failures are preserved: first run14/17, second24/27, scoped rerun16/16, then27/27 and final28/28. Corrections fixed exact-label selectors, route-transition readiness, the synthetic ad ID and an obsolete assertion that conflated statement query scope with a nested return URL. Payout keeps no top-level earnings generation; its safe return URL deliberately retains the original earnings context.
- `tests-bootstrap.log`: **147/147 tests in15 files passed**; unit/contracts include actual QueryClient observers and Overview rendering, selective invalidation, abort-ignoring late response, partner switch, hidden/offline/resume, permission revocation and bootstrap publication race. Exact payment proof remains25,520→15,520 after9,700cash+300withholding, with37,360 earnings unchanged.
- `typecheck-close.log`, `no-demo-close.log` and `build-bootstrap.log`: standard full-program check and production build/fixture exclusion. The final28-test run includes the bootstrap extension and maximum-length reference case.

Native browser200% zoom remains an explicit unverified F02 accessibility item: narrower viewport and Day/Dark checks are not claimed as native zoom. A near-limit158-character mixed Thai/Latin contact-evidence reference fits the confirmation at280px; Escape closes it and restores focus. Independent/owner acceptance remains open before release. No independent reviewer was invoked because the owner requested solo work.

## Frozen screen-to-endpoint mapping

These are the required service bindings for later phases, not implemented HTTP endpoints. Every read/action is scoped by the verified server session, current membership/capabilities and authorized IDs. Browser-supplied IDs never grant ownership.

| Screen / action | Planned service binding | Load and consistency |
|---|---|---|
| Authenticated shell | GET `/api/v1/partner/session`, then GET `/api/v1/partner/changes` | Minimal identity/capabilities and initial watermark before page observers; mount one watcher per scope; no financial cache persistence |
| Overview | GET `/api/v1/partner/overview` | One bounded response: earnings generation/date/brand summary, graph, top3 and separate all-period obligation as-of. Query depends on earnings/settlements/metrics because the projection includes content metadata |
| Content library | GET `/api/v1/partner/content` | Cursor batches append automatically to one grid. Preserve from/toExclusive/brand/q; reject duplicate IDs/cursors and mixed generations. Earnings+metrics dependencies |
| Clip header | GET `/api/v1/partner/content/:id` | Small summary first; compatible/null metric definitions; earnings+metrics dependencies |
| Clip earnings disclosure | GET `/api/v1/partner/earnings` | Lazy line/source/terms explanation, scoped contentId and earnings generation, no browser aggregate |
| Clip ad disclosure | GET `/api/v1/partner/content/:id/ads` | Fetch only after disclosure opens; metric dependency; no per-card provider API requests |
| Ad detail | GET `/api/v1/partner/content/:id/ads/:adId` | Both IDs authorized; explicit metric period/definition/freshness; non-additive reach; spend only when entitled |
| Transactions list | GET `/api/v1/partner/statements` | Status/cursor plus independent all-period outstanding total; settlements dependency; never sum visible pages |
| Statement detail | GET `/api/v1/partner/statements/:id` | Frozen statement version with separate settlement revision/as-of; bridge and exact components validated; continuation retains versions |
| Chosen document | GET `/api/v1/partner/documents/:id/download` | Prepare only the chosen document, then explicit save; ownership check every request; expiry/denial clear delivery. G03 owns private storage/export |
| Notifications | GET `/api/v1/partner/notifications`, POST `/api/v1/partner/notifications/seen` | Notices dependency; derived from real authorized statement/settlement records and user seen markers; no independent messaging platform |
| Account | GET `/api/v1/partner/account` | Agreement version, linked-method metadata and support. Revision-bound actions; provider linking/unlinking/recovery/logout bind maintained auth APIs pinned in A01/A03 |
| Staff partners | GET `/api/v1/ops/partners`; POST `/api/v1/ops/invites`; membership/terms subresources | Separate actor/capability query namespace. Bounded partner page and referenced agreement lookups; verified-contact evidence and dated mapping; no automatic invitation send |
| Staff imports | GET/POST `/api/v1/ops/imports` | Bounded run/exception projection; source/evidence reference; durable idempotency and audit in G02 |
| Staff periods | GET `/api/v1/ops/periods`; POST `/api/v1/ops/periods/:id/publish`, `/api/v1/ops/payments` | Bounded review projection and lookup partners; current capabilities/fresh reauth, reviewed revision/target/evidence, exact amounts. Durable operation recovery and persistent writes in G03 |

`OpsSnapshot` is a transport-facing bounded workspace projection, not a request to fetch whole source databases. Services may return only the selected workspace page plus referenced lookup metadata. Existing API/database projects remain behind explicit source adapters, never imported frontend modules.

## Remaining real-system gates

A01–A03 must supply actual Google/LINE/Apple callbacks, persisted sessions, membership/invitation/linking/recovery/revocation and authenticated shell integration. G01 needs an approved real agreement, input grain, rounding rules and a reconciled period. G02–G04 provide durable importer/ledger/statements/private files/APIs; I01/I02 connect actual source/metric feeds. R01 measures latency/query/payload/load/restore/isolation and R02 requires a known reviewed artifact plus authorized exposure. None is satisfied by these frontend fixtures or test counts.
