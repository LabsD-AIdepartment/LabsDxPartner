# G01 — Pilot business inputs and source contract worksheet

2026-09-09, preparation only. No selected real partner, approved agreement or reconciled period is available in this portal yet. No confirmed amount may be published from this worksheet. Existing synthetic10%/3% examples are not defaults.

## Required owner/finance inputs

| Input | Required evidence | Current state |
|---|---|---|
| Pilot partner and legal payee | Internal partner identifier, verified contact, authorized finance owner | Awaiting reference |
| Agreement version | Existing approval/document reference, effective dates, eligible SKUs/channels, rate and commission-base definition | Awaiting reference |
| Adjustments | Discount allocation, VAT/shipping/COD treatment, canceled/returned/partially returned eligibility and earned-time rule | Unspecified; no inferred rule |
| Rounding | Per-line or per-period, tie-break and stable allocation; currency precision; original-group correction treatment | Must match the approved agreement; supported implementation currently uses half-away-from-zero |
| Period | Bangkok calendar start/end-exclusive, calculation cadence and payment due-date rule | Awaiting selected period |
| Fixed fees/bonuses | Already-approved distinct earning lines, evidence and non-stacking/offset rules where applicable | Include only if the actual agreement has them |
| Settlement controls | Opening balance, issued credits/debits, approved offset, withholding and cash evidence with reconciliation owner | Awaiting records; customer receipt is not partner payment |

## Minimum source delivery

An approved-period file is a valid first adapter when an existing bounded API cannot supply the required grain. Before writing an importer, agree these fields with the source owner:

- Manifest: schema version, source authority/account, partner, agreement version, period, as-of/revision semantics, currency, coverage scope, record count and exact control totals. Describe whole-period snapshot versus ordered row revisions explicitly.
- Each entitlement: stable logical sale/line key, earning kind, source revision and evidence reference, earned date, SKU/channel, gross/base/discount/refund inputs at source precision, eligibility state and exclusion reason. Amounts travel as exact decimal/minor-unit strings; never rounded headline numbers.
- Attribution: partner-only versus proven content ID. Unknown content attribution remains unknown; matching multiple ads does not duplicate earnings. ERP/ChatMesh mirrors share one canonical logical entitlement.
- Fixed fee/bonus: separately approved amount and evidence rather than pretending it is a sale percentage.
- Correction: original entitlement/issued group reference and cumulative revised facts; closed-period correction produces only an explained linked delta. Never subtract the same refund twice.
- Privacy: partner-facing references are scoped aliases; no customer names, phone numbers, addresses, chat transcripts or unrestricted source URLs. Staff evidence retrieval stays authorized separately.

Publish gate: all required rules signed off, complete source controls reconcile, unsupported precision/status/grain is quarantined, approved exclusions are distinguished from unresolved blockers, and A02/A03 identity isolation has passed. An import cannot promote its own business approval.

## Fresh source check, limited to local code

Read-only on2026-09-09: Sale Dashboard `src/integrations/feed/syncSalesDaily.ts` retains raw-first, revision-aware, complete-date replacement; `src/lib/metrics/companySalesRollup.ts` reads company/channel grain and rounds headline revenue to whole baht. These paths are useful for source lineage discovery, but their company headline cannot become an individual partner commission base. This is a source-code observation, not a live-feed or deployed-SHA verification.

Earlier ERP/ChatMesh findings and exact source pointers remain in `docs/research/2026-09-07-partner-portal-reuse-scope.md`; their runtime behavior has not been revalidated by this preparation batch. Prefer an existing source-owned API/export with only missing authoritative facts added. Do not import upstream framework modules or directly share its operational database schema.

## Next implementation boundary

G01 must finalize this worksheet using one actual agreement/period and source-owner evidence. A [local intake candidate](approved-period-intake.md) now implements the strict schema/parser, independently approved file hash and controls, exact calculation checks, and draft-only output. Its synthetic verification does not complete this business worksheet or freeze an actual source agreement. Confirm the candidate against the real inputs before financial publication and new content/earnings/import/statement migrations. Identity migration0001 is already checksum-locked in the isolated test cluster; subsequent migrations need new ordered IDs. A03 + G01 acceptance precede G02 publication. No importer publication, real source read, payout or financial migration was executed by this preparation.
