# Labs D x Partner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans when implementation is authorized. Execute one bounded task, verify its acceptance evidence, and obtain independent review before advancing its gate. This document authorizes no deployment, provider-console mutation, customer access, payment or production migration.

**Goal:** Complete the small, understandable celebrity partner frontend first, then connect Google/LINE/Apple identity and accurate, inspectable partner earnings from existing systems.

**Architecture:** One modular web application and one logical PostgreSQL store. The browser reads partner-scoped local projections; existing ERP, Sale Dashboard and ChatMesh remain upstream authorities. A bounded importer refreshes projections outside the request path. Three primary menus remain Overview, My content and Transactions.

**Tech Stack:** Next.js + React + TypeScript, PostgreSQL + Drizzle, Zod contracts, TanStack Query, existing CSS theme tokens/CSS Modules, provisional Better Auth, Vitest and Playwright. Pin compatible versions in F00. No Redis, message broker, new ERP or provider connector suite for phase one.

**Authority:** [Architecture and data rules](../../design/partner-portal-architecture.md), [approved visual direction](../../design/phase-1-theme-design-system.md), [reduced scope and existing-system evidence](../../research/2026-09-07-partner-portal-reuse-scope.md). The larger original business proposal is historical; use these documents for execution.

**Date/status:** 2026-09-07; implementation candidate, independent review recorded separately. There is currently a local vanilla preview, no Git repository and no production authentication. Proposed target paths below are to be created; commands below become available in F00. No application implementation occurred while writing this plan.

**Revision 2026-09-08:** [stack-fit decision](../../design/stack-fit-decision.md) removes any requirement to match Sale Dashboard's technology. Next.js remains selected on product-fit grounds after comparing Vite/Fastify, Vite/Hono, SvelteKit and Laravel. Automatic-refresh behavior is now explicit; [new review receipt](../../reviews/2026-09-08-stack-fit-review.md) applies to this revision. The original three-round review remains historical evidence for its exact candidate.

## 1. Scope and delivery order

| Phase | Deliverable visible to owner | Tasks | Exit gate |
|---|---|---|---|
| 0 — Contracts and foundation | Stable route/data map, exact money examples, reusable theme/components | F00–F02 | Fixture and server contracts agree; money examples pass |
| 1 — Complete frontend | All screens, responsive layouts and meaningful states using synthetic data | F03–F08 | Owner can walk the whole partner experience; UI-only acceptance |
| 2 — Identity and access | Actual Google, LINE and Apple login, invitations, membership and secure sessions | A01–A03 | All three providers and cross-partner denial verified |
| 3 — Accurate data and finance | Scoped reads, reconciled approved-period import, immutable statements and payment recording | G01–G04 | One complete authorized partner/period reconciles end-to-end |
| 4 — Existing-system integration | Minimal approved source feeds and honest clip/ad performance | I01–I02 | Source replay, revision and coverage verified; no browser provider fan-out |
| 5 — Pilot readiness | Performance, recovery, monitoring and controlled deployment package | R01–R02 | Independently reviewed release artifact; exposure separately authorized |

Do not require live credentials to finish phase 1. Do not call phase 2 complete with fake auth or a permanently disabled provider. Phase 3 can use a finance-approved file if existing APIs lack adequate entitlement granularity; disclose manual cadence. Phase 4 adds only source routes needed by the pilot, not every marketplace integration. No parallel development of Better Auth and Auth.js.

Dependency spine: `F00 → F01/F02 → F03 → F04/F05/F06 → F07/F08`. After F08, run `A01 → A02 → A03` alongside `G01` agreement/source-contract work and isolated schema drafts. Both `A03 + G01` are required before `G02 → G03 → G04 → I01 → I02 → R01 → R02`. No confirmed-money publication or partner financial exposure before A02/A03 isolation is proven.

Safe parallel slices after contracts freeze: F04 overview, F05 content, F06 transactions. One owner controls shared contracts/theme/schema; route workers do not independently redefine money, session or filters. Every public-contract change updates consumers and fixtures in the same reviewed batch. External provider/account inventory can be read during frontend work; it does not authorize provisioning or infra spend.

## 2. Phase 0 — Small foundation, stable contracts

### F00 — Establish implementation baseline and toolchain

