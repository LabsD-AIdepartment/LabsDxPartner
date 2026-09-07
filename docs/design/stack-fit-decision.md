# Stack selection from portal requirements

Updated 2026-09-08. Change Mode: replace the selection rationale after the owner removed any need to match Sale Dashboard. This is planning, not a runtime benchmark or implementation. Previous reviews bind their frozen candidates; the revision has its own receipt.

## Decision

Recommend **Next.js + React + TypeScript, PostgreSQL + Drizzle, Zod, TanStack Query and provisional Better Auth**, with current CSS tokens/CSS Modules and Vitest/Playwright. Deploy one modular Node application; select supported LTS and compatible package patches at F00. Node 24 is LTS at this checkpoint.

**Matching Sale Dashboard receives zero selection weight.** ERP, Sale Dashboard and ChatMesh are external API sources. We do not adopt their framework, database schema, shared internal login or code packages merely to consume data. This replaces the old familiar-ecosystem justification.

The same stack survives a fresh comparison because the integrated route/layout/asset/auth-handler surface suits a small application with demanding social login and financial access. It is a responsible choice among credible alternatives, not experimentally proven universal superiority. The existing app is vanilla HTML/CSS/JS; there is no implemented React/Next investment to preserve.

## 1. Decision criteria

In order of importance:
1. Real Google/LINE/Apple login through maintained integration, with server-side membership checks for every financial request.
2. Exact relational money, duplicate/revision reconciliation, concurrent publication/payment safety and immutable statements. These primarily depend on data design and tests, not the web framework.
3. Small operational footprint: one web release, explicit API contracts, limited custom routing/auth/asset glue and clear owners.
4. Interactive filters/charts/portraits and three menus, with all frontend states completed before live integration.
5. Fast first view and efficient refresh. Private pages have no SEO requirement; server rendering can still help initial display/session resolution, so lack of SEO does not by itself favor a SPA.

Actual traffic distribution, hosting cost, provider-account readiness and comparative framework benchmarks are unknown. No staffing familiarity, hiring availability or performance scores are invented as selection evidence.

## 2. Alternatives evaluated

| Candidate | Fit | Tradeoff and decision |
|---|---|---|
| Next.js + React + server API | Integrated routes/layout/assets, early server session boundary and maintained Better Auth host handler; explicit REST API still possible | Selected. Constrain server/client caching complexity as below. No assumption it is fastest, cheapest or required by upstream systems |
| React + Vite + Fastify, same origin/release | Clear SPA/API boundary and independent frontend development | Initially proposed, then declined as default after review: extra static/deep-link/cache/plugin assembly and sensitive auth bridge without demonstrated net simplification. Valid lateral alternative, not an established improvement |
| React + Vite + Hono, same origin/release | Clear SPA/API flow; Better Auth forwards the raw Web Request, avoiding the Fastify sample body-conversion concern | Credible lean API choice. Still assembles browser routes/static fallback/first-render/cache policy. Reconsider if an independently owned API becomes an actual product requirement; no inherent performance inferiority claimed |
| SvelteKit + Svelte | Integrated routes/endpoints, Node deployment and documented Better Auth integration | Close credible alternative. No dismissal based on familiarity or alleged auth weakness. React is chosen for the planned component/TanStack Query approach; there is no existing React reuse advantage. Comparative effort/performance is unmeasured |
| Laravel + interactive frontend | Strong when substantial staff CRUD, queue and administrative workflows dominate | Those capabilities are not decisive for our deliberately small staff surface. PHP is not inferior; reconsider if internal operations become the main product |

Next.js over SvelteKit is an engineering judgment, not proven superiority. Against the evaluated Fastify SPA it avoids known extra host-integration work. The language/framework behind an upstream API has no effect on this decision.

PostgreSQL is selected independently for the relational earnings/statement/settlement model, exact integer/numeric storage, constraints and transactions. MySQL can also meet these needs. Drizzle is selected for typed schema and SQL-like query visibility, not a speed guarantee over Prisma or SQL. Financial tests and query plans remain authoritative.

Supabase is an optional PostgreSQL/storage host, not a competing frontend framework or mandatory auth choice. Document-oriented storage is not the default for this relational statement model; this is a fit judgment, not a claim that other databases lack transactions. No hosting vendor is chosen to match another Labs D project.

## 3. Use a restricted, explicit application structure

| Layer | Owns | Limit |
|---|---|---|
| Next.js routes/layouts | Route matching, shell, server session/access boundary and initial display | No financial business formulas embedded in pages |
| React + TanStack Query | Interactive components, filters, active query cache/cancellation/refresh | No browser DB access, persistent money cache or optimistic invented financial totals |
| `/api/v1/partner/*` | Versioned REST input/output, scope checks and service dispatch | No client partner-ID authority or internal admin API passthrough |
| Domain modules | identity/partners/content/earnings/statements/imports | Pure money/domain logic imports no Next request/cookie/cache primitives |
| PostgreSQL + Drizzle | Exact records, indexes, consistent reads, transactions and uniqueness | No bigint/numeric-to-floating-Number conversion for money |
| Zod | Runtime validation for API/import input and public output | TypeScript alone is not input validation |
| Better Auth | Social-provider/session/linking protocol behind identity wrapper | Social identity/email does not grant partner membership |
| Private storage | Authorized statement/evidence files | No public financial files or customer PII |

One package/lockfile and one Node web deployment under one HTTPS origin. Optional scheduled import is a bounded separate process from the same release artifact/SHA, independently enabled. No Redis/broker/permanent worker/microservice suite initially. Container/self-hosted deployment remains possible; Next.js is not a Vercel commitment.

