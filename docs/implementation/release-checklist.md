# Controlled pilot release checklist

Status: preparation only, updated 18 September 2026. Production is not authorized or verified by this file. The accepted local application is being consolidated onto local `main`; the repository has no configured remote or production deployment. See [local runtime](local-runtime.md) for the current source and data boundaries. The [remaining-work audit](remaining-work-audit.md) is historical. Record secret references only, never secret values.

## Current 4443 baseline and release boundary

The current local application uses Node24 / Next development HTTPS on the current checkout,
with `LABSD_PRESENTATION_MODE=pitch`. Native authentication and contact/account updates use
PostgreSQL. Sample accounting uses the existing private SQLite dataset. Sample withdrawal
state is stored in browser storage scoped to native user and partner; it does not transfer money.
Connected ad reports are persisted in PostgreSQL and refreshed by the supervised local worker.
Changing a Git branch does not migrate or copy these stores.

The presentation currently accepted by the owner includes the responsive Overview and content
library, Wallet summary/history/detail, native account editors and contact form. Preserve the
existing origin, configuration, database, private media and browser namespace during local
integration. An account-media upload experiment is not part of this release: its UI is unfinished
and migration0031 has not been applied. Do not require it in the release migration manifest.

**Default production builds are not visually or behaviorally equivalent to this pitch runtime.**
`pitchModeEnabled` requires development mode; production aliases replace the pitch composition
and demo handlers with unavailable implementations. A successful production build and a ready
closed deployment do not prove the sample presentation will be visible. Do not deploy `next dev`
or remove these guards as a shortcut.

Two release scopes need different acceptance:

- **Hosted demonstration:** explicitly package the approved demonstration presentation for a
  production build; retain native authentication, exact user/partner allowlists, sample labeling,
  isolated sample accounting and simulated withdrawals. Define persistence for the SQLite sample,
  private assets and demonstration browser state, and verify real versus sample data provenance.
- **Live partner service:** bind the approved UI to authoritative native financial/content/payout
  transports, validate the actual agreement and data reconciliation, finish payment and recipient
  delivery capabilities, and verify scoped production identity. Never seed sample balances as
  real withdrawable funds or infer payment readiness from the current Wallet.

The owner must choose the release scope and hosting/domain. Preparation may freeze source,
back up local data, validate the build and document this procedure while that choice is pending.
This checklist does not authorize public exposure or external messages.

## Concrete cutover preparation

1. Record the full reviewed main SHA, lockfile, required migration checksums, Node version and
   independent review. Configure a central remote and protected main before hosted CI/CD.
2. Select the scope above, deployment target, HTTPS origin, allowed audience and operator.
   Record an environment-variable **name** inventory and provision secret references on target.
   Existing credential binding includes origin/secret identity: copying the local DB and changing
   its origin is not a verified account migration. Design and test that transition before cutover.
3. Back up each authoritative store and private asset root, plus the configuration references
   needed to recover it. Prove an isolated restore. Keep dumps, sessions, TLS keys and local
   configuration out of Git, images and public assets. Record storage volume and backup retention.
   Browser-only demo requests do not become shared server records merely by deploying.
4. Build from the clean reviewed SHA in the selected production mode; record artifact digest and
   deployment ID. Compare Overview, content library/detail, Wallet history/detail and account at
   phone, tablet portrait/landscape and desktop sizes in both themes, against the accepted local
   presentation. Verify amounts and request references with the intended store, not screenshots alone.
5. Review the target ledger before applying only approved migrations. Start with exposure disabled;
   check `/api/health` and `/api/ready`, scoped login/access/logout, account save/reload, report
   filters, exports, worker freshness and errors. Exercise writes on the approved isolated target.
6. Install worker/process supervision, sanitized log retention, monitoring and backup schedules.
   Set pool limits for web/worker overlap. Confirm the operator can disable affected capabilities
   and roll back to the previous schema-compatible artifact without restoring data in place.
7. Present the exact deployment/audience/flags and verification receipt for the owner's final
   exposure decision. Keep SMS/email/invitation delivery and real payment execution off until their
   respective provider, recipient and business acceptance is complete.

## Required release record