Files: root `package.json`, lockfile, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`; `docs/implementation/baseline.md`, `scripts/verify-no-demo.ts`.

- [ ] Inventory current preview, assets and rights; record source paths and preserve `design-preview/` as visual reference. Record actual hosting/deployed-code status before any product change.
- [ ] When implementation is authorized, follow gitcommand to establish repository/remote/branch protection and a clean known baseline; do not invent a deployed SHA or commit secrets. Keep `.agent-work/` ignored. No automatic commit during this planning turn.
- [ ] Pin compatible stable package versions, one package manager/lockfile, project-local test caches/artifacts. Bootstrap a single app; use an alternate local port so the existing 4186 preview remains available for comparison.
- [ ] Select supported Node LTS and packages from the portal's own auth/UI/API/runtime needs; no stack affinity or shared internal login with upstream projects. Keep source integrations behind versioned API/export adapters. Document the Next.js subset: server shell/access, interactive React, explicit financial REST routes and one TanStack Query client data owner.
- [ ] Add scripts: `dev`, `build`, `typecheck` (`tsc --noEmit` with a non-solution config), `test`, `test:integration`, `test:e2e`, `test:performance`, `verify:no-demo`, `db:migrate:test`, `import:once`. Add each script's real implementation in its task before claiming it passes.
- [ ] Fixture routes are development/test-only and denied by production configuration. Production build must fail if demo-auth/data mode is enabled; no hidden query parameter bypass.

Acceptance: clean install/build/typecheck; no secrets/raw references in output; baseline records actual state. Evidence uses unique names under ignored project work area. Document commands unavailable until later tasks instead of green empty test suites.

### F01 — Contracts, financial examples and fixture scenarios

Files: `src/contracts/{common,session,overview,content,earnings,statements,account,operations,notifications,changes}.ts`; `src/server/modules/earnings/{money,calculate,reconcile}.ts`; `dev/scenarios/{ready,empty,partial,stale,access,adjustments}.ts`; `tests/contracts/partner-contracts.test.ts`, `tests/unit/earnings.test.ts`.

- [ ] Encode architecture's Money/Envelope/EarningsLine and all endpoint response schemas. Distinguish financial status from data freshness and attribution granularity. Contracts include no customer PII or internal ad-spend fields without capability.
- [ ] Include commission/fixed-fee/bonus/adjustment kinds. Approved fixed amounts have null base/rate plus evidence, never invented sales. Golden example: 7000 commission + approved 3000 fee = 10000 earned; eligible sales stay 70000. Validate kind-specific fields and avoid interpreting fixed fees as conversion revenue.
- [ ] Add literal golden expected amounts independent of production helpers: 7000 eligible commission, full reversal, three 5-satang lines → 3-satang commission, 9000 remaining obligation with cash/withholding distinction; zero/negative/large integer values.
- [ ] Implement the pure per-line primitive using integer operations, with validation at the boundary:

```ts
const magnitude = (abs(baseMinor) * BigInt(ratePpm) + 500_000n) / 1_000_000n;
return baseMinor < 0n ? -magnitude : magnitude;
```

- [ ] AgreementVersion carries `roundingRule { mode: per-line | per-period, tieBreak, allocation }` and calculation-period definition from day one. Dispatch explicitly: the same three bases produce 3 satang per-line or 2 per-period; per-period allocations are 1,1,0 in stable source-ID order, and sum exactly to the group amount. Test negative/signed allocation, ties and cumulative correction against original group allocations. No pilot rounding assumption precedes G01.
- [ ] Test cumulative partial refunds against prior recognized entitlement, original agreement version on reversal, unknown amounts as null, and no summing non-additive reach/percentage metrics.
- [ ] Build representative fixtures for no activity, partner-only unmapped earnings, source delay, partial coverage, negative correction, partial payment, access denial and source-unavailable. Parse every fixture through production wire schemas.

Check: `npm run test -- tests/unit/earnings.test.ts tests/contracts/partner-contracts.test.ts`. Acceptance: overview totals, detail rows and statement examples reconcile exactly; fixture data is synthetic and labeled in development only.

### F02 — Shared visual and query components

Files: `src/shared/theme/{tokens.css,ThemeProvider.tsx}`; `src/shared/ui/{Button,Card,Dialog,Sheet,DataState,Money,StatusBadge,FilterBar}.tsx`; `src/shared/charts/{TrendChart,BarChart,DonutChart}.tsx`; `src/shared/query/{provider.tsx,keys.ts}`; `src/features/shell/{AppShell,Navigation,ThemeToggle,MusicToggle}.tsx`.

- [ ] Port current theme tokens, day/dark surfaces, typography, green gradients and spacing; preserve owner-selected design. Theme icon indicates current mode. Keep optional audio separate from data/auth and off public login.
- [ ] Implement loading/error/empty/stale/partial components with retry and readable Thai messages; accessible keyboard focus, contrast, labels and reduced-motion behavior.
- [ ] One exact Money formatter handles large signed satang without conversion to Number. Charts take already-defined metrics; chart rendering does not recalculate financial amounts.
- [ ] Centralize scoped query keys, abort behavior, normalized filters, session reset and short in-memory caching. No persistent financial cache.
- [ ] Add `src/shared/query/ChangeWatcher.tsx`: fixture-driven 30-second revision check with 0–5 seconds jitter, active-tab/online pause, immediate visible/reconnect check, coalescing/backoff and selective invalidation. staleTime does not implement the polling interval. Model earnings/settlements/metrics/notices revisions independently.
- [ ] Preserve header notification styling with a shared `NotificationButton`/popover; count and deep links come from its contract, not sample constants. Fetch after critical data; include no-notice/error/mark-seen states.

Acceptance: component demonstration plus visual review at 390, 768 and 1440px; no overflow with long Thai labels, large money, zoom 200% or failed images. Verify dark/day and keyboard operation; avoid snapshot tests that merely repeat implementation markup.

## 3. Phase 1 — Complete partner frontend before integration

### F03 — Shell, public login and access states

Files: `app/(public)/{login,access}/page.tsx`; `app/(partner)/layout.tsx`; `src/features/login/`; `tests/e2e/access-states.spec.ts`.

- [ ] Keep three navigation menus. Add login with Google/LINE/Apple buttons, invite entry, pending approval, expired/used invite, cancelled login, retry and suspended access screens.
- [ ] Implement access variants on one `/access` page keyed by safe reason codes, not a new route for every state. Reason codes never confer permissions.
- [ ] Preserve intended relative destination after authentication; invalid external return URLs never become links.
- [ ] Simulate state transitions only in isolated development scenarios. Login buttons in the production app must later call real auth, never set a mock identity cookie.

Acceptance: all access states are understandable on mobile; no finance screen exposed by an unauthenticated development-state accident in a production build. Real-provider success is deliberately tested in A01/A03.

### F04 — Overview with meaningful numbers

Files: `app/(partner)/overview/page.tsx`; `src/features/overview/{OverviewPage,EarningsSummary,PayoutSummary,TopContent}.tsx`; `tests/e2e/overview.spec.ts`.

- [ ] Show estimate/confirmed distinction, confirmed outstanding obligation, next scheduled payout and data-through timestamp; retain the visual hierarchy and small top-content block.
- [ ] Use earned-date trend, not lifetime clip earnings connected by publication date. Next payout is independently labeled by its payout period; changing a content filter cannot rewrite a payout balance.
- [ ] Overview calls one first-screen contract; detail links use the same generation. Partial/unmapped earnings visibly explain why clip subtotals differ from partner totals.
- [ ] Earnings links carry the earnings generation only. Confirmed unpaid/next payout carry an independent obligation as-of based on published statements and settlements. Test a payment recorded between Overview and Transactions: the newer balance is explained by as-of labels, with no false generation-conflict error.

Acceptance: selected period and next-payment context remain clear; retry/empty/stale/partial states and exact money fixtures verified. Overview no longer implies all displayed financial cards can be added together.

### F05 — Content library, clip detail and ad detail

Files: `app/(partner)/content/{page.tsx,[contentId]/page.tsx,[contentId]/ads/[adId]/page.tsx}`; `src/features/content/{ContentList,ContentCard,ContentDetail,AdDetail,MetricDefinition}.tsx`; `tests/e2e/content.spec.ts`.

- [x] Use current six covers with 9:16 framing, a continuous grid with search/brand/date controls and honest removed-content placeholders. Owner correction 2026-09-08: no user-facing library pagination; append source cursor batches automatically in the same page.
- [x] Detail defaults to 3–4 useful numbers: eligible sales/orders, earned commission, earnings status. Additional Earnings/Performance sections show calculation basis, rate/terms version and source freshness on demand.
- [x] Show associated ad cards and minimal platform metrics with date/definition; platform-attributed conversions are visually separate from payable earnings. Partner-only source evidence renders no fabricated clip breakdown.
- [x] Hide spend/ROAS without capability. Distinguish unavailable from zero; reach is never summed across ads. One clip with many ads does not duplicate earnings.

Acceptance: click from Overview → clip → ad → back preserves context; unavailable metrics do not leave misleading zero charts; known earning rows reconcile; no ad-management controls.

Local candidate implemented 2026-09-08. Verification and open owner/independent acceptance gates: `docs/implementation/content-frontend.md`. Real identity and data integration remain later phases.

### F06 — Transactions, statement detail and export experience

Files: `app/(partner)/transactions/{page.tsx,[statementId]/page.tsx}`; `src/features/transactions/{StatementList,StatementDetail,SettlementBridge,DocumentList}.tsx`; `tests/e2e/transactions.spec.ts`.

- [ ] Separate earnings period, publication date, scheduled payment and actual payment. Show pending/part-paid/paid and explicit adjustments.
- [ ] Statement explains opening balance, newly confirmed earnings, adjustments, settled obligation and closing balance; cash, withholding and other evidenced settlement components remain distinct.
- [ ] Design download/export pending/error/ready and permission-denied states. Add ask-about-this-reference using the existing contact channel, without sending messages automatically.

Acceptance: partial-pay and correction examples explain the exact balance; sample download in development is explicitly synthetic. G03/G04 supply real ownership checks/files.

### F07 — Account and minimal staff operations frontend

Files: `app/(partner)/account/page.tsx`; `app/(staff)/ops/{partners,imports,periods}/page.tsx`; `src/features/{account,operations}/`; `tests/e2e/account-ops.spec.ts`.

- [ ] Account contains agreement summary, connected methods, support and logout; link-conflict/final-method-unlink/recovery states are designed.
- [ ] Staff-only shell contains partner invitation/membership/terms mapping, import exceptions, period review/publication and finance payment recording. No general ERP, ad manager or ticketing system.
- [ ] Dangerous business actions show concrete partner/period/amount/evidence context and confirmation. Buttons remain development simulation until authenticated server services land.

Acceptance: partner navigation never exposes staff controls; scope/error/re-auth states covered; no promise of automatic bank payment or tax issuance.

### F08 — Frontend acceptance and contract freeze

Files: `tests/e2e/partner-journeys.spec.ts`; `docs/implementation/frontend-acceptance.md`.

- [ ] Run full routes across ready/empty/loading/error/partial/stale/unavailable/access states; all fixtures validated by F01 schemas.
- [ ] Review day/dark, mobile/desktop, keyboard, long labels and portraits with the owner-visible preview. Record screenshots within project work area and list any remaining UI issue.
- [ ] Verify no eager download of every clip/ad, no double loading shell, and no URL state that bypasses access. Record a screen-to-endpoint matrix.
- [ ] Simulate a new published revision, an old response arriving late, hidden/offline/resumed tabs and a partner switch. Only changed active data refetches; the matching graph/cards update together; client financial totals are never incremented from event deltas.

Check: `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run verify:no-demo`. Exit means **frontend complete against contracts**, not authentication/data correctness in production. Change to real integration begins only after this UX checkpoint.

## 4. Phase 2 — Real identity and partner isolation

### A01 — Pin auth behavior and prove three providers

Files: `src/server/modules/identity/{auth,provider-config,profile-map}.ts`; `app/api/auth/[...all]/route.ts`; `db/schema/identity.ts`; `tests/integration/auth-profile.test.ts`; `docs/implementation/provider-acceptance.md`.

- [ ] Inventory Google client/consent, LINE channel/provider and Apple Developer/App ID/Services ID/key/registered HTTPS callback. Record references and readiness, never secret values. Provisioning/domain changes require the applicable explicit authorization.
- [ ] Install and pin Better Auth with Postgres sessions. Disable implicit linking, cookie session cache, unused password/native paths; configure explicit different-email linking and last-method protection. Pin and test actual API options.
- [ ] Mount the maintained Next host handler, preserving callback body/content type, repeated Set-Cookie and external HTTPS origin through the proxy. Test Google/LINE/Apple callbacks through that actual adapter. Documented integration is not runtime acceptance; avoid custom request reconstruction and cookie-presence-only authorization.
- [ ] LINE `openid profile`, S256 PKCE and deterministic unverified `.invalid` auth-only email if absent. Contact email is separate. Verify placeholder is never used for messaging, linking or recovery.
- [ ] Verify Google subject-based identity; Apple first/repeat consent, relay addresses, missing name and cross-site POST callback with state/browser binding in Safari and Chrome on registered HTTPS staging. No blanket CSRF/SameSite bypass.
- [ ] Record Apple callback path and maintained-library cookie/transaction decision; use narrow temporary cross-site cookie scope where supported, otherwise document and test single-use state/browser binding. Ordinary session/mutation protections stay enforced. Assign a renewal owner, Key ID reference, next date and configured expiry: propose automated 30-day JWT renewal and alerts 14/7 days before expiry, subject to provider-supported settings. Test expired-secret failure without demo fallback; R01 verifies renewal procedure.
- [ ] If the pinned Better Auth cannot pass missing-email LINE or Apple callback proof without unsafe custom auth, replace only the identity adapter with Auth.js before A02. Record the decision; never ship both engines.

Acceptance: controlled accounts genuinely log in through all three providers; cancellation, wrong-state, callback replay and invalid-token failures are rejected. Missing provider credentials are an external dependency, not a completed mock substitute; independent frontend work can already be complete.

### A02 — Membership, invitations, identity linking and recovery

Files: `src/server/modules/{identity,partners}/`; `db/schema/partners.ts`; `app/api/v1/partner/session/route.ts`; `app/api/v1/ops/invites/route.ts`; `tests/integration/access-control.test.ts`.

- [ ] Hashed single-use expiring invitation claims become pending membership; activation requires known-contact verification or pre-bound identity. Concurrent redemption activates at most one intended account.
- [ ] Resolve session → current active membership → permitted partner at every request. Selectable partner must be a current membership, never a client-supplied authority.
- [ ] Explicit provider linking proves existing and new identity, enforces uniqueness atomically and rejects conflicts. Same email and relay addresses do not auto-merge.
- [ ] Recovery through an existing method or controlled staff verification; revoke old sessions/identity access and audit replacement. Block removal of the last usable method.
- [ ] Staff role is explicitly provisioned; require fresh auth for membership and finance changes. Use maintained auth primitives for state/CSRF and rate limiting.

Acceptance: two-partner adversarial matrix covers session route, direct object IDs, mutation bodies and staff routes; suspended membership loses access immediately. No data access granted solely by invitation possession or matching email.

### A03 — Connect frontend to real sessions

Files: `src/features/login/`, `src/features/account/`, `src/shared/query/`, `app/(partner)/layout.tsx`; `tests/e2e/authenticated-journeys.spec.ts`.

- [ ] Replace fixture access transport with the real identity wrapper; financial fixtures remain isolated synthetic staging only until G04.
- [ ] Clear/abort all user-scoped queries on logout, account switch, suspension and 401/403; private/no-store server responses. Never flash another user's previously cached amount.
- [ ] Prove all-provider sign-in/relogin, explicit linking/unlinking, invite states, expiration/revocation and unauthorized document attempts through the actual browser/server/DB path.

Exit: real authentication and isolation complete in controlled staging. Record package versions, HTTPS hostname, provider matrix and test accounts by non-sensitive label. Do not claim live finance ready yet.

## 5. Phase 3 — Reconciled partner numbers

### G01 — One real agreement, one period, source contract

Files: `docs/implementation/pilot-data-contract.md`; `src/server/adapters/approved-period/{schema,parse}.ts`; `db/schema/{content,earnings,imports,statements}.ts`; ordered new `db/migrations/` files.

Start after F08 in parallel with A01–A03 for agreement/source documentation and isolated schema work. No publication of confirmed money until identity/isolation gates have passed. This avoids leaving the main business-data uncertainty idle behind provider setup.

- [ ] Map one authorized partner's existing agreement to commission base, discounts/refunds, rate, effective dates, rounding, evidence grain, payment cadence and stacking/offset rules. Sample 10%/3% never becomes a default contract.
- [ ] Identify authoritative source per channel; map order/line/reference, revision, earned-time, collected/returned status and evidence. Explicitly record unsupported clip attribution and unresolved rows.
- [ ] Import already-approved fixed fees/bonuses as distinct evidenced earning lines when the actual agreement includes them. Do not build a new fee-negotiation/bonus-rule system.
- [ ] Define approved-period import template with source coverage/control totals, canonical entitlement keys, references and original evidence access for staff. No raw customer PII in partner contracts.
- [ ] Create isolated test DB bindings and collision-free migrations; inspect target before execution. Never edit an applied migration or infer production migration approval.

Acceptance: finance/source owner can explain every input and total for the selected period. Unknown financial rules block that pilot's publication, not unrelated frontend work. Pilot contract is signed off as business input before the importer can publish confirmed money.

### G02 — Idempotent import and exact earnings generation

Files: `src/server/modules/imports/{run,lease,validate,publish-generation}.ts`; `src/server/modules/earnings/{repository,calculate,reconcile}.ts`; `scripts/import-once.ts`; `tests/integration/import-reconciliation.test.ts`.

- [ ] Import outside requests: bounded fetch/file parse, schema validation, mappings and draft calculation. Claim one source/scope lease; expired older runs cannot commit over a newer generation.
- [ ] Separate logical entitlement from source revision. New revision supersedes open draft row; closed line receives only linked delta adjustment. Replay and ERP/ChatMesh mirrors never add another commission.
- [ ] Validate completeness against source controls. Reject invalid currency/precision/unknown status; quarantine unresolved attribution and expose excluded counts. Publish only a reconciled generation pointer atomically.
- [ ] Retries limited to transient fetch failures; duplicate commit/publish uses idempotency keys and DB uniqueness. Preserve last good generation with dated/stale status on failure.

Check: `npm run test:integration -- tests/integration/import-reconciliation.test.ts` against real isolated Postgres. Literal expected sums cover duplicate/revision/out-of-order/concurrent run/refund-once/rounding/partial data. A fixture adapter is not proof of an upstream connection.

### G03 — Frozen statements, settlement and private files

Files: `src/server/modules/statements/{publish,settle,repository,download,export}.ts`; `src/server/platform/documents/`; ops publication/payment routes; `tests/integration/statements.test.ts`.

- [ ] Publish locked reconciled generation into immutable period header/lines, unique active partner/period version. Require policy for unresolved rows; excluded rows cannot silently disappear from a confirmed statement.
- [ ] Record actual finance evidence, cash/withholding/other explicit components and applied obligation; idempotent payment references, partial allocations and no allocation above outstanding without an explicit credit rule. Corrections are append-only reversals/new entries, never hidden edits.
- [ ] Adjustment references retain original source/agreement; later refunds do not rewrite an issued statement. A negative closing balance is credit/carry-forward, not an automatic debit or bank operation.
- [ ] CSV export uses exact same frozen/pinned data, scoped server generation and formula-injection protection. Interactive export is capped at 10,000 lines, streamed; larger request asks for narrower periods in v1. Private documents are authorized per download; signed URLs if used expire within 60 seconds and are never persisted client-side.

Acceptance: publication/payment races produce one outcome; cash+withholding=settled obligation and statement bridge reconciles; documents/exports cannot cross partner boundaries; no bank transfer or tax document manufacture inferred from recording.

### G04 — Real partner read APIs and frontend replacement

Files: `app/api/v1/partner/` routes in architecture; `src/server/modules/{content,earnings,statements}/read-model.ts`; `tests/integration/partner-reads.test.ts`; `tests/e2e/real-period.spec.ts`.

- [ ] Implement bounded indexed reads, cursor time+ID, common generation and safe errors. One Overview response, no raw upstream call in page render, no shared-user cache.
- [ ] Implement `app/api/v1/partner/changes/route.ts` and `src/server/platform/db/revisions.ts` with small per-partner metadata. Owning write services advance relevant revisions in the same transaction as committed data; changes reads check current membership and never scan the full earnings table. Match response/query versions to avoid stale-response overwrite. Test money, settlement, metrics and notice changes separately, without extra financial write paths.
- [ ] Start with indexed SQL aggregation over the pinned generation, without a daily rollup table. Only add materialization if R01's measured budget fails after query/index tuning; preserve atomic generation publication and exact totals.
- [ ] Scope every joined row, ad and document to current membership. Detail sum agrees with summary generation; old unavailable draft generation returns 409 with reload action. Frozen statements stay reproducible.
- [ ] Replace frontend fixture data adapter with HTTP contracts. Keep unknown/partial/unassigned states; performance may remain unavailable until I02.
- [ ] Connect header notifications to owned published-statement/payment history and a per-user/per-partner seen marker. Implement bounded read and CSRF-protected mark-seen routes from architecture; test actual count, cross-partner denial and a new payment arriving during mark-seen. No external notification sending.
- [ ] Reconcile authorized pilot source totals → import → detail → Overview → statement → export using literal control totals and actual DB/API/browser code paths.

Exit: one partner/period works end-to-end in isolated/staging environment with truthful data-through/coverage. Manual approved-period ingestion is clearly labeled; automated upstream readiness remains separate.

## 6. Phase 4 — Reuse existing feeds, deepen only useful detail

### I01 — Minimal upstream contracts and scheduled refresh

Files: `src/server/adapters/{sale-dashboard,erp,chatmesh}/`; `docs/implementation/upstream-contracts.md`; `tests/integration/upstream-contracts.test.ts`.

- [ ] Choose the smallest authority path from G01. Read Sale Dashboard's existing ERP ingestion/projections through its bounded API when sufficient; do not build the same raw connector again. Request an ERP API/export only for missing authoritative facts. Internal source database views belong to their source owner, not to a shared portal schema.
- [ ] Treat each source as a framework-neutral external API/export contract. No shared frontend/ORM/auth requirement or direct import of another project's internal modules. Existing upstream ingestion may be reused as evidence through its API, never as a reason to select the portal stack.
- [ ] A source owner must expose a bounded service-scoped endpoint/view/export with version, source account, cursor/as-of, coverage, stable IDs and precision. Existing internal session-only endpoints are not public partner APIs.
- [ ] ChatMesh supplies canonical ERP references and qualified attribution evidence; existing PSID-only joins, Page-unqualified touchpoints or ERP-pushed status never determine payable earnings. Unresolved Page/account joins stay explicitly unresolved.
- [ ] Enable `import:once` through a scheduler using the same release SHA; one source/scope run, separate small DB pool, bounded retry/backoff and watermark. Source failure leaves prior data labeled stale.

Acceptance: authorized real sample reads and contract tests for source status, duplicate/revision/restart/partial pages; source controls reconcile to G02. Upstream code changes, if needed, are separate reviewed tasks in their owner projects under their own authorization; this plan does not silently modify those repos.

### I02 — Clip/ad performance projections

Files: `src/server/modules/content/{mapping,performance,read-model}.ts`; `tests/integration/content-performance.test.ts`; `docs/implementation/metric-definitions.md`.

- [ ] Reuse Sale Dashboard creative/ad IDs, Page/object-story references and daily metrics. Version mappings with source/account/Page context and permissioned content ownership.
- [ ] Store only needed metrics and source definitions/date/last-success; default impressions, link clicks, defined video views and separately labeled platform-attributed results when supplied. Spend/ROAS are capability-gated by agreement.
- [ ] A many-ad join cannot multiply sales rows; additive daily metrics sum compatible grains, reach stays non-additive, ratios use compatible total numerator/denominator. No inferential attribution from a photo or product-level total.
- [ ] Unknown fields remain unavailable and do not block money reads; removed creative retains lawful minimal historical reference and no broken cover.

Acceptance: one clip with multiple ads, mismatched Page/account, unavailable insights, permission loss and mixed metric definitions verified against source samples. Partner can inspect helpful performance without learning internal advertising controls or customer data.

## 7. Phase 5 — Operational proof and release

### R01 — Load, observability, security and restore

Files: `src/server/platform/observability/`; `app/api/{health,ready}/route.ts`; `tests/performance/partner-read.ts`; `tests/integration/isolation-matrix.test.ts`; `docs/runbooks/{imports,identity,backup-restore,incident}.md`.

- [ ] Measure architecture's proposed budgets on recorded hardware/network: 100k earning lines, 100 partners, 20 concurrent reads; warm API p95≤500ms, cold≤1500ms, mobile LCP p75≤2.5s; default Overview≤100KB/list≤150KB excluding images. Record actual figures and query plans, not just target labels.
- [ ] Measure portal-commit-to-visible-graph/number latency: target ≤45 seconds on a healthy active session under the same pilot load. Record source lag separately. Verify revision checks are small indexed reads, hidden/offline pauses, resume refresh, coalescing, revocation and late-response safety. Polling must not multiply imports or scan earnings per viewer; no claim of instant upstream data.
- [ ] Confirm all scoped reads/documents/exports, session revocation, stale generations and concurrent financial operations on real Postgres. Seed only synthetic load data in isolated database.
- [ ] Validate import last-success/lag alerts, correlation IDs, redacted logs, session/secret rotation procedures, backup and restore into an isolated target, document availability and retention policy. No production restore as a test.
- [ ] Resolve DB connection budgets across instances; imports cannot starve web. Optimize indexes/rollups first; defer new services unless measured failure warrants a revised boundary decision.

Acceptance: independent reviewer sees failure-mode evidence and measured limits. A static green suite or mocked OAuth alone does not meet this gate.

### R02 — Frozen release candidate and controlled pilot

Files: `docs/implementation/release-checklist.md`; `docs/runbooks/deployment.md`; CI/deployment configuration only when target is authorized.

- [ ] Record protected-main candidate SHA, dependency lockfile, migration list, build digest, web/import artifact pairing, test evidence and separate-model review. Current directory has no Git baseline; F00 must have resolved that first.
- [ ] Confirm domain/provider callback inventory, all three auth providers, business agreement input, source freshness and support owner. Establish feature flags for partner exposure, import scheduler and period publication independently.
- [ ] Prepare deployment with exposure/import/publication OFF, exact target binding and reversible verification; obtain explicit authorization for production migration/deploy/exposure and costs. Never treat this plan review as that approval.
- [ ] After authorized deploy, verify actual deployment ID+SHA+digest, health, isolated smoke and migration ledger; only then enable one invited pilot cohort under the agreed exposure decision. No automatic payment execution.
- [ ] Rollback stops new imports/publications/exposure and reverts compatible code; retains issued statements, evidence and audit. Failed migration requires ledger inspection; no blind retry or database erase.

Acceptance: recorded pilot outcome includes successful authorized login, accurate inspected period, source delay behavior and actual support path. Broader launch is a later owner decision.

## 8. Review and execution discipline

Each task produces a small implementation diff, relevant non-tautological checks, owner-visible evidence for UI work and an independent review. Root accepts the frozen candidate after checking findings. A worker's PASS is not root acceptance. Do not broaden tests repetitively after relevant checks pass without a new change or unresolved concern.

For every task record: input contract/version, actual files, command results, remaining external dependencies, commit SHA when Git exists and next task. Public-contract changes interrupt the affected slice for modulecommand reconciliation; unaffected work can continue.

Phase 1 is independently actionable after implementation authorization. Provider-console readiness is an A01 gate; real agreement/source precision is a G01 gate; source-owner feeds are an I01 gate; public exposure is an R02 gate. These prerequisites do not turn the entire frontend plan into a blocked project.

Deferred: global creator discovery, marketplace onboarding, in-app contract negotiation/e-sign, automatic wallet/payout gateway, cross-currency tax engine, media asset CMS, campaign/ads management, ticketing product, AI scoring, streaming infrastructure and new provider connector fleet. Add only after an actual pilot requirement justifies scope and ownership.

Independent Opus review and disposition: [review record](../../reviews/2026-09-07-partner-plan-review.md). The record must identify exact candidate hashes and actual returned model, with root acceptance limited to plan readiness.

### Execution procedure references

- Task execution: [subagent-driven-development](/Users/g/.agents/skills/subagent-driven-development/SKILL.md) or [executing-plans](/Users/g/.agents/skills/executing-plans/SKILL.md). One worker owns a bounded candidate; a separate reviewer critiques it; root verifies acceptance.
- Git baseline/release: [gitcommand](/Volumes/workspace/dev/ai-workspace/claude/skills/gitcommand/SKILL.md). Record working/main/deployed pointers, protected baseline, short branch, exact candidate checks and explicit deployment target/authorization.
- Boundary changes: [modulecommand](/Users/g/.agents/skills/modulecommand/SKILL.md). Reconcile affected ownership/contracts/trust/data/runtime boundaries, dependent consumers, compatibility, verification and rollback before continuing that slice.
- Continuity: [context-protocol](/Volumes/workspace/dev/ai-workspace/claude/skills/context-protocol/SKILL.md). Preserve detailed results on disk and update `.agent-work/context/` so the next worker resumes without replacing decisions with a lossy summary.
