# Historical audit

This document records the earlier inspection below. As of 2026-09-18 the local
base is `main` and the single current-checkout runtime is HTTPS4443; copied builds
and secondary app listeners are retired. See `local-runtime.md` for current setup.
This audit is not a current release receipt.

> D124 update: [Isolated signing-key rotation](signing-key-rotation-acceptance.md) passed on the built native application: old-cookie rejection, unchanged-account new login, partner isolation and unchanged readiness/binding. The old-key rollback demonstration confirms that rotation alone does not revoke stored sessions. Production rollout and any global-invalidation procedure remain separate.

> D123 update: Actual staff reauthentication clicks and login returns now pass for `/ops/periods`, `/ops/access` and `/ops/ads`. Login Day/Dark geometry passes eight combinations across 280–1,440 CSS px; native autofill/200% zoom and remaining auth-form matrix remain open. See [native reauthentication acceptance](native-reauth-acceptance.md).

> D122 update: Optional bounded local retention now persists service-monitor transitions and exposes capture failures. Existing worker journal mechanics are shared; webAPI/framework stdout collection, off-device retention and external alerts remain open. See [monitor journal](../runbooks/service-monitor.md).

> D121 update: [Service monitor](../runbooks/service-monitor.md) now performs repeated, bounded same-host health checks with current status and last40 transitions. Actual local web cycles verified; external alert delivery, durable collection/retention, reboot supervision and off-host checks remain open.

> D120 update: [Page error recovery and framework events](page-error-observability.md) adds Thai fallbacks and optional server-render error metadata; local built/native acceptance passed. Continuous collection/alerts, browser event errors and post-header delivery coverage remain unresolved.

> D119 update: [API observability](api-observability.md) now covers declared API handlers. [Incident](../runbooks/incident.md) and [identity](../runbooks/identity.md) procedures identify current recovery paths and unresolved activation/drill requirements. No whole-web or installed-monitoring claim.

> D117 update: the web health/readiness gap identified in this D116 snapshot is now implemented and locally verified, including required migration checks. See [web readiness](web-readiness.md). D118 adds the independent default-OFF publication control (see [activation](statement-publication-activation.md)); other acceptance/deployment limits below remain open.

# Remaining-work audit — 11 September 2026 (D116)

The local portal is substantially implemented. It is **not a released production system**. This audit separates implemented behavior, recorded local evidence, missing product work and acceptance that requires an external environment. It supersedes old receipts as an inventory of what remains; it does not replace their detailed evidence or turn local checks into production acceptance.

Inspected worktree: `feat/portal-foundation`, HEAD `c15353d8a842e9ed6d78bba9ad174d933215e24a`, with substantial accumulated tracked and untracked changes. Current local web artifact is the frozen D115 build `HkQl68SnTlmXEbuPR0rGu`, HTTPS4443 → Next4203. No deployed production SHA, protected-main status or release artifact was established in this audit. Do not treat HEAD or a passing local build as that evidence.

## Existing plan disposition

| Plan slice | Current implementation/evidence | What remains |
|---|---|---|
| F00–F02 foundation/contracts/design system | Shared UI, typography, query/auth scope and contracts exist. `foundation-validation.md`, `typography-system.md`; later native geometry in `native-staff-navigation-acceptance.md` and `staff-partner-search.md` | Final native zoom/accessibility acceptance; earlier receipt saying F03–F08 are absent is historical |
| F03–F08 partner/staff frontend | Overview, continuous content library, clip/ad detail, statements, account and staff routes exist. Preserve approved portraits/layout. Frontend receipts and native follow-ups cover distinct stages | Complete final release-scope UI acceptance; mock receipts do not prove native data or all current screens |
| A01 credentials | Current runtime mounts maintained username/password auth, native allowlist, normalized DB uniqueness, secure sessions, throttling. Isolated PG tests exist and previous passing receipts are recorded | Actual password-manager interaction and staging acceptance. No social-provider setup required |
| A02 invitations/recovery | Staff invitation/revoke/reissue, atomic registration/activation, existing-account acceptance, current-password change and exact-account reset/revocation exist | Verified-contact delivery/operator practice has not been exercised with a real recipient. Synthetic links were handed through the local browser; no external send is implied |
| A03 native access UI | Real transport, scoped cache disposal and local HTTPS invite→register→Overview→change/reset→login→logout recorded in `native-account-acceptance.md`; D123 actual staff reauthentication returns and eight login Day/Dark geometry combinations verified | Remaining invitation/reset/account visual matrix, actual 200% zoom and native password-manager interaction; local staff link-click gap is closed |
| G01 agreement/source authority | Typed approved-period contracts, independent controls, catalogue/account-profile inputs and synthetic owner fixture exist | Actual pilot agreement, source control totals and payment authority remain business inputs before production publication. Do not ask for a real celebrity to continue local mock work; never promote 10%/3% examples into defaults |
| G02 import/reconciliation | Reviewed-file acquisition, leases, exact values, revisions/corrections, atomic generation and isolated PG tests exist; see `synthetic-financial-import.md`, `reviewed-file-acquisition.md`, `earning-corrections-and-export.md` | Real chosen feed conformance/control reconciliation; installed scheduling is distinct from an executable CLI |
| G03 statements/settlements/files | Immutable statements, allocations, append-only corrections, scoped CSV generation/authorization and finance operations exist | Actual business payment writer/evidence source and production document inventory. CSV native HTTP bytes are proven; final browser save, payment receipt/PDF/withholding documents are not thereby proven |
| G04 native reads/refresh/notices | Current source has bounded authorized Overview/content/statements/account/changes/notifications routes. Local exact totals, scope/isolation and revision behavior have receipts | Current frozen release must pass its combined matrix. Two actual active-session update cases under load are not every offline/revocation scenario |
| I01/P01–P04 Facebook | Native registration/provider composition, persisted reports, recurring worker, shared quota/history/coverage and partner projections exist | Usable real ad account/entitlement, source comparison and worker installation. Skip activation while these are unavailable |
| I02/P05 TikTok Shop video | Separate owner-service/video collector, durable paging/schedule/projections and local failure/load tests exist | Actual owner service/account entitlement and source comparison. Shop video is not TikTok Ads or GMV Max |
| P06/P07/P08 other paid reports | Shopee/Lazada/TikTok paid capabilities have explicit identities/unavailable states. Current ad-provider composition installs Facebook only | Native paid-report adapters and per-platform grain/rights remain absent. Capability labels or seller/order APIs are not adapters. Defer per owner until usable API/report evidence exists |
| R01 load/refresh | D105 warm HTTPS100k/100partners/20workers; D108 fresh-process first burst; D10924-month120k-line history; exact amounts and payloads recorded in linked receipts | Mobile LCP p75 and final deployment capacity. Process-cold with a running DB does not prove disk-cold storage; do not rerun accepted baselines as substitute for missing evidence |
| R01 observability | Worker supervisor/events, bounded optional journal, one-shot health checker, current-window coverage and D117 web health/readiness with required migration checks exist | D121 continuous same-host checker implemented and running locally; optional service-status journal now persists bounded local history; no reboot-persistent checker, webAPI/framework collector, off-device archive or external alert delivery installed; D119 implements correlation and redacted events for declared API handlers plus incident/identity runbooks; D120 covers framework-reported server render errors and render fallback recovery; D124 closes isolated built-app signing-key rotation acceptance; browser event errors, post-header delivery coverage, collector supervision and actual target rotation/rollout remain open |
| R01 restore | `backup-restore.md` and `restored-app-acceptance.md` record isolated logical/schema/full-row and built-service recovery | Off-device retrieval, production roles/secrets/media evidence, PITR, owner-approved RPO/RTO and retention. Same-SSD copies are not disaster recovery |
| R01 pool budget | Web runtime max10; each Facebook, TikTok-video and approved-period importer max2. Separate worker pools already exist | Aggregate instance/concurrency budget is not resolved for an actual target; calculation below is an inventory, not capacity approval |
| R02 release | Local lockfile/migrations/build exclusion and `.github/workflows/checks.yml` exist; per-batch independent reviews recorded | Protected-main release SHA/digest, target/domain, staged flags, production checks and operator acceptance. Existing CI runs typecheck/unit/build, not the entire real-PG/browser/recovery matrix |

