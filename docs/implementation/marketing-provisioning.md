# Trusted marketing account setup

D073 adds a shared audited writer and an explicit TikTok Shop Video metadata lane.
See [TikTok shop provisioning](tiktok-shop-video-provisioning.md) for its owner references
and `--platform tiktok` command. The Facebook workflow below remains supported.

D068 local candidate, 2026-09-10. Use this once per account and when the team changes. Marketing's daily work remains in the existing Ads console; no additional partner page or token form is introduced.

## Responsibility

A trusted operator installs a server-owned account profile and explicitly grants existing staff access to that account. Operator process/DB access is the authority; `operatorRef` and `evidenceRef` document responsibility and the setup request, and are not authentication mechanisms. The command is not exported through HTTP. Ordinary `manage_partners` staff cannot install arbitrary providers or give themselves accounts through the web.

A granted staff member then opens the existing connection panel, verifies the account and proceeds with the celebrity/clip/deal and Ad ID workflow. Provisioning creates the account disabled, without verification and without source requests. Existing account verification/enable state is preserved when only label or grants change. Metadata verification does not prove that all report fields are permitted; source report checks and staged activation remain necessary.

Staff must already have an active `manage_partners` grant to receive account access. Partner membership or merely knowing a user ID is insufficient. Revocation can remove an old account grant even when that user is no longer active. No staff users, partner memberships, deals, commissions or payments are created by this command.

## Operator workflow

Use the pinned Node 24 runtime. The application namespace binding must already exist on the intended database; this command deliberately refuses to bootstrap or overwrite it. Configure `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` using the existing trusted runtime injector. The CLI reuses existing identity configuration validation; secret values are never printed. For local operator use, Node can load a gitignored env file, e.g. `node --env-file=.env.local scripts/run.mjs marketing:provision --inspect`. `npm run` by itself does not load an env file for this CLI.

Set `LABSD_FACEBOOK_PROFILES` to a JSON array of metadata such as:

```json
[{
  "id": "facebook-primary",
  "namespace": "labsd-meta-production",
  "accountId": "123456789",
  "currency": "THB",
  "timezone": "Asia/Bangkok",
  "acquisitionOwner": "portal-direct",
  "tokenEnv": "LABSD_FB_PRIMARY_TOKEN"
}]
```

These identifiers are examples, not verified accounts. Replace them with the authorized account's exact metadata. `tokenEnv` is a reference to an environment variable; this setup command does not resolve its value. Optional `appSecretEnv` similarly names `LABSD_FB_..._APP_SECRET`. Keep a single explicit acquisition/credential owner. Do not duplicate a rotating upstream credential into another independently refreshing system. Keep read/marketing/sync flags off during installation. `parseFacebookProfiles` validates metadata while `readFacebookProfiles` continues respecting the read flag.

1. Inspect configured accounts, current revisions/grants and eligible staff with `npm run marketing:provision -- --inspect` under the configured environment. Staff are paged in batches of 500; use `--inspect --staff-after <nextStaffCursor>` when the response supplies a cursor. The command returns user IDs/usernames so the operator can select the intended existing staff explicitly.
2. Copy [the command template](../examples/marketing-provision.command.json) into a project-local ignored working directory. Replace all placeholders and generate a new UUID for `commandId`. `expectedRevision: null` means create only if the connection does not exist; existing connections require the exact revision from inspect. Use explicit add/remove deltas, never a replacement list. To withdraw all access, list those exact user IDs in `revokeUserIds`.
3. Run `npm run marketing:provision -- <command-file>` for a read-only preview. It returns the target digest, current account/grants, intended changes, staff revision fences and `planHash`. It performs no source calls or database writes.
4. After reviewing that concrete result, run `npm run marketing:provision -- <command-file> --apply --plan-hash <returned-hash>`. This rechecks the namespace, source metadata, current account revision/grants and active staff revisions in the same transaction as the change and audit. A stale plan must be inspected/prepared again; the command never silently overwrites concurrent changes.
5. The granted team uses the existing connection panel for metadata verification and enable/pause/retry, then registers the Ad ID. Enable the configured read capability and inject its secret through its chosen owner only when source access is ready. The sync worker remains separately controlled by its existing flags.

The CLI accepts a bounded regular JSON file of at most 32 KiB and rejects unknown fields, tokens, raw account substitutions, enable flags, overlapping/duplicate user deltas and more than 100 additions or removals per command. It prints structured safe failure codes without input files, driver errors, environment values or stack traces.

## Consistency and audit

New connections are created from the configured profile, not command-supplied source identity. A different account under an existing connection ID is rejected; create a new explicit connection for a different identity. The database's existing immutable identity and unique constraints remain authoritative.

Apply serializes by command ID then connection. A successful command and its before/change audit commit together. Repeating the same command and plan hash returns `replayed`, a receipt of the original operation, not a claim about today's permission state. Use inspect for current state. Reusing the command ID with different input is a conflict. Account/grant or staff revision changes between preview and apply invalidate the plan. The plan digest also binds the configured profile references and target namespace/database identity.

Grant changes bump the connection revision, invalidating earlier lookup receipts and source publications. Current server authorization continues checking staff and per-account grants before/after source I/O; deleting access is effective on subsequent requests. Existing worker leases invalidated by a revision change expire/retry under the current worker policy. No source report or financial history is removed.

Additive migration `0023_marketing_provision_audit.sql` records operator/evidence references, request/plan hashes, before/applied changes and the result; its trigger rejects audit update/delete. It follows local 0022 and must be rechecked against main/target numbering before release. No existing migration was edited. On rollback, disable the operator command and preserve grants/audit; a correction is a new explicit audited command, not audit deletion.

## Verification and remaining work

Focused tests exercise read-only preview, disabled account creation, duplicate concurrent apply, immutable audit, stale account/staff/namespace plans, nonstaff/inactive denial, existing enabled state, source identity mismatch and the existing lifecycle/Ad ID flow after provisioning. The real CLI is executed against the isolated test database with read flag off and no source token, including inspect/preview/apply and malformed-input redaction. Its test namespace binding is installed only for that case and restored afterward. Initial fixture failures from a missing test binding were corrected without weakening the runtime check.

Full test/build evidence is recorded in `.agent-work/20260910-provisioning/evidence/` and the final context receipt. This implementation has not provisioned a real account, requested a new source permission, copied a credential, run a production migration or deployed any worker. It has no new browser surface, so no new visual verification is claimed.

Remaining activation work: actual permitted account/report proof, health/supervision/load, independently available TikTok Shop/Lazada/Shopee/TikTok Ads capabilities and the original finance/account/document/recovery/release acceptance. Existing mock and approved layout remain intact.
