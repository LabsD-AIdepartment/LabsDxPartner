# Installable TikTok Shop Video owner package

D079 builds `@labsd/shop-video-owner` from the existing owner handler and the
Sale Dashboard credential adapter. The package is a local installation candidate;
it has not been installed in Sale Dashboard or enabled against real accounts.

## Build and contents

Run `npm run build:shop-video-owner` on the project's pinned Node runtime.
The command prints a JSON receipt with the package directory, `.tgz` archive,
archive SHA-256, source commit and dirty-state marker. Every build gets a separate
directory under ignored `.agent-work/owner-package/`. Nothing is published.

The archive contains bundled ESM, generated public TypeScript declarations,
package metadata, the bundled Zod license and a build receipt with input/output
hashes. Zod 4 is private to the bundle; the source project's Zod 3 dependency stays
independent. There is no runtime dependency on Next, React, Portal PostgreSQL,
source path aliases or either application's module resolver. Node 24 or later is
required; use the owner's supported/pinned runtime for release verification.

The build uses explicitly pinned esbuild 0.28.2, already present in the lockfile,
and the pinned TypeScript compiler. It checks that the artifact area is ignored
and untracked, rejects unexpected runtime imports, and packs offline with scripts
disabled. Secrets, `.env` files, source account rows and encryption keys are not
build inputs. The receipt explicitly sets `releaseApproved: false`; a dirty
candidate and its passing tests are not an independently accepted release.

## Public API

```ts
import {
  createSaleDashboardShopVideoOwner,
  type ShopVideoOwnerOptions,
} from '@labsd/shop-video-owner';

const handler = createSaleDashboardShopVideoOwner(options);
const response = await handler(request);
```

`ShopVideoOwnerOptions` contains `enabled`, metadata-only `profiles`, source
`bindings`, authorized service-client token hashes/connection allowlists, and a
lazy `connect()` factory. Only `enabled === true` enables construction. Disabled
construction does not call `connect()` or inspect profiles, and requests return
404 without source access. The host must map its environment flag with `=== '1'`,
not JavaScript truthiness of a string.

The enabled `connect()` result supplies:

- `query: (config) => pool.query(config)` from the Sale Dashboard source pool.
- `decryptToken` from `src/lib/crypto/tokens.ts`, inside the source process only.
- `reserveRequest({ connectionId, appKey, shopCipher }, signal)` from the **shared outbound** app/shop quota
  governor, returning `{ allowed: true }` or
  `{ allowed: false, retryAfterMs: number }`.
- Optional `fetch` and clock ports, used for isolated verification.

A missing quota callback prevents enabled construction. Rejected reservations
preserve their retry delay through the existing safe protocol. Malformed results
and governor errors prevent upstream requests. Do not satisfy this requirement
with an unconditional allow callback, a browser/IP limiter or a separate local
counter that ignores other callers using the same app.

The package never constructs a database client, loads environment configuration,
refreshes OAuth tokens, launches a scheduler or exports secrets. The source
application still controls configuration and infrastructure lifecycle. Existing
request limits, fixed paths, service authorization and secret-safe error envelopes
remain in the owner handler.

## Source integration points verified in the current checkout

Source commit: `f1af3d8b10cdc44573f391f87db2df3f17b7ec3a`.

1. Install the tested archive as a local dependency of Sale Dashboard using its
   normal lockfile/review workflow. Record the archive digest; do not import a
   sibling Portal source directory or refer to a temporary build path at runtime.
2. Mount the handler at `app/internal/partner/shop-videos/route.ts`, exporting
   `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` and `POST`. Keep enabled off
   until source pool/decrypt/quota, bindings and service identity are configured.
3. `middleware.ts` currently cookie-gates this path and would redirect an M2M
   worker to `/login`. Add an **exact-path** cookie-gate exemption for
   `/internal/partner/shop-videos`; its route still requires the package's own
   bearer service identity. Do not exempt all `/internal` or all API paths.
   Verify wrong/missing bearer tokens fail and no request becomes anonymous.
4. Carry request cancellation to the Web Request handler; bound ingress body
   size/concurrency, enforce TLS and redact Authorization in access/error logs.
5. Connect the existing source token-refresh worker and outbound quota. Prove
   actual worker execution/health and a real shop's Analytics permission before
   enabling its Portal connection.

These are concrete source integration changes still to be applied and verified.
The current source checkout was inspected read-only. No middleware exemption,
route mount, archive install, source service restart or credential provisioning
was performed by this batch.

## Refresh scheduler evidence, correcting the earlier search gap

D078 searched `src`, `app` and `scripts`; it did not search the top-level `worker/`
entry point. Inspection now establishes the source wiring:

- `worker/index.ts` imports `refreshDueTikTokCredentials`.
- `scheduleTikTokTokenRefresh()` installs the repeatable `tiktok.token.refresh`
  job on its own queue, and the startup section calls that scheduling function.
- Its worker dispatches `refreshDueTikTokCredentials(TIKTOK_TOKEN_REFRESH_AHEAD_MS)`
  with concurrency 1.
- `src/lib/jobs/tiktokTokenRefresh.ts` defines a six-hour interval and a 48-hour
  refresh-ahead window.

This proves the code path, not that the deployed worker/Redis job is currently
healthy or running this commit. Reuse this worker; do not add a second refresh
loop to the Portal or package. Shared outbound quota is still a separate gap;
request-local retries and the inbound fail-open limiter are insufficient.

## Artifact verification

The package test builds an actual archive, unpacks it into an isolated directory,
and imports that unpacked artifact with a separate Node process. It exercises
flag-off laziness, service authorization, verification, collection, quota denial
and malformed-governor denial. Source SQL/decryption and TikTok responses remain
synthetic in this artifact test; D078 separately tests the real SQL shape.

A separate TypeScript consumer resolves the package by its package name and
checks the generated declarations, including rejecting a configuration without
quota ownership. Output digests and bundled dependency boundaries are checked.
The first consumer attempt hit TypeScript's explicit-config requirement; it was
corrected by giving the consumer its own tsconfig, not by suppressing diagnostics.

Remaining acceptance: source installation/middleware tests, shared outbound
quota, deployed refresh-worker observation, actual service identity/entitlement,
large-shop recovery and production load/rollout. Disabling the owner route or
Portal sync stops acquisition while retaining last-good reports and audit data.

D080 adds [the shared quota governor](tiktok-shared-quota.md). The pre-install package API is now version0.2.0: reservation receives the same app/shop identity used to sign the request. Owner HTTP protocol is unchanged. Source installation still depends on a committed upstream package per its cross-lane rule.
