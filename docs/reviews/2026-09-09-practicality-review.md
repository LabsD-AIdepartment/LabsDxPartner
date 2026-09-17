# Whole-system practicality review — Labs D x Partner

2026-09-09 · Source-based author review following the owner's scope correction.
Baseline: `53350b07a65ac9230ef5e8cb33915c035ed46832`, with an unfinished local OAuth experiment. This is not an independent review or a new browser acceptance run.

The owner explicitly clarified that this review covers **the entire system and all20 planned tasks, including completed work**, not only staff periods or the current auth experiment. Sections below add a complete task disposition, business fit, architecture assessment and delivery changes. It does not silently delete earlier requirements.

Follow-through later2026-09-09: the callback test failure below was traced to beforeAll spies being reset before each test. [Repair receipt](../implementation/oauth-callback-boundary.md) records48 passing isolated PostgreSQL tests, including native callback rollback/concurrency. That supersedes the failure status for the new candidate only; the findings below remain the historical review and do not imply real-provider or fullA02 acceptance.

## Current-state reconciliation — 2026-09-09, whole-plan follow-through

This section supersedes historical implementation status in the tables below while preserving the original findings. Current committed baseline is `8396df55498bfe569acb4a343779893ca7917593` on `feat/portal-foundation`; there is an uncommitted exact-target contract/UI batch. No runtime, provider, upstream, performance or independent acceptance was newly performed for this documentation review.

| Finding | Current state | Remaining action |
|---|---|---|
| Native callback experiment | Repaired local candidate at8396df5; receipt records48 isolated PostgreSQL tests and190 unit tests | Real Google/LINE/Apple browser proof, recovery and session wiring remain open. Earlier failure is not current evidence against the library |
| Ambiguous membership/provider commands | D-023 dirty source now shares exact user/account IDs and revisions across schemas, UI and services | Verify multiple members/multiple same-provider methods, stale selection, all consumers and rendered layouts before accepting or exposing |
| Source grain and approval | Detailed intake remains one candidate; actual agreement/period and summary-only alternative unresolved | Select actual source with finance; no invented granular detail or duplicate manual entry |
| Payment ownership and generic other component | Still unresolved; preview is not an operational ownership decision | Consume finance payment records if authoritative; require explicit assignment and named/evidenced components for any portal writer |
| Operational support/notifications | Frontend paths exist; real owner/destination and actual notice history still need wiring | Use existing support with scoped references and only real statement/payment events |
| Overall milestone | F00–F08 local candidates; A01/A02/G01 partial; remaining tasks not operational | Prove one complete real partner/period before extending automation |

The practicality test for each feature is: **who uses it, what decision or task it enables, which system owns its input, and how completion is demonstrated**. A screen, contract or green mock test alone is not a completed business workflow.

The canonical dependency text now separates I01 discovery from automation and starts R01 evidence alongside implemented capabilities. It retains all task IDs and full release gates. This corrects contradictory old sequencing rather than adding another phase.

## Conclusion

The three-menu partner product is appropriate. Several implementation details and the sequence have become heavier than the demonstrated need. Keep the approved presentation and the controls that make money and access trustworthy; simplify staff interaction and prove one actual partner journey before expanding automation or identity lifecycle machinery. Completed frontend candidates are reusable work, not a reason to enable every simulated command in the pilot.

The product must answer five questions: What did I earn? Which clips contributed? How was it calculated? When and how much will I be paid? Who can resolve a discrepancy using the same reference?

## Feature dispositions

