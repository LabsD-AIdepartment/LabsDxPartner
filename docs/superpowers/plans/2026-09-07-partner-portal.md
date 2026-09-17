> Current implementation inventory (D116, 2026-09-11): [remaining-work audit](../../implementation/remaining-work-audit.md) distinguishes completed local behavior, historical receipts, missing web readiness/publication controls and external acceptance. Unchecked A01–A03 boxes below are not evidence those features remain unimplemented. Original acceptance requirements remain in force. [Release checklist](../../implementation/release-checklist.md) is preparation, not production approval.

> Current source-workflow amendment (D052, 2026-09-10): Marketing registers Ad IDs for Facebook, Shopee, Lazada and TikTok; automated API sync replaces generic per-file manual review as the next planned workflow. Company Marketplace is excluded. See [Ad ID integration design](../../design/ad-id-automatic-integration.md). Existing financial invariants and implemented approval/file-import controls remain; this amendment does not claim live support or authorize their removal.

# Labs D x Partner Implementation Plan

**Current access decision — D-025, 2026-09-09:** The owner replaces social-first login with invitation-only username/password accounts after the commercial agreement. [Invitation-only access](../../design/invitation-only-access.md) governs F03/F07/A01–A03 and release gates. Google/LINE/Apple setup, multi-provider linking/unlinking and Apple renewal are no longer requirements for this release. Existing source is preserved pending a coherent implementation transition.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans when implementation is authorized. Execute one bounded task, verify its acceptance evidence, and obtain independent review before advancing its gate. This document authorizes no deployment, provider-console mutation, customer access, payment or production migration.

**Goal:** Complete the small, understandable celebrity partner frontend first, then connect invitation-only username/password identity and accurate, inspectable partner earnings from existing systems.

**Architecture:** One modular web application and one logical PostgreSQL store. The browser reads partner-scoped local projections; existing ERP, Sale Dashboard and ChatMesh remain upstream authorities. A bounded importer refreshes projections outside the request path. Three primary menus remain Overview, My content and Transactions.

**Tech Stack:** Next.js + React + TypeScript, PostgreSQL + Drizzle, Zod contracts, TanStack Query, existing CSS theme tokens/CSS Modules, provisional Better Auth, Vitest and Playwright. Pin compatible versions in F00. No Redis, message broker, new ERP or provider connector suite for phase one.

**Authority:** [Architecture and data rules](../../design/partner-portal-architecture.md), [approved visual direction](../../design/phase-1-theme-design-system.md), [reduced scope and existing-system evidence](../../research/2026-09-07-partner-portal-reuse-scope.md). The larger original business proposal is historical; use these documents for execution.

**Original plan date:** 2026-09-07. The original no-Git/prototype-only baseline is historical. As of2026-09-09 F00–F08 have local candidates, A01/A02 and G01 have partial services; actual provider/data/release acceptance remains open. Individual receipts and `.agent-work/context/HANDOFF.md` identify current evidence and unfinished changes. Older unchecked boxes are acceptance requirements, not a current implementation inventory.

**Revision 2026-09-08:** [stack-fit decision](../../design/stack-fit-decision.md) removes any requirement to match Sale Dashboard's technology. Next.js remains selected on product-fit grounds after comparing Vite/Fastify, Vite/Hono, SvelteKit and Laravel. Automatic-refresh behavior is now explicit; [new review receipt](../../reviews/2026-09-08-stack-fit-review.md) applies to this revision. The original three-round review remains historical evidence for its exact candidate.

## 1. Scope and delivery order

**Whole-system review2026-09-09:** [Full20-task practicality review](../../reviews/2026-09-09-practicality-review.md) covers completed and pending work, business fit and architecture. Immediate sequencing now prioritizes G01 plus I01 source-contract discovery alongside native provider proof, before further generic financial/auth expansion. Preserve approved frontend and exact-money/access controls. D-025 explicitly replaces social linking requirements; optional-insight pilot scope still requires explicit resolution. Source/payment authority and real input grain determine which adapters/writers are actually needed; do not implement all listed source adapters by default. No application deletion or production exposure follows from this review.

