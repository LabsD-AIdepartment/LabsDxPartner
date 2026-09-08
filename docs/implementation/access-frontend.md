# F03 — Public access frontend and shell

Implemented 2026-09-08 as a local, solo-authored candidate on the existing foundation branch. No OAuth, sessions, membership database or partner financial access is implemented here. F02 native 200% zoom remains an open acceptance item; its shared contracts support this additive local work.

## Behavior

- `/` redirects to `/login`. Login provides Google, LINE and Apple entry controls, a clear connection-unavailable notice, invitation guidance and the existing Day/Dark theme. Audio stays off public routes.
- `/access` uses nine allowlisted presentation reasons: invite required, pending, expired/used invite, cancelled, retry, suspended, provider unavailable and session expired. Each gives an understandable recovery action. Unknown/repeated reasons fall back to invite required; these are informational screens, not authenticated status lookups.
- Safe relative destinations survive provider-unavailable → retry navigation. The routing helper allowlists known partner paths and rejects external URLs, encoded/path traversal ambiguity, query strings, fragments, control characters and repeated parameters. Filter persistence can be added later through explicitly typed filter contracts; arbitrary return URLs are not accepted.
- `/overview`, `/content` and `/transactions` always invoke the central deny-only server gate and redirect to login with their intended destination. Neither cookies nor reason/state query parameters can grant access. The partner layout currently loads no private data; A03 must add verified session/membership authorization before any private reads or shell identity appear.
- `PartnerShell` reuses AppShell, supplies three-menu links and page headings without punctuation. Existing gallery button callbacks remain compatible. F04–F07 page content is not supplied by this work.
- `/access-preview` is a development-only journey harness. It injects local presentation callbacks into the same login/access components and allows switching all states, simulating approval, inspecting three shell destinations and exiting the demonstration. It creates no auth cookie, account, capability or provider session. `state=active` there has no meaning anywhere else.
- Production denies both preview routes and replaces dev modules through build-phase aliases. The bundle guard now scans access-preview markers as well as foundation markers.

## Module responsibilities

Routes compose login presentation and the shared shell; login/shell consume shared UI/theme. The URL sanitizer belongs to `shared/routing` so the deny-only server gate does not depend on the login feature. Dev harness imports product components; product components never import harness/scenario modules. The unit of build/runtime/deployment remains one Next app. There is no new datastore, upstream contract, money authority or auth writer.

Additive route/components and optional link navigation preserve the existing callback consumer. Rollback restores the previous root preparation page and removes F03 additions; no database or external state needs rollback. Real provider controls must replace the unavailable path only in A01–A03 after callback and identity-isolation proof. No production, credential, source-system or database mutation was performed.

## Verification receipt

Evidence is local under `.agent-work/20260908-access/evidence/`:

- `tests-initial.log`: 60/60 tests across nine files, including unsafe destinations, unknown reasons, all access recovery states, injected preview callbacks, both navigation modes and deny-only gate behavior. Existing financial/query tests also passed.
- `typecheck-initial.log`: route type generation and TypeScript pass.
- `build-initial.log`: production build and fixture bundle exclusion pass. `/login` and `/access` are rendered routes; protected routes are dynamic; dev harnesses deny access.
- `production-http-*.json`: 17 checks pass. Root redirects, login responds 200, previews respond 404 (including active-state query), all three partner routes redirect despite synthetic cookies and active parameters; nine access reasons plus unknown reason return safe login destinations for an external next input.
- Existing in-app browser: public Google entry → unavailable → retry, invitation expansion, Day/Dark switch; all nine dev access states at measured 390 CSS px without horizontal overflow. Preview LINE → pending → simulated approval → My content → Transactions worked with actual link navigation and matching headings. Login at measured 767 and 1440 CSS px had no horizontal overflow.
- Browser evidence includes the state matrix JSON and timestamped mobile/desktop captures. The inherited browser DPR is 0.9; screenshot raster clipping/stale regions prevent claiming pixel-exact acceptance from captures alone. DOM geometry and actual interactive state underpin the responsive findings.
- Native browser 200% zoom remains unverified: supported reset key did not change measured DPR/width. Narrow viewport is not a substitute. Three additional E2E specifications are authored; standalone Playwright runner and hosted CI were not run, consistent with using the prescribed browser runtime for this batch.

This is author verification, not independent code review, full F08 acceptance, successful OAuth, verified identity isolation, database reconciliation or realtime performance. Independent review and remote/protected-main/CI gates remain before merge/release. Next local task is F04 overview; carry forward the explicit F02 zoom and review items.