| Area | Practical first implementation | What to simplify or sequence later | Reason / exit evidence |
|---|---|---|---|
| Overview | Confirmed commission, independently dated unpaid/next payout, trend and top clips; retain portrait and approved layout | Calculation and source metadata open on demand; avoid repeated explanations in every card | A partner can understand position quickly and follow one amount into detail |
| Content | Continuous portrait-cover library, search/filter, commission and status; detail with a few useful metrics | Keep granular calculation and ad breakdown collapsed; render unavailable honestly without building new ingestion merely to fill every metric | One clip with several ads must never multiply earnings |
| Transactions (F06) | Period, earnings, paid/unpaid, payment date/status, downloadable statement and evidence | Explain adjustments/withholding only where applicable; avoid ledger terminology on the first screen | Issued amount, actual payment and remaining balance reconcile; no silent rewriting of history |
| Account | Agreement summary, current sign-in method, support and logout | Self-service multiple-provider linking/removal is not the prerequisite for proving ordinary login. Consider later pilot scope only with an explicitly accepted recovery alternative | Google/LINE/Apple login remain required; email equality never grants partner access |
| Staff partner access | Invite, verify intended person, activate/suspend, map an approved agreement | No generic CRM, permission-builder or contract negotiation engine | Staff target an exact person/membership and changes are audited |
| Staff periods | Compact period list: partner, period, amount, status, exception count, primary next action; open detail for approval/evidence/payment | Technical generation IDs and detailed controls belong in disclosure. Do not expand payment forms on every row | Staff can identify what needs action without reading implementation metadata |
| Staff imports | Last successful update, meaningful blocked rows and source/evidence reference | Source code/manifest typing is a transitional adapter interface, not the intended recurring staff workflow; choose a configured source/file | Operators fix source facts and retry; they do not manually repair generated totals |
| Payment recording | Read confirmed payments from the authoritative finance source where available | Enable a portal manual recording path only if that is the agreed owner; never independently edit the same payment in both systems | One writer, stable payment reference, exact applied amount and evidence |
| Support | Existing verified contact path with a statement/clip reference | No new ticketing/chat service or automated customer sends | A real support owner can retrieve the same record |
| Refresh | Existing visible-tab revision polling; refresh only changed active data | No WebSocket service, broker, Redis or continuously running worker without measured need | Accurate freshness label; portal commit-to-screen target is separate from upstream delay |
| Operations | Known artifact, scoped logs, failed-import alert, backup/restore and basic measured query budgets | No enterprise operations suite; current synthetic load targets are test budgets, not established demand | Demonstrate isolation, recoverability and acceptable performance for the agreed pilot |

## Concrete findings in the implementation

- `src/features/operations/PeriodEditor.tsx` already collapses the payment form, but prints generation, exclusions and evidence inline for every period. Its payment draft has a generic “other settlement” input without a visible explanation field. Keep the accounting capability but require named, evidenced components before enabling real writes; hide the optional input until needed.
- `src/features/operations/OperationsPage.tsx` asks staff to type a source identifier and evidence reference. That is sufficient for a synthetic command seam, not yet a usable recurring import workflow. Select configured sources and approved files instead of asking finance users to know technical identifiers.
- `src/features/transactions/SettlementBridge.tsx` uses “ยอดชำระภาระแล้ว”. Preserve its exact reconciliation but use accessible wording such as “ยอดที่ชำระแล้ว” with cash/withholding explained in detail. This is a proposed copy refinement, not an accounting-rule change.
- `src/features/content/ContentDetail.tsx` already implements disclosure for calculation, performance and ads. Retain it. Do not rebuild this as a large advertising dashboard.
- The unfinished `identity/oauth-boundary.ts` adds 248 lines of custom async context, transaction routing and commit coordination. The focused native-link test currently fails with `invalid_code`. This may be a provider-stub/test wiring issue; it does **not** prove Better Auth is broken. It does mean this experiment cannot be treated as accepted infrastructure. Investigate the native path and supported lifecycle hooks before adding more machinery.
- The pilot worksheet still lacks an actual approved agreement, source controls and payment authority. Adding more generic financial cases before closing those inputs risks implementing rules LabsD does not use. Existing exact arithmetic and replay protection remain necessary.

## Whole-plan disposition: all20 tasks

Status is implementation maturity, not customer acceptance. Historical passing suites apply to their recorded commits, not the current unfinished auth tree.