| Phase | Deliverable visible to owner | Tasks | Exit gate |
|---|---|---|---|
| 0 — Contracts and foundation | Stable route/data map, exact money examples, reusable theme/components | F00–F02 | Fixture and server contracts agree; money examples pass |
| 1 — Complete frontend | All screens, responsive layouts and meaningful states using synthetic data | F03–F08 | Owner can walk the whole partner experience; UI-only acceptance |
| 2 — Identity and access | Invitation activation, username/password login, recovery, membership and secure sessions | A01–A03 | Credential/invitation/recovery journeys and cross-partner denial verified |
| 3 — Accurate data and finance | Scoped reads, reconciled approved-period import, immutable statements and payment recording | G01–G04 | One complete authorized partner/period reconciles end-to-end |
| 4 — Existing-system integration | Minimal approved source feeds and honest clip/ad performance | I01–I02 | Source replay, revision and coverage verified; no browser provider fan-out |
| 5 — Pilot readiness | Performance, recovery, monitoring and controlled deployment package | R01–R02 | Independently reviewed release artifact; exposure separately authorized |

Do not require live credentials to finish phase 1. Do not call phase 2 complete with fake auth or an untested invitation/password-recovery path. Phase 3 can use a finance-approved file if existing APIs lack adequate entitlement granularity; disclose manual cadence. Phase 4 adds only source routes needed by the pilot, not every marketplace integration. No parallel development of Better Auth and Auth.js.

Dependency spine: `F00 → F01/F02 → F03 → F04/F05/F06 → F07/F08`. After F08, advance `A01 → A02 → A03` alongside `G01 + I01 source discovery`. Actual source grain, authority and controls inform G01 before G02. The operational finance path remains `A03 + approved G01 → G02 → G03 → G04`; there is no confirmed-money publication or partner financial exposure before A02/A03 isolation is proven. Automate the selected I01 feed after the first reconciled path; add I02 only from useful available source fields. Start applicable R01 isolation, recovery and query checks as each capability exists, then complete the release evidence before R02. This reorders discovery and verification, not full-scope acceptance: all originally required functionality remains tracked unless the owner explicitly agrees a narrower pilot scope.

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

- [ ] Keep three navigation menus. Login uses username/password with no public sign-up. Invitation recipients choose username/password/confirmation after viewing invitation context. Support expired/used/revoked links, retry and suspended access; routine preapproved activation needs no second business approval.
- [ ] Implement access variants on one `/access` page keyed by safe reason codes, not a new route for every state. Reason codes never confer permissions.
- [ ] Preserve intended relative destination after authentication; invalid external return URLs never become links.
- [ ] Simulate state transitions only in isolated development scenarios. Login buttons in the production app must later call real auth, never set a mock identity cookie.

Acceptance: all access states are understandable on mobile; no finance screen exposed by an unauthenticated development-state accident in a production build. Real credential, invitation and recovery behavior is tested in A01–A03.

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

- [x] Separate earnings period, publication date, scheduled payment and actual payment. Show pending/part-paid/paid and explicit adjustments.
- [x] Statement explains opening balance, newly confirmed earnings, adjustments, settled obligation and closing balance; cash, withholding and other evidenced settlement components remain distinct.
- [x] Design download/export pending/error/ready and permission-denied states. Add ask-about-this-reference using the existing contact channel, without sending messages automatically.

Acceptance: partial-pay and correction examples explain the exact balance; sample download in development is explicitly synthetic. G03/G04 supply real ownership checks/files.

Local candidate implemented 2026-09-09. Author verification and remaining acceptance gates: `docs/implementation/transactions-frontend.md`. F07 is next; real payment recording and private document authorization remain later phases.

### F07 — Account and minimal staff operations frontend

Files: `app/(partner)/account/page.tsx`; `app/(staff)/ops/{partners,imports,periods}/page.tsx`; `src/features/{account,operations}/`; `tests/e2e/account-ops.spec.ts`.

- [x] Account contains agreement summary, connected methods, support and logout; link-conflict/final-method-unlink/recovery states are designed.
- [x] Staff-only shell contains partner invitation/membership/terms mapping, import exceptions, period review/publication and finance payment recording. No general ERP, ad manager or ticketing system.
- [x] Dangerous business actions show concrete partner/period/amount/evidence context and confirmation. Buttons remain development simulation until authenticated server services land.

Acceptance: partner navigation never exposes staff controls; scope/error/re-auth states covered; no promise of automatic bank payment or tax issuance.

Local candidate implemented 2026-09-09. Evidence and limitations: `docs/implementation/account-operations-frontend.md`. F08 acceptance is next; real identity and persistent staff writes remain later phases.

### F08 — Frontend acceptance and contract freeze

Files: `tests/e2e/partner-journeys.spec.ts`; `docs/implementation/frontend-acceptance.md`.

- [x] Run full routes across ready/empty/loading/error/partial/stale/unavailable/access states; all fixtures validated by F01 schemas.
- [x] Review day/dark, mobile/desktop, keyboard, long labels and portraits with the owner-visible preview. Record screenshots within project work area and list any remaining UI issue.
- [x] Verify no eager download of every clip/ad, no double loading shell, and no URL state that bypasses access. Record a screen-to-endpoint matrix.
- [x] Simulate a new published revision, an old response arriving late, hidden/offline/resumed tabs and a partner switch. Only changed active data refetches; the matching graph/cards update together; client financial totals are never incremented from event deltas.

