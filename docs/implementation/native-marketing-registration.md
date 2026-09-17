# Native Marketing registration — P01

Local implementation, 2026-09-10. This extends the shared Marketing preview into authenticated HTTP and PostgreSQL persistence. It does **not** enable a platform connection or run periodic acquisition. Facebook acquisition, connection provisioning and job execution are the next P02/P03 slices.

## Staff journey

`/ops/ads` uses the existing staff identity and `manage_partners` capability. It is available only with `LABSD_MARKETING_ENABLED=1`; default is OFF. Existing staff navigation advertises it only while enabled. Reauthentication preserves the exact `/ops/ads` destination.

The normal form selects an existing celebrity/clip/deal, an authorized source account and an Ad ID. Lookup checks both current staff and source-account grants, resolves the source outside the database transaction, and checks authorization and binding revisions again before issuing a short-lived receipt. The staff member confirms that the source creative is the selected clip. Saving stores an immutable association, queued acquisition job and audit entry in one transaction.

An expandable setup form records a clip's already-agreed deal reference when it is missing. It searches the existing content catalogue as the staff member types (250 ms delay), then accepts the deal ID, label and evidence reference. It does not set rates, calculate commission or approve a payment. The catalogue remains the authority for the clip/partner binding. Selection is bounded to 100 matching results with an explicit refine-search message when more exist.

## Boundaries and contracts

| Owner | Responsibility |
|---|---|
| `contracts/marketing-native.ts` | Strict lookup/save/setup commands and V2 receipts |
| `server/modules/marketing-ads/registration.ts` | Current staff/connection authorization, durable receipt, immutable mapping, atomic job/audit |
| `server/modules/marketing-ads/provider.ts` | Independently installed, validated read adapters; empty by default |
| `server/http/marketing-ads.ts` | HTTP methods, same-origin writes, bounded JSON, sanitized errors and private no-store responses |
| `features/marketing-ads/http.ts` | Explicit projection of native single-creative receipt to shared form; stable retry key |
| Shared console / `TargetSetup` | Existing components, scoped query cache, hidden-page teardown, available targets and connection reasons |
| Existing finance modules | Agreements, entitlement, exact commission and settlement authority remain unchanged |

Endpoints: GET `/api/v1/staff/ads`; POST `/resolve` and `/save`; GET/POST `/targets` below that base. Browser-supplied actor/revision must match the current session; neither field confers authority. Source tokens never enter these payloads or tables.

The first native association supports an exact Facebook ad with exactly one returned creative. Missing or multiple creatives cause a conflict instead of silently choosing one. V2 source IDs remain strings. The UI compatibility projection supplies `unknown` delivery and no cover when that information is not returned; it does not manufacture those facts or coerce metric values.

## Persistence and failure behavior

Migration `0018_marketing_ad_registration.sql` adds `portal_marketing` only. Tables are connections, per-staff connection grants, deal targets, lookup receipts, associations and sync jobs. It has been applied to the project-owned isolated test database and is now checksum-locked: corrections require a new migration.

- Canonical uniqueness is namespace + platform + account + object type + external ID, excluding a rotating transport connection ID.
- Associations are immutable. The same ad cannot silently move to another partner, clip or deal. Reassignment needs a later explicit history/activation design.
- Target identity and connection identity are immutable; metadata/access changes automatically increment their revision. Old receipts cannot overwrite new state.
- Receipts expire after two minutes, bind actor/staff revision/target revision/connection revision/draft/source, and are stored in PostgreSQL.
- Current grants are rechecked on every mutation. Provider I/O holds no SQL transaction or authorization lock. Source lookup has a 20-second HTTP deadline.
- Repeat save keys replay the stored result; new duplicate keys reuse the existing canonical association and job. Different content for an existing key is rejected.
- A transaction failure rolls back mapping, job and audit together. Jobs remain queued across service recreation; no in-memory timer is claimed as durable execution.
- Closed targets and disabled connections retain their authorized history but are not selectable for new registration. Revoked source-account grants remove access to that account's history.
- Staff registration snapshots are currently bounded to 500 targets/associations and 100 connections. Overflow fails explicitly rather than silently truncating. Larger operational lists need continuation before expanding this limit.
- A configured database connection is still shown as unavailable if its server adapter is absent. Browser flags cannot install an adapter.

## Verification and limits

Ten new PostgreSQL integration cases exercise current rights before/after source I/O, persistent mapping/job/audit, service recreation, concurrent duplicate saves, conflicting assignment, stale/expired/tampered receipt, immutable identity/revision triggers, missing/ambiguous providers, setup reference audit, transaction rollback and HTTP validation. Full integration suite: 164 cases in 17 files. Unit suite: 321 cases in 38 files, including native receipt projection/retry, setup form and safe login destination. Typecheck and production build/fixture exclusion pass; evidence is in the project-local P01 context packet.

Native production-build browser trial used isolated PostgreSQL through local HTTPS: username/password → `/ops/ads` → search catalogue → add one fictional deal reference → reload and reselect partner → same persisted reference. Database verification found exactly one target and one audit record. Empty connection state disabled lookup. Day/Dark captured; layout bounds showed document client/scroll width both 1016 px. The screenshot capture clips its right edge; this is not full mobile/200% zoom acceptance. Signed out, restored the prior test identity binding and stopped the trial servers/cluster. The owner's preview server was left running.

No real provider request, source-account grant, token copy, financial mutation, scheduler activation, production deploy or independent release acceptance occurred. `/ops-preview/ads` remains an explicit synthetic demonstration. P02 must supply a verified connection/adapter before native ad lookup can succeed; P03 must consume the queued jobs, and P04 must expose validated metrics through partner queries.

## Rollback / continuation

Disable `LABSD_MARKETING_ENABLED` to hide native entrypoints; retain additive tables and immutable history. Do not drop tables or edit the applied migration as a rollback. No older partner/finance reader depends on the new schema. P03 must honor connection/target/staff lifecycle, acquire leases and publish only complete validated reports, with no duplicate finance writer. Continue from the context handoff and staged platform plan.