| Task | Evidence-backed state | Disposition and concrete adjustment | Business reason |
|---|---|---|---|
| F00 baseline | Implemented local; remote/CI/release gaps remain | Keep one pinned application/toolchain and fixture exclusion. Reconcile stale plan wording that still says no Git repository | Repeatable releases and no accidental demo data exposure |
| F01 contracts/money | Implemented local math/contracts | Keep exact amounts, explicit states and reconciliation. Freeze only rules required by the first real agreement; do not expand a general rule engine. Reconcile frontend command schemas before wiring | Avoid paying twice or displaying unsupported entitlement |
| F02 shared design/query | Implemented; native zoom/acceptance open | Keep shared16px floor, approved layout, responsive components and scoped cache. No new design framework. Audio remains optional and non-blocking; do not remove the requested control | Readability and consistent behavior across every page |
| F03 login/access | Implemented synthetic journeys | Keep three social login choices and one access-state page. Consolidate the staff invitation journey into a single clear onboarding path | Partners should not need technical setup or understand account states |
| F04 Overview | Implemented synthetic | Preserve portrait/cards/charts. Prioritize earnings, outstanding and next payment; explain different periods clearly. Provide compact unassigned/fixed-amount detail when totals need it | Quick understanding without pretending every earning belongs to a clip |
| F05 content/ads | Implemented synthetic | Keep continuous covers and inspectable detail. Clip/ad performance remains read-only and proportional to supplied data. Missing optional metrics must not create mandatory connector work | Demonstrate content contribution without building Ads Manager |
| F06 transactions | Implemented synthetic | Keep statement/payment evidence and revisions. Simplify initial vocabulary and show uncommon settlement components conditionally | This is a core trust feature, not optional administrative overhead |
| F07 account/staff | Implemented synthetic; command gaps known | Keep agreement/support/logout and minimal staff flows. Use exact membership/method targets; compact period list; real-source selector; no generic admin suite | Small team can operate the portal without maintaining duplicate business records |
| F08 frontend acceptance | Local candidate verified historically | Keep risk-based cross-page/format/access checks; finish native zoom and actual owner review. Do not repeat an entire mock-development phase or treat earlier acceptance as real-data proof | Protect the design the owner already approved |
| A01 providers | Adapter local; real acceptance pending | Keep one maintained auth library; prove native three-provider login before growing custom lifecycle hooks. Failed synthetic callback investigation precedes library replacement | Authentication should be dependable infrastructure, not a project within the project |
| A02 access/lifecycle | Membership/invite/unlink candidates; callback experiment failing | Keep immediate scoped authorization and audited access changes. Separate ordinary access from multi-method self-service; recovery stays required. Consider postponing public linking/removal only with an explicit pilot scope and verified recovery | Limit complexity without accepting account takeover or orphaned access |
| A03 session wiring | Not started | Wire maintained sessions and current memberships, clear stale user caches, and test actual browser journeys after prerequisites. Do not add a second auth state machine | Login must reliably lead to only that person's records |
| G01 real agreement/source | Strict intake candidate; actual inputs missing | Move to highest priority alongside provider proof. Select actual source grain, financial authority and one approved period. Existing row-level parser is one adapter, not the definition of all valid source evidence | Prevent months of technically correct work around the wrong business input |
| G02 import/calculation | Not started | Implement one selected source mode first: approved entitlement import OR portal calculation of authoritative order facts under an approved agreement. Preserve replay/correction/completeness, but do not require every source to support every mode | One authoritative payable amount, no repeated ERP/ChatMesh sales |
| G03 statements/payments | Not started | Preserve issued versions and evidence. Resolve payment writer first; import finance records if sufficient. Reuse authorized existing document storage where it meets requirements; new bucket is not automatic | Trustworthy history with the smallest operational burden |
| G04 scoped reads | Not started | One Overview response, bounded indexed detail reads, generation-consistent earnings and separate settlement freshness. Keep current polling strategy and exact exports | Fast pages and amounts that agree without extra services |
| I01 source integration | Not started | Move discovery/contract sampling ahead of G02; automate the chosen feed after one verified import. Do not instantiate ERP, Sales and ChatMesh adapters simply because all are listed | Reuse the minimum sufficient upstream facts |
| I02 performance | Not started | Integrate only useful available clip/ad fields; no inferred credit or hidden spend. Optional unavailable metrics need not block a finance pilot if explicitly scoped and honestly presented | Insights add value only when they are reliable and understandable |
| R01 operating proof | Not started | Keep access/isolation, restore, import-failure and measured query tests. Calibrate load to an agreed pilot with headroom; published100partner/100kline targets are provisional tests, not known requirements | A small portal still needs recovery and reliable money, but not enterprise infrastructure |
| R02 release | Not started | Keep reviewed frozen artifact, restricted cohort, named business/support owners and controlled exposure. No automatic production launch | First real use is a business validation, not merely a successful build |