Check: `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run verify:no-demo`. Exit means **frontend complete against contracts**, not authentication/data correctness in production. Change to real integration begins only after this UX checkpoint.

Local frontend candidate verified 2026-09-09: 147 unit/contract tests and 28 browser tests pass; production build and fixture exclusion pass. Receipt: `docs/implementation/frontend-acceptance.md`. Native200% zoom and independent/owner acceptance remain explicit release items; actual providers/data are subsequent phases.

## 4. Phase 2 — Real identity and partner isolation

### A01 — Maintained username/password authentication

- [ ] Inventory and adapt the pinned library's username/credential plugin, account schema, runtime configuration and native endpoints. Preserve one identity adapter; implement no new password engine.
- [ ] Normalize usernames consistently and enforce uniqueness in the database. Keep immutable user IDs, maintained password hashes, secure database sessions, login throttling and generic credential failure responses.
- [ ] Disable public registration and social entry/linking routes for this release. Credential creation is possible only through the guarded invitation flow. Validate every native bypass route, not only the visible form.
- [ ] Prove the maintained registration/reset adapter against isolated Postgres, including any library-required internal address; it is never a recovery destination. No Google/LINE/Apple credentials are needed for this path.

Acceptance: real credential/session behavior, password-manager support, concurrent username collision and throttling verified. Existing OAuth evidence is historical; it does not prove this new path.

### A02 — Preapproved invitation activation and verified recovery

- [ ] Staff bind an invitation to an approved partner, intended recipient/contact reference and capabilities; expiry/revoke/reissue are explicit. Sending uses the existing verified contact channel and deliberate staff action.
- [ ] GET/link preview never consumes an invitation. Explicit setup submission atomically creates the credential/account, activates the intended membership, consumes the invitation and records audit before a usable session is returned. Failed validation leaves the invite usable; concurrent redemption has one outcome.
- [ ] Existing-account recipients authenticate and accept the exact additional membership; no name/contact matching or automatic account merge.
- [ ] Keep server-side current membership checks, suspension and exact-target staff changes. Invitation recipients can never grant themselves staff privileges.
- [ ] Password change requires current authenticated proof. Forgotten-password recovery uses verified staff contact and an exact-account, expiring one-use reset link; successful reset revokes old sessions. Staff never see or assign the password.
- [ ] Inventory current database identities before any conversion. Applied migrations remain immutable; use new ordered migrations only when necessary. Preserve provider records and audits; no automatic credential conversion/deletion.

Acceptance: invalid/expired/revoked/replayed invitations and resets, failed account writes, concurrent redemption, suspension, forwarded-link delivery assumptions and two-partner isolation covered. Full boundary and transition: [invitation-only access](../../design/invitation-only-access.md).

### A03 — Connect invitation and credential frontend to real sessions

- [ ] Replace login/access/account fixture transport with the real credential and invitation services; finance fixtures remain isolated until G04.
- [ ] Walk staff-issued invite → username/password setup → authorized overview → logout → username login → verified reset through actual browser/server/database paths.
- [ ] Clear/abort scoped caches on logout, account switch, suspension and401/403. Keep private responses and per-request membership checks.
- [ ] Verify accessible Day/Dark forms and responsive states; preserve all approved partner presentation. Expired invitation and recovery failures have a clear existing support path.

Exit: invitation-only authentication, recovery and isolation proven in controlled staging. HTTPS deployment configuration remains required; external social provider acceptance is superseded by D-025. No live finance acceptance inferred.

## 5. Phase 3 — Reconciled partner numbers

### G01 — One real agreement, one period, source contract

Files: `docs/implementation/pilot-data-contract.md`; `src/server/adapters/approved-period/{schema,parse}.ts`; `db/schema/{content,earnings,imports,statements}.ts`; ordered new `db/migrations/` files.

Start after F08 in parallel with A01–A03 for agreement/source documentation and isolated schema work. No publication of confirmed money until identity/isolation gates have passed. This avoids leaving the main business-data uncertainty idle behind provider setup.