The existing independent reviewer inspected A01–A03 source and tests during D116 and found no missing product behavior in that slice. Acceptance gaps above remain. Other rows are a source/receipt inventory, not a fresh rerun of every historical test on the current candidate.

## Confirmed code status

1. **D117 locally completed:** `app/api/health/route.ts` and `app/api/ready/route.ts` now implement web liveness and bounded readiness, including credential binding and required migration IDs/checksums. Unit/real-PG/build/HTTP evidence is in [web readiness](web-readiness.md). The worker health service remains separate. This closes the code gap identified in D116; installed monitoring and release acceptance remain open.
2. **D118 implemented locally:** independent server-owned statement publication activation across native API and shared staff UI. Financial reads remain available while publication is OFF; existing grants, fresh authentication and financial policy remain authoritative. See [activation](statement-publication-activation.md). Production rollout/activation remains open.
3. The specified deployment/identity/incident runbooks and release checklist were absent at audit start. The preparation checklist linked below is now written; D124 also verifies actual isolated signing-key restarts on the built web application. Production commands/target-specific delivery and global session invalidation remain unverified. Do not describe documentation or an isolated drill as installed production recovery.

## Connection inventory and acceptance formula

The current main web singleton is `src/server/modules/identity/runtime.ts` (10 connections per Node process). `scripts/marketing-sync-once.ts`, `scripts/shop-video-sync.ts` and `scripts/import-once.ts` each create a separate pool of2. The supervisor itself does not add a DB pool. Concurrent one-shot imports still each count; a separate pool alone does not reserve server capacity for web traffic.

At minimum budget:

`10 × peak web processes + 2 × peak Facebook worker children + 2 × peak TikTok-video worker children + 2 × overlapping approved-period imports + other DB clients + operator reserve ≤ usable DB connections`

Count rolling-deployment overlap, every process per instance, other applications on the same DB and migration/provisioning jobs. For example, two simultaneously live web processes plus one child for each of the three import lanes require26 connections **before** other clients/reserve. This is arithmetic, not a chosen production topology or measured database limit. Obtain the actual target's limits and constrain concurrency before release; do not increase pools to hide slow SQL.

## Next sequence within the approved plan

1. D118 independent publication activation is locally verified across build/HTTP/native read UI and independent code review. Continue open operational and release checks below.
2. Finish small operational procedures and traceability, then verify them against the chosen isolated/release target. Use existing worker health/journal primitives.
3. Complete the remaining supported native acceptance. D123 closes the local staff reauthentication click and login geometry checks; retain explicit limits for unavailable zoom/download/password-manager controls and the remaining auth-form matrix.
4. Fill [release checklist](release-checklist.md) with a real candidate and target. Stage platform capabilities independently when their accounts/API evidence is ready.

No additional dashboard features, ad-management product, global creator marketplace, wallet, new event bus or connector fleet is needed to close these gaps. The full goal remains active. D115 was verified implementation progress; D116 changes the next action by finding concrete missing R01/R02 behavior and reconciling stale plan inventory. This is not a no-progress blocked turn.