## Business fit: what this product should and should not decide

The portal supports an existing commercial agreement; it is not a marketplace choosing compensation for creators. Model choices below are design options from the earlier research, not newly validated market claims, legal advice or approved LabsD rates.

| Agreement shape | Necessary portal behavior | Keep outside this portal |
|---|---|---|
| Attributed-sales commission | Show agreed eligibility/base/rate/window, explain adjustments and ambiguous attribution | A new multi-touch attribution engine; automatic reassignment from an ad hint |
| Production/media-use fee plus commission | Show approved fixed amount separately from sales-derived commission; include both in the payment reconciliation | Negotiation, project management, content approval suite or an automatic bonus ladder |
| Co-brand/SKU share when actually agreed | Use scoped eligible SKU/channel/date totals even where no single clip caused the sale; preserve partner-only earnings | Forcing all royalty into clip attribution, inventory/manufacturing planning or a generic royalty platform |

For LabsD's supplement business, keep product/channel/period eligibility and returns explicit. Repeat purchases enter the base only as the agreement defines; do not create lifetime customer ownership or a speculative LTV entitlement. Marketing spend, product costs and contribution analysis belong to internal finance/Sale Dashboard unless a contract specifically requires partner disclosure. Product briefs and media-use term references can be linked as approved documents; no new regulatory/content-approval workflow is proposed.

The practical attraction for a celebrity is understandable income, predictable payment information, visibility into use/performance of their clips, clear agreed terms and a real contact who can resolve discrepancies. These are product hypotheses to validate with a pilot partner, not evidence that the software alone guarantees recruitment or profitable collaboration. No rate, guaranteed fee, pilot cohort size or profit target can be selected without the actual agreement and business inputs.

## Architecture: retain the shape, narrow the implementation

The current stack is an appropriate candidate, not a universal best stack. The source manifest confirms Next/React/TypeScript, Postgres/Drizzle, Zod, TanStack Query, CSS Modules/tokens and Vitest/Playwright. This review found no evidence warranting a framework rewrite. Replacing it would discard useful UI/contracts without resolving the missing entitlement source.

- **One application:** keep pages, scoped APIs and internal modules in one codebase/deployable. Six domain folders do not mean six services. Do not add independent packages solely to make every module look symmetrical.
- **One financial data owner per fact:** source systems own orders and their payment/status facts. A selected approved source or explicitly assigned portal service owns partner entitlement. The portal retains explainable published snapshots. Existing customer-payment facts are not evidence of paying a celebrity.
- **Postgres:** use constraints, transactions and indexes for actual account/financial invariants. Keep business money exact. Optimize queries before creating rollups or a separate warehouse. Do not turn every UI preference into an audited business transaction.
- **Read/cache behavior:** scoped TanStack Query owns client server-state; avoid duplicating it with another global store or public server cache. Atomic earnings snapshots are justified by graph/detail consistency, not a mandate for event sourcing of the entire system.
- **Refresh:** current30second foreground revision polling is sufficient as the initial design. Source cadence must follow what the API/file can actually deliver; manual approved imports cannot be marketed as realtime feeds. A45second portal commit-to-visible target remains unmeasured.
- **Authentication:** use native provider/security primitives behind the identity adapter. The hard part is proving access and lifecycle behavior, not building a general account-management product. Keep membership revocation on each read even if self-service identity changes are deferred.
- **Files:** use a private authorized source or store with download ownership checks. Do not provision a second document repository if an existing service supports the required access, reliability and retention. Never send an unrestricted upstream document URL to the browser.
- **Operations:** a bounded import command and scheduler are sufficient initially. Retry source fetches safely; do not retry financial writes without stable identity. No broker, Redis, permanent worker, WebSocket tier or multi-region design is justified by current evidence.

