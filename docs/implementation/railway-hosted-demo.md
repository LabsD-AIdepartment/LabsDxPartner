# LabsDxPartner on Railway

This release packages the owner's accepted local presentation as an authenticated hosted
**demonstration**. It is not a live payment service. The existing footer, native credentials,
fixed user/partner allowlist, permission checks and simulated-withdrawal semantics remain.

## Build and runtime boundary

`npm run build` still produces the native application and verifies that development fixtures
are absent. `node scripts/build-hosted-demo.mjs` deliberately builds the hosted demonstration.
Only the partner composition, dataset reader and database-backed ad projection change aliases;
all unrelated developer preview routes remain unavailable in production.

The build embeds `LABSD_HOSTED_DEMO_ARTIFACT=1`. Runtime must additionally set
`LABSD_PRESENTATION_MODE=pitch` and `LABSD_HOSTED_DEMO_ENABLED=1`. An ordinary artifact cannot
be enabled merely by changing the runtime flag. No synthetic authentication is provided.

`Dockerfile` builds with Node24.18.0 and the frozen npm lockfile. Railway runs the production
Next server on `0.0.0.0:$PORT`; it never launches `next dev`. `railway.toml` gates on `/api/ready`.
The supervised external-data child retains the existing SQL lease/refresh behavior; its provider
credentials are removed from the web child's environment. Turning the demonstration flag off
leaves native authorization in place and makes demonstration data/media unavailable.

## Resources and private configuration

Project: LabsDxPartner (`e324426f-826d-4a2b-bc78-e0675ec6063a`), production environment.
Web service: `73e157a9-b880-4efe-b96b-190522740b00`; generated domain:
`https://web-production-e0616.up.railway.app`. Postgres is a separate service. Web has a persistent
volume mounted at `/data`. Resource creation alone is not a successful application deployment.

Provision these runtime variables by secure stdin or Railway references, never Git or build args:

- `DATABASE_URL` referring to the new Postgres service, `BETTER_AUTH_URL` equal to the HTTPS domain,
  a new `BETTER_AUTH_SECRET`, `LABSD_IDENTITY_ENABLED=1`.
- `LABSD_PRESENTATION_MODE=pitch`, `LABSD_HOSTED_DEMO_ENABLED=0` initially,
  `LABSD_PITCH_USER_ID`, `LABSD_PITCH_PARTNER_ID` preserving the approved native identity.
- `LABSD_HOSTED_DATA_DIR=/data`, `LABSD_AD_SNAPSHOT_DATABASE=1`, `LABSD_AD_SNAPSHOT_ENABLED=1`.
- Existing validated `LABSD_AD_SNAPSHOT_BINDINGS`, `LABSD_AD_COMMISSION_RATES_PPM`,
  `LABSD_FACEBOOK_PROFILES` and their referenced provider secrets, when enabling the existing worker.
  Keep auto-refresh-on-visit/file fallback disabled. No local Keychain reference can resolve on Linux.
- `LABSD_EXTERNAL_DATA_WORKER_ENABLED` only after target identity and report data have been verified.
  Preserve other existing feature flags deliberately; do not activate payments, public signup,
  SMS/email/invitation delivery or the unfinished account-media migration.

## Data cutover and rollback

Back up the current source PostgreSQL and SQLite consistently; never reset the local originals.
Import only into a verified empty target. Restore schema, required-migration ledger and native
accounts with ownership adapted to target roles. Exclude source sessions, verification/reset/link
secrets and pending identity actions. A copied password hash remains the same password; the target
gets fresh session-signing secrets and sessions.

Explicitly rebind the copied `credentials-v1` namespace to the target HTTPS origin using the same
`credentialBindingDigest` algorithm as the app. Rebind copied external-ad `namespace_digest` rows
from the old credential namespace to the new one; preserve their source binding key, complete
snapshot JSON, monetary values and original fetched timestamps. Clear copied acquisition leases.
Do not alter provider namespace/account/ad identifiers. Compare every table, documenting these
intentional identity/operational differences. Never silently use an empty dataset on a read error.

Copy `demo-dataset.sqlite` and the exact three private media files into `/data` and `/data/media`.
Keep them outside Git/images/public assets; verify SHA256 and SQLite integrity. They are accessed
through native-session-protected routes. Browser-only sample withdrawals belong to an origin;
a new Railway origin does not inherit local browser storage. Export/import that state through an
explicit reviewed transition if exact local simulated request history is required. Do not claim
cross-origin browser-state parity from a database copy.

No existing SQL migration is edited by this release; do not run the test migration launcher on
Railway. Read the target ledger before any migration and never retry a partially failed restore.
Rollback before launch is stopping the web service or disabling the hosted flag; retain target
state for diagnosis. Local4443 remains unchanged throughout. Code rollback does not restore data.

## Acceptance and outstanding gates

Required: ordinary and hosted production builds, full tests/typecheck, independent frozen-candidate
review, PR CI on current main; isolated data restore, bound credential login/logout and save/reload,
unauthenticated dataset/ad/media rejection, fixed-partner scope, all report amounts and private
media, and accepted phone/tablet/desktop layouts. Record deployment ID, merged SHA, artifact digest,
flag state and database comparison. Monitor worker freshness and HTTP errors after startup.

The initial private GitHub repository cannot enable branch protection on the account's current
plan (GitHub403, upgrade required). PR/check/review preparation may proceed, but merging/deploying
under the requested protected-main discipline requires resolving that gate or an explicit owner
exception. Do not make the repository public to work around it. No application deployment or
production-data compatibility is claimed until its actual verification receipt is complete.

GitHub Actions also refused to start the bootstrap job because of failed account payments or
a spending limit (run35331725526, zero steps executed). This is a separate account gate from branch
protection; local green checks must not be represented as hosted CI passing.
