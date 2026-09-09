# G01 — Approved-period intake candidate

2026-09-09. Local implementation of the input boundary, not acceptance of a real partner agreement or an importer that publishes money. The remaining business inputs are in [pilot-data-contract.md](pilot-data-contract.md). The canonical G01/G02 dependencies remain unchanged.

## Ownership and calling contract

`src/server/adapters/approved-period/schema.ts` owns the strict versioned wire format and `parse.ts` owns offline validation. Exact arithmetic is reused from `src/server/modules/earnings/calculate.ts`. No feature, UI, provider callback, source database or financial publication route is modified. No database migration is necessary for this pure input boundary.

`parseApprovedPeriod(rawUtf8Json, independentlyLoadedApprovalContext)` returns either safe error codes with zero-based row indices, or a `validated-draft` with `publicationReady: false`. It does not echo rejected values or arbitrary parser errors. A successful parse never grants membership, source authority, agreement approval, or publication permission.

The future authorized import service must obtain the approval context from a separate server-owned, versioned approval repository. It must not accept both arguments from an HTTP request, or generate an approval from the submitted file. The context contains the SHA-256 of the exact approved UTF-8 file; changing even evidence references while keeping totals unchanged invalidates the file. Hash equality proves correspondence to that approval record, not the approver's identity or the business truth of the original records. Those are A02/A03/G01 obligations. Pin the approval version and recheck its current authority transactionally before G02 publication.

## File and approval setup

The complete executable definitions are the two exported Zod schemas; no duplicate frontend-specific format is introduced.

| Set | Required information |
|---|---|
| File header | `approved-period/1`, `complete-snapshot`, one partner, THB, Bangkok period with end exclusive |
| Source manifest | Delivery source/account, canonical authority/account, snapshot revision, as-of instant, exact counts for all three dispositions and included base/amount controls |
| Every row | Canonical entitlement tuple, delivery identity, independent row revision, earned instant, source evidence alias |
| Included commission | Agreement version, approved calculation-group reference, SKU/channel, eligible base in satang, explicit integer ppm rate, claimed satang amount |
| Included fixed fee/bonus | Distinct entitlement and independently approved amount/evidence; no invented base or rate |
| Included adjustment | Independently approved amount plus original-line and reason references; always retains a history-validation blocker |
| Excluded | Independently matched exclusion approval and reason; count remains visible in controls |
| Unresolved | Reason reference; retained as a publication blocker, never treated as a confirmed zero earning |
| Content mapping | Explicit partner-only attribution or independently matched content/evidence references |

The approval context separately supplies the partner/period, file digest, full source controls, calculation groups, fixed amounts, exclusions and proven content mappings. There are no default rates, rounding, SKU/channel eligibility or business approvals. Internal references use scoped ASCII aliases; the syntax is not a PII detector. No customer names, phone numbers, addresses, arbitrary source URLs or free-form payload fields are supported. Staff evidence retrieval remains separately authorized work.

Canonical identity is `[authority, canonical account, source reference, line reference or null, earning right]`, encoded as a JSON tuple. Delivery name and source revision are not part of that identity. Two ERP/ChatMesh mirrors of the same right cause rejection instead of another commission or silent row removal. A source owner must resolve duplicate delivery and revise controls before approval.

## Calculation and completeness

- Only complete, ended period snapshots are supported by this candidate. Each source's as-of must reach the period end. Incremental feeds, partial pages and unknown currencies/precision/statuses are rejected. A zero period needs explicit complete zero controls.
- Each independently approved calculation group specifies its entire window, agreement/evidence/policy, effective window, earning right, SKU/channel eligibility, rate, rounding and literal row/base/amount controls. The whole calculation window must fit the input period and agreement effective window. The source/finance owner supplies the window dictated by the real day/month/statement agreement; this adapter does not invent a cadence or split it by delivery source.
- Exact signed BigInt arithmetic supports per-line half-away-from-zero and per-period largest-remainder allocation with a stable canonical-identity tie break. Group controls and every included commission are checked, then each source's full counts/base/amount totals are checked. Page totals or whole-baht headlines are never used.
- Base eligibility, discounts, refunds, VAT/shipping, stacking and offset interpretation remain the approved source policy's responsibility. The parser checks the approved base/rule and digest; it does not manufacture those missing policies or verify raw source evidence.
- Adjustments cannot clear the original-history blocker here. G02/G03 must load the original partner/right/group, reconcile cumulative facts, preserve closed statements, and apply only the linked delta once. Replays, leases, database uniqueness and atomic publication are not implemented by this parser.

Technical safety limits are centralized at 16 MiB UTF-8 and 50,000 rows, with bounded source/group/mapping collections. These are defensive offline limits, not measured load targets or the separate 10,000-line interactive export limit. The row bound is checked before Zod visits row fields, avoiding large error allocations from oversized malformed arrays. G02 must enforce the byte cap while reading, before allocating a whole external file; R01 must measure actual resource use.

## Author verification

`tests/unit/approved-period.test.ts`: 35 cases cover exact ties and large/signed amounts, explicit zero rates, forbidden defaults, malformed/oversized input, hash binding, foreign scope/account, duplicate manifests/rights/mirrors, missing sources, stale snapshots, wrong eligibility/agreements/windows, incorrect math despite balanced controls, per-period cross-source allocation, attribution, distinct approved fixed/bonus/adjustment lines, omitted approved amounts, exclusions, unresolved blockers and explicit empty-period controls.

Full unit/contract suite: **190/190 in 17 files**. Full typecheck passes. Evidence: `.agent-work/20260909-g01/evidence/tests-20260909-1227.log` and `typecheck-20260909-1227.log`. These run the actual pure adapter with synthetic approval records; they do not prove a real source, authorized approver, provider session, database importer, load SLA or release. No rendered UI changed, so the previously recorded F08 UI evidence is historical and was not rerun for this backend-only addition. Independent implementation review remains open under the owner's solo-work instruction.

Next: bind one actual agreement/period/source-owner approval, finalize this candidate format against those facts, and implement the isolated financial schema and import service in dependency order. A03 plus actual G01 acceptance still precede confirmed-money publication.