## Whole-system gaps to resolve, including work already written

1. **Source grain mismatch:** `approved-period/schema.ts` requires entitlement rows, sources and controls; commission entries require calculation groups. The reduced business scope explicitly allowed an approved period and actual breakdown file when source detail is unavailable. The current parser does not implement that alternative. If that is the pilot source, add an explicit approved-summary contract rather than invented order/clip rows or weakening the existing validator. If detailed data is available, keep the existing adapter and do not build a second one unnecessarily.
2. **Approval workload:** `ApprovalContext` duplicates controlled facts by design, but is intended to be loaded by a server-owned approval repository. No repository/workflow exists yet. Staff must not manually re-enter every entitlement twice. Use an authenticated approval of an exact version/hash and independently supplied controls, with a reviewable difference report. A hash alone is not business approval.
3. **Frontend/backend contract drift:** `contracts/operations.ts` identifies membership changes by partner alone; real access service requires an exact target user and revision. `contracts/account.ts` and AccountPage identify methods by provider alone; real unlink supports exact method rows. Fix consumers/contracts together before real wiring, rather than creating implicit first-user/first-method behavior.
4. **Business terms clarity:** AccountPage can display an agreement summary but defaults to generic copy if none is supplied. Provide actual eligibility, rate/fixed fee, payment cadence, payee and media-use/contact references as applicable. This does not require building a contract editor or copying sensitive banking/tax data into the portal.
5. **Multiple people versus payee:** a celebrity, authorized manager and legal payee are not necessarily the same person. Existing scoped memberships are useful; an organization/agency platform is not needed. Verify who can read which partner, and keep legal payee evidence under finance ownership before any payout display is accepted.
6. **Read-only data versus staff writer:** operations previews currently expose conceptual import/publish/payment commands. That does not prove the portal should become the writer of upstream payments or terms. Decide writer ownership before persistence, not after the screen exists.
7. **Notifications and support:** keep the requested green count, but derive only real statement/payment notices and a scoped seen marker. Wire a real verified support destination; a generic “contact staff” paragraph is not completion. Do not add omnichannel notification delivery or a ticket backend.
8. **Visual consistency and realism:** preserve design, imagery and minimum16px. Finish native zoom/mobile checks with real-size data and Thai copy after wiring. Loading/error/unavailable states are useful; repeated defensive explanations and internal revision IDs on default screens are not.
9. **Auth experiment isolation:** current source is dirty and its callback tests fail. Earlier190unit/34PG passes are historical. Before resuming feature implementation, either repair and verify a narrowly justified experiment or park its code coherently while preserving migration0005 and evidence. No release may include this unaccepted path by accident.
10. **Milestone honesty:** frontend candidates are not complete operational features. Old plan statements about no Git repository and generic unchecked foundation tasks are stale. Keep the task IDs/history but point current execution to actual receipts and this review, with provider/data/release gaps still open.

## Smaller delivery sequence across the complete system

The20 task IDs remain for traceability; execute as five observable outcomes rather than treating every module as a separate product launch:

1. **Confirm the operating model:** one partner, actual payee/authorized viewers, approved agreement and period, authoritative financial input and support owner. G01 plus the discovery portion of I01 inform the implementation before G02. Owner review of the existing UI can proceed concurrently.
2. **Prove secure access:** A01 native provider proof and A02 core membership/recovery, then A03 real session wiring. Retain the three requested providers; resolve the self-service linking scope explicitly. Close F07 target-contract gaps. Missing external inputs do not authorize fabricated success.
3. **Complete one real earning-to-payment journey:** selected import, exact entitlement or approved snapshot, published statement, payment evidence and scoped reads/export. G02–G04; finish F04–F07 adjustments against that real data. No finance publication before actual G01 and access acceptance.
4. **Automate only proven work:** schedule the selected I01 feed, add available I02 insights and real notifications. Existing approved-file cadence is an honest temporary operating mode. Add more sources only for demonstrated missing facts.
5. **Accept and operate the pilot:** F08 real-data UX follow-through, R01 recovery/performance/security and R02 independent reviewed release/exposure. Detailed unavailable ad metrics do not automatically justify an integration project or an indefinite delay; pilot limitations must be explicitly agreed.