Keep one explicit API for financial reads/writes; no second money-write path via Server Actions. TanStack Query owns interactive server-state. Server rendering resolves shell/access, not another independent financial cache. If later prefetching initial money data, use the identical scoped service contract, seed the client query cache and test no duplicate fetch; do not add it before measured need.

Financial/session responses are private/no-store and excluded from shared framework/CDN caches. Public versioned assets may be cached. Navigation cookie-presence checks are not authorization: every API/object/document request validates actual session/current membership. Domain services can later use another host adapter without rewriting money rules.

## 4. Authentication gate

Use the maintained Next.js handler (`toNextJsHandler`) rather than manually reconstructing callbacks. This reduces custom bridge code but does not prove provider behavior. A01 must test real LINE without email; Apple first/repeat/relay and form-urlencoded POST; repeated Set-Cookie; original body/content type through the proxy; state/nonce/browser binding; external HTTPS origin; redirect allowlists. No blanket CSRF/SameSite bypass.

The Fastify example currently reconstructs request bodies with JSON.stringify. That is a concrete reason not to copy it for Apple callbacks without proof; it does not mean Fastify cannot support Apple. Hono receives the raw Web Request and SvelteKit has a documented maintained handler, so the criticism must not be generalized to them.

Better Auth remains provisional. If the pinned version fails provider/profile acceptance, evaluate a documented Auth.js integration for the chosen host before real identities. No dual engines, unproven custom OAuth or mock-provider completion claims.

## 5. Query and automatic refresh

Retain bounded indexed SQL, cursor pagination, exact sums and one Overview response. Initially aggregate the pinned generation using SQL; add materialized summaries only after query/index tuning and measured need.

Add authenticated `GET /api/v1/partner/changes` returning separate earningsRevision, settlementsRevision, metricsRevision and noticesRevision, plus per-source dataThrough and portal publication timestamps. These revisions advance transactionally with committed data and read from small local metadata, not full earnings scans. Membership is checked regardless of revision.

On visible online pages check every 30 seconds with 0–5 seconds jitter; pause hidden/offline; check immediately on visible/reconnect. Coalesce requests and use bounded failure backoff. Refetch only changed active query groups; update matching earnings cards/graph from one validated generation, with separate settlement as-of. Do not add event deltas to client financial totals. Clear caches on logout, identity/partner switch and 401/403.

Proposed acceptance target: committed portal changes appear within 45 seconds on an active healthy session under recorded pilot load. This is near-realtime polling, not a hard SLA or instant upstream data. Measure upstream lag, import lag and browser refresh lag separately. The original 15-minute/source-available import cadence remains a separate setting.

SSE is an optional later transport for those revision notices if seconds-level updates become a documented need. It cannot accelerate slow source APIs. Evaluate connections, scope/revocation, reconnect and lost-event recovery first; no realtime service is selected now.

## 6. Impact and authorization

B1: stack-neutral upstream API contracts. B3/B4: same domain modules, clearer web/query roles. B5/B6/B7: one package/web release plus bounded import retained. B8: financial authority unchanged; revision metadata added. B9: current social/session/partner/staff trust checks retained. B10: portal owner owns host/query/auth composition; upstream owners own API facts. B2 business capabilities unchanged.

Affected tasks: F00 removes ecosystem affinity; F02/F08 specify refresh behavior and one query owner; A01 uses maintained host handler and callback tests; G04 adds changes endpoint; I01 consumes stack-neutral source contracts; R01 measures update latency/cache isolation; R02 remains one known release. Money rules, screen scope, 20-task order and parallel business-contract discovery remain intact.

No runtime/data migration is needed now: the app has not been implemented. Preserve all previous reviewed files in frozen evidence, attach a new review receipt, and do not inherit old PASS silently. If later measurements justify another framework, preserve API/domain contracts and reassess web/auth/build consumers and tests before changing them.

Allowed now: analysis, primary-source checks, documentation revisions and previously requested independent Opus review. No application implementation, provider/infra provisioning, migration, deployment, public exposure or bank action is performed here.

## 7. Sources and review

- [Next server/client model](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Better Auth Next handler](https://better-auth.com/docs/integrations/next).
- [Vite](https://vite.dev/guide/), [React Router modes](https://reactrouter.com/start/modes), [Fastify](https://fastify.dev/docs/latest/Guides/Getting-Started/), [Fastify static](https://github.com/fastify/fastify-static), [Better Auth Fastify example](https://better-auth.com/docs/integrations/fastify).
- [Hono Node](https://hono.dev/docs/getting-started/nodejs), [Better Auth Hono](https://better-auth.com/docs/integrations/hono).
- [SvelteKit](https://svelte.dev/docs/kit/introduction), [Better Auth SvelteKit](https://better-auth.com/docs/integrations/svelte-kit).
- [Laravel Socialite](https://laravel.com/docs/13.x/socialite), [Laravel queues](https://laravel.com/docs/13.x/queues).
- [Node release status](https://nodejs.org/en/about/previous-releases), [TanStack refetch](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).

Actual Opus4.8 reviewed the initial Fastify proposal and called it a defensible lateral choice, not demonstrated improvement, highlighting extra host/auth work. Root used that feedback to retain Next.js on product-fit grounds. Final revised-file review: [stack reassessment review](../reviews/2026-09-08-stack-fit-review.md). No runtime benchmark or actual provider acceptance is implied.