| Required record | Current state / acceptance |
|---|---|
| Exact release candidate | Unset. Freeze reviewed changes, protected-main reachable SHA, lockfile, full migration/checksum list, app and worker build digests and separate-model review. Local D115 build is a preview artifact, not the production candidate |
| Hosting/domain/TLS | Unset. Record service/project, region, actual HTTPS origin, invitation/recovery URLs, deployment ID and SHA/digest correspondence |
| Database/identity binding | Unset for production. Record target identity, required schema/migrations and roles, explicitly provisioned credential namespace; reject mismatched binding. Do not copy the synthetic binding or run the isolated test migration tool against production |
| Capacity | Record max connections, reserves, peak web/worker/import processes including rollout overlap; reconcile the audit's pool formula. Record storage and private evidence availability |
| CI/acceptance | Existing CI covers typecheck/unit/build. Attach real-PG isolation/finance/concurrency, native invitation/account/report, scoped file/export, healthy and failed import, web readiness, worker shutdown and recovery evidence for the frozen release |
| UI limits | Resolve actual zoom, password-manager and remaining native form/navigation checks. Record mobile LCP and final supported browser download-save proof. Narrow viewport/HTTP bytes do not silently substitute |
| Monitoring/support | Named operator/support contact, installation of existing health checker/journal collection, safe web/request correlation, actual alert destination and test receipt. No external notifications sent until authorized |
| Backup/recovery | Approved RPO/RTO, schedule/retention/holds, off-device backup retrieval, production role/key/evidence-file recovery and isolated app validation. No in-place production restore trial |
| Business input | Actual approved partner agreement, authoritative source controls/payment writer, verified recipient delivery and support practice. Mock data remains mock |
| Source capabilities | Verify only ready account/capability pairs. Facebook ads, TikTok Shop video and TikTok paid ads are distinct. Unavailable Shopee/Lazada/paid TikTok remain off; an order-feed connection is insufficient |
| Rotation procedure | Named secret references/owners, current-session revocation and safe restart/binding checks, expired/replaced credential behavior and recovery steps; exercise in isolation before claiming acceptance |
| Migration/run order | Inspect ledger first; ordered immutable migrations, compatible code, health/readiness, then explicit exposure decisions. Code rollback does not undo database writes; no blind migration retry |
| Pilot/cutover | Name allowed pilot audience and owner authorization, actual source freshness, support readiness, rollback/disable path and post-deployment verification. Do not expose general public signup |

## Activation inventory (current code, not new instructions to enable)

- `LABSD_IDENTITY_ENABLED`: mounts credential/runtime access. Default0.
- `LABSD_FINANCE_ENABLED`: native financial reads. Default0.
- `LABSD_STATEMENT_PUBLICATION_ENABLED`: independently enables staff statement publication only with identity+finance enabled; default0. D118 locally verified; production activation remains a separate decision.
- `LABSD_API_OBSERVABILITY_ENABLED`: generated API request IDs and redacted stdout events; default0. Requires operator-owned collector/retention acceptance for production; it installs no collector or alerts.
- `LABSD_IMPORT_ENABLED`: reviewed-file importer invocation; it does not install scheduling. Default0.
- `LABSD_MARKETING_ENABLED`, `LABSD_FACEBOOK_READ_ENABLED`, `LABSD_MARKETING_SYNC_ENABLED`: separate marketing/read/sync controls. Default0.
- `LABSD_TIKTOK_VIDEO_ENABLED`, `LABSD_TIKTOK_VIDEO_SYNC_ENABLED`: separate Shop-video controls. Default0.
- `LABSD_ACCOUNT_PROFILE_ENABLED`: agreed profile presentation/publication surface. Default0.

Set flags on their actual web/worker targets and record their values with the release receipt. Do not assume defaults prove no deployed process has overrides. Source API access stays off until account and report identity are verified. Do not activate a new capability just because its UI label exists.

Roll back application code only to a schema-compatible reviewed artifact; stop affected acquisition/publication before a binding investigation, preserve history and last-good generations, and obtain approval before production data recovery or exposure changes. Keep the deployment host's verified process-group shutdown/restart behavior in the final runbook. No service manager, deployment configuration or external alert was installed by this preparation.