Do not delete finished components as a shortcut. Retain fixtures as isolated test evidence, keep optional features disabled when not accepted, and make a coherent contract transition when an actual source changes the data shape. A narrower pilot is not permission to declare the full original scope completed.

## Ownership and boundary change

Change Mode: re-sequence and simplify, without deletion. Relevant boundaries:

- **B1/B2/B8:** Upstream owners retain order/payment facts; the portal exposes partner-scoped projections and owns only partner entitlements/approval records explicitly assigned to it. Before implementing G02/G03 choose, per fact, approved upstream entitlement versus portal calculation under an approved agreement. Never calculate a competing payable amount from rounded sales headlines.
- **B3/B4:** Shared presentation and business contracts remain. Compact staff rows and disclosures can change behind them. Identity stays behind one maintained adapter; no competing authentication engine or custom OAuth protocol.
- **B9:** Provider authentication proves identity, current membership permits access, and staff verification manages account recovery. Simplifying UX does not waive these boundaries.
- **B6/B7/B10:** Keep one application and Postgres, with a bounded scheduled import from the same build when needed. Finance approves entitlement/payment authority; support verifies recovery; the engineering owner maintains auth, imports and restore. Concrete named business owners are still needed.
- **B5:** No package/build split is proposed. Folder boundaries do not create independent services.

Dependency direction remains presentation → scoped application services → owned repositories/adapters → database or upstream contracts. No upstream HTTP call participates in a portal database transaction.

## Immediate execution order

1. Preserve the repaired callback receipt and the in-flight exact-target contract batch. Complete focused verification of that batch before wiring it; avoid further generic account machinery without a concrete access/recovery need. Migration0005 was applied to the isolated test database and remains immutable. Historical green tests do not certify the current dirty tree.
2. Resolve A01 native Google/LINE/Apple callback proof and G01 one-partner/one-period authority in parallel as workstreams, without delegation. If external inputs are absent, prepare the exact missing contract/examples; do not invent credentials or finance rules.
3. Wire ordinary authenticated access through A03 after its identity and membership evidence. Explicit linking/removal/recovery remain separate tracked acceptance items; any pilot deferral must define the verified recovery workflow and release scope first. No automatic exposure based on this review.
4. Deliver one complete source → entitlement → statement → payment evidence → partner screen/export path using G02–G04. Preserve duplicate/refund, money precision, frozen statement and cross-partner tests. Select upstream payment authority before enabling manual payment entry.
5. Fit staff screens to this concrete workflow, then automate the single required source. Expand clip/ad metrics only where the source actually supplies useful attributable information.
6. Run pilot-sized performance, restore and independent release review. Additional services or optional automation require an observed problem and a concrete beneficiary.

## Preservation, verification and authority

No approved layout, imagery, money records or account data was removed in this review. Full pre-review plan/context and dirty source are retained under `.agent-work/20260909-practicality-review/`. No upstream system was revalidated live; source-authority findings use the current pilot worksheet and earlier research, and still require owner/source confirmation.

Before wiring, test: duplicate import/payment; refund after issue; missing clip attribution; stale payment balance; suspended membership; provider failure; account recovery; and unauthorized statement downloads. Assertions must match the actual authority and lifecycle selected above. A deferred identity mutation stays disabled, not bypassed. Existing data/migrations are retained on code rollback; no drop or applied-migration edit.

Allowed now: source review, preservation, documented sequencing, and local implementation within reconciled scope. Separate authorization remains for actual deployment/exposure, upstream mutations and destructive data actions. No independent acceptance is inferred from this author review.

Verdict: **READY FOR DECLARED SCOPE** — practical review and revised local sequencing only; real-provider behavior, the current dirty contract batch and production release have not been accepted.
