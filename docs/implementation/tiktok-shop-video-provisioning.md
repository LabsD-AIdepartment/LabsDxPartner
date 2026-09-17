# TikTok Shop Video — trusted operator provisioning

D074 adds [source verification and native lifecycle](tiktok-shop-video-verification.md).
The real owner bridge/account proof and live route composition remain pending.

D073,2026-09-10. Completes the metadata/grant prerequisite for the D071 frontend
and D072 worker. Actual source verification, entitlement and worker host remain
separate: provisioning creates **disabled, unverified** records and cannot
activate source collection.

The existing shared provisioner now supports exactly Facebook/ad_insights and
TikTok/shop_video. It remains a trusted operator service, not a staff HTTP route.
The Facebook entry function and default command syntax remain available. TikTok
uses `createShopVideoProvisioner` and strict metadata profiles. The common writer
retains read-only preview, digest-bound apply, scoped grants, eligible-staff checks,
connection revision fencing, immutable audit and idempotent commands. It never
changes enabled/verified state while editing a label or grants.

## Profile and owner

`LABSD_TIKTOK_VIDEO_PROFILES` holds an array of metadata like:

```json
[{
  "connectionId": "labsd-tiktok-shop-1",
  "namespace": "labsd",
  "shopId": "verified-source-shop-id",
  "currency": "THB",
  "timezone": "Asia/Bangkok",
  "acquisitionOwner": "sale-dashboard",
  "sourceConnectionRef": "owner-shop-connection-reference"
}]
```

These strings are illustrative references, not a connected account. Obtain the
actual shop identity, currency, timezone and owner shop-connection reference from
verified source metadata. `sourceConnectionRef` identifies the owner’s per-shop
connection, not its app-level shared credential: one credential can authorize
multiple shops. The profile array forbids duplicate portal IDs, canonical shops
and owner shop-connection references; bounded strict parsing rejects secret or
unknown fields and unsupported acquisition owners.

Fresh source-code inspection found Sale Dashboard's TikTok client and credential
refresh manager. Therefore this lane explicitly retains that owner rather than
copying tokens into the portal or building a second refresher. This is a declared
ownership contract, **not evidence that a restricted service bridge is installed**.
No source database/secret read or actual account API call was needed for this
local provisioning implementation. A public page never reads these profiles.

The current plan preview shows platform/capability, account/namespace,
acquisition owner, source connection reference, current state and explicit grant
changes. Only a digest of the full configuration is included; raw token material
is not accepted. Editing an owner reference between preview and apply invalidates
the reviewed digest. Existing unapplied previews from before D073 must be generated
again because the displayed platform/capability is now part of the plan digest.
Already-applied commands still replay, but only after their current account
identity is checked against the selected platform; a Facebook result cannot be
replayed as TikTok success. Inspection also rejects a configured ID pointing to
a different stored identity.

## Operator command

The normal trusted identity/database environment is required. Inject configuration
and secrets at runtime; do not put secret values in shell arguments. Feature flags
may remain0 while metadata is inspected and prepared.

```sh
npm run marketing:provision -- --platform tiktok --inspect
npm run marketing:provision -- --platform tiktok path/to/command.json
npm run marketing:provision -- --platform tiktok path/to/command.json --apply --plan-hash REVIEWED_SHA256
```

The command file uses the existing schemaVersion1 ProvisionCommand: commandId,
operatorRef,evidenceRef,connectionId,expectedRevision,label,grantUserIds,
revokeUserIds. No platform/account override, token or `enabled` field is accepted
in that file. Preview does not write. Apply records the reviewed operation; it
adds/removes only explicitly named grants. `--staff-after ID` remains available
with `--inspect`. Omitting `--platform` still selects Facebook; unsupported
platform names are rejected before connection creation.

The marketing video options endpoint can then discover the granted TikTok shop
but returns `available:false` until enabled/verified state and a complete current
video collection exist. Merely adding a row must not be described as a working
API connection or a successful Analytics permission check.

## Verification and transition

Local tests exercise strict profiles, raw-secret rejection, duplicate references,
shared Facebook regressions, real CLI preview/apply for both platforms, native
SQL creation/grants/audit, unavailable marketing discovery, changed-owner plan
rejection and cross-platform replay/inspection rejection. No migration was needed.
Exact counts and evidence are in the D073 context receipt.

Rollback stops new TikTok operator commands and retains the disabled records,
grants and immutable audit. No destructive cleanup, source project mutation,
credential change, live enablement or independent release acceptance is included.
Next: verify authorized shop/cipher/account metadata and Shop Analytics access
through one owner, wire the restricted source service/worker host, and prove the
actual account/report path before enabling this capability.