- [ ] Map one authorized partner's existing agreement to commission base, discounts/refunds, rate, effective dates, rounding, evidence grain, payment cadence and stacking/offset rules. Sample 10%/3% never becomes a default contract.
- [ ] Identify authoritative source per channel; map order/line/reference, revision, earned-time, collected/returned status and evidence. Explicitly record unsupported clip attribution and unresolved rows.
- [ ] Import already-approved fixed fees/bonuses as distinct evidenced earning lines when the actual agreement includes them. Do not build a new fee-negotiation/bonus-rule system.
- [ ] Select the actual source grain before fixing the import contract. If finance supplies an approved period summary plus a real breakdown file, represent that explicitly and expose only supported detail; the existing detailed-row parser is not evidence that summary-only input is supported. If authoritative detailed entitlements exist, use that adapter without building a redundant summary mode. Never fabricate order/clip rows.
- [ ] Define the selected approved-period import template with source coverage/control totals, stable references and original evidence access for staff; detailed mode also requires canonical entitlement keys. Approval is an authenticated review of an exact version and independent controls, not manual re-entry of every amount or a self-approved file hash. No raw customer PII in partner contracts.
- [ ] Create isolated test DB bindings and collision-free migrations; inspect target before execution. Never edit an applied migration or infer production migration approval.

Acceptance: finance/source owner can explain every input and total for the selected period. Unknown financial rules block that pilot's publication, not unrelated frontend work. Pilot contract is signed off as business input before the importer can publish confirmed money.

Preparation worksheet: `docs/implementation/pilot-data-contract.md` (2026-09-09). Real partner/agreement/period/source-owner approval still required; no synthetic rule promoted.

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
- [ ] Name one authoritative partner-payment writer before implementing persistence. Prefer importing existing approved finance records; only enable portal manual recording when explicitly assigned that responsibility. Preview controls do not assign authority. Require a named reason and evidence for any nonstandard settlement component. Record actual finance evidence, cash/withholding/other explicit components and applied obligation; idempotent payment references, partial allocations and no allocation above outstanding without an explicit credit rule. Corrections are append-only reversals/new entries, never hidden edits.
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

Execution has two slices: source discovery and a bounded authorized sample alongside G01 **before G02**; scheduled automation of the chosen feed after the end-to-end G04 path. The directory examples below are alternatives, not a requirement to implement three adapters.

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

Collect relevant evidence alongside A02/A03 and G02–G04 as those capabilities exist. Do not wait for optional ad metrics to start isolation, restore or query checks. Final R01 acceptance still covers the complete agreed release scope; no original requirement is silently waived. The numerical load budgets below are provisional engineering targets, to be calibrated against actual pilot volume and headroom.

Files: `src/server/platform/observability/`; `app/api/{health,ready}/route.ts`; `tests/performance/partner-read.ts`; `tests/integration/isolation-matrix.test.ts`; `docs/runbooks/{imports,identity,backup-restore,incident}.md`.

- [ ] Measure architecture's proposed budgets on recorded hardware/network: 100k earning lines, 100 partners, 20 concurrent reads; warm API p95≤500ms, cold≤1500ms, mobile LCP p75≤2.5s; default Overview≤100KB/list≤150KB excluding images. Record actual figures and query plans, not just target labels.
- [ ] Measure portal-commit-to-visible-graph/number latency: target ≤45 seconds on a healthy active session under the same pilot load. Record source lag separately. Verify revision checks are small indexed reads, hidden/offline pauses, resume refresh, coalescing, revocation and late-response safety. Polling must not multiply imports or scan earnings per viewer; no claim of instant upstream data.
- [ ] Confirm all scoped reads/documents/exports, session revocation, stale generations and concurrent financial operations on real Postgres. Seed only synthetic load data in isolated database.
- [ ] Validate import last-success/lag alerts, correlation IDs, redacted logs, session/secret rotation procedures, backup and restore into an isolated target, document availability and retention policy. No production restore as a test.
- [ ] Resolve DB connection budgets across instances; imports cannot starve web. Optimize indexes/rollups first; defer new services unless measured failure warrants a revised boundary decision.

Acceptance: independent reviewer sees failure-mode evidence and measured limits. A static green suite or mocked OAuth alone does not meet this gate.

D105 local evidence (2026-09-11): native HTTPS reads over 100 partners / 100k earning lines / 20 closed-loop workers passed warm p95 50.67ms, max 442.26ms, response 2,739 bytes across 58,867 individually checked requests. During the same load, the actual native browser observed payment and reversal payout updates within conservative 14.694s / 19.634s bounds. See `docs/implementation/browser-refresh-acceptance.md`. This advances the warm-read and two healthy active-session update cases only; cold/history, mobile LCP, observability/retention and the remaining R01 requirements remain open.

