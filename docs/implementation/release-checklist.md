# Controlled pilot release checklist

Status: preparation only, 11 September 2026. Production is not authorized or verified by this file. Current work is a dirty local foundation; see [remaining-work audit](remaining-work-audit.md). Record secret references only, never secret values.

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