D108 local evidence (2026-09-11): five fresh built Next processes each served a first burst of 20 distinct partners without API warm-up, covering the same 100k-row/100-partner population. API p95 164.61ms, max 165.69ms, max JSON 2,832 bytes; all per-response financial controls matched. See `docs/implementation/cold-overview-acceptance.md`. This measures process-cold loopback HTTP with a running, potentially warm database/OS cache. Disk-cold database reads, large per-partner histories/query plans, mobile LCP and the rest of R01 remain open.

D109 local evidence (2026-09-11): Overview now aggregates daily groups before repeated summary scans/current-metadata joins, retaining per-line rounded money and original counts. A24-month/120k-line single-partner scenario passed100 exact reads in20-request bursts through the built app's unchanged max10 pool: p95224.34ms, max260.33ms, max25,466bytes. Actual annual SELECT55.424ms/zero temporary blocks versus original214.883ms/spilled intermediates. See `docs/implementation/finance-history-acceptance.md`; diagnostic fixture-pool2 runs remain separately identified. This advances the large-history/query-plan case, not disk-cold/TLS/browser/mobile/retention or fullR01 readiness.

### R02 — Frozen release candidate and controlled pilot

Files: `docs/implementation/release-checklist.md`; `docs/runbooks/deployment.md`; CI/deployment configuration only when target is authorized.

- [ ] Record protected-main candidate SHA, dependency lockfile, migration list, build digest, web/import artifact pairing, test evidence and separate-model review. A local Git baseline exists; remote/protected-main and release-artifact evidence remain separate requirements.
- [ ] Confirm HTTPS domain, invitation/credential/recovery acceptance, business agreement input, source freshness and support owner. Establish feature flags for partner exposure, import scheduler and period publication independently.
- [ ] Prepare deployment with exposure/import/publication OFF, exact target binding and reversible verification; obtain explicit authorization for production migration/deploy/exposure and costs. Never treat this plan review as that approval.
- [ ] After authorized deploy, verify actual deployment ID+SHA+digest, health, isolated smoke and migration ledger; only then enable one invited pilot cohort under the agreed exposure decision. No automatic payment execution.
- [ ] Rollback stops new imports/publications/exposure and reverts compatible code; retains issued statements, evidence and audit. Failed migration requires ledger inspection; no blind retry or database erase.

Acceptance: recorded pilot outcome includes successful authorized login, accurate inspected period, source delay behavior and actual support path. Broader launch is a later owner decision.

## 8. Review and execution discipline

Each task produces a small implementation diff, relevant non-tautological checks, owner-visible evidence for UI work and an independent review. Root accepts the frozen candidate after checking findings. A worker's PASS is not root acceptance. Do not broaden tests repetitively after relevant checks pass without a new change or unresolved concern.

For every task record: input contract/version, actual files, command results, remaining external dependencies, commit SHA when Git exists and next task. Public-contract changes interrupt the affected slice for modulecommand reconciliation; unaffected work can continue.

Phase 1 is independently actionable after implementation authorization. Credential/invitation adapter readiness is an A01/A02 gate; real agreement/source precision is a G01 gate; source-owner feeds are an I01 gate; public exposure is an R02 gate. These prerequisites do not turn the entire frontend plan into a blocked project.

Deferred: global creator discovery, marketplace onboarding, in-app contract negotiation/e-sign, automatic wallet/payout gateway, cross-currency tax engine, media asset CMS, campaign/ads management, ticketing product, AI scoring, streaming infrastructure and new provider connector fleet. Add only after an actual pilot requirement justifies scope and ownership.

Independent Opus review and disposition: [review record](../../reviews/2026-09-07-partner-plan-review.md). The record must identify exact candidate hashes and actual returned model, with root acceptance limited to plan readiness.

### Execution procedure references

- Task execution: [subagent-driven-development](/Users/g/.agents/skills/subagent-driven-development/SKILL.md) or [executing-plans](/Users/g/.agents/skills/executing-plans/SKILL.md). One worker owns a bounded candidate; a separate reviewer critiques it; root verifies acceptance.
- Git baseline/release: [gitcommand](/Volumes/workspace/dev/ai-workspace/claude/skills/gitcommand/SKILL.md). Record working/main/deployed pointers, protected baseline, short branch, exact candidate checks and explicit deployment target/authorization.
- Boundary changes: [modulecommand](/Users/g/.agents/skills/modulecommand/SKILL.md). Reconcile affected ownership/contracts/trust/data/runtime boundaries, dependent consumers, compatibility, verification and rollback before continuing that slice.
- Continuity: [context-protocol](/Volumes/workspace/dev/ai-workspace/claude/skills/context-protocol/SKILL.md). Preserve detailed results on disk and update `.agent-work/context/` so the next worker resumes without replacing decisions with a lossy summary.
