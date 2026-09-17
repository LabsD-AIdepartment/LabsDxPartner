# TikTok Shop connection controls

D076 · native route/service/UI composition. Extends the
[owner bridge](tiktok-shop-video-owner.md) and
[verification lifecycle](tiktok-shop-video-verification.md).

## Staff workflow

The Marketing page exposes a collapsed “ร้าน TikTok Shop และสถานะนำเข้า” panel
when the TikTok video capability is enabled. The existing shared connection
component also serves Facebook. Each panel has a separate platform cache key,
validates the returned platform and actor scope, and loads status only when open.
While open, it refreshes stored status every 15 seconds; these reads do not call
TikTok or start collection.

Staff see only granted shops, whether the service configuration is present,
the verification time, the number of current report periods, periods needing
attention and the last successful import in that current schedule/revision.
Old retained evidence is not counted as current after connection changes.
These are report-period counts, not numbers of ads or videos. A ready source
adapter is not proof of installed supervision or actual account entitlement.

The controls use the existing audited lifecycle:

- Verify checks the configured owner service and source capability before enabling
  the shop. It preserves the native staff/grant/revision checks around source I/O.
- Pause works without owner configuration and retains existing observations.
- Retry appears only when a failed report is eligible for requeue. Access and
  invalid-source holds require successful verification instead. Provider cooldowns
  and active worker leases remain effective.

Successful commands refresh connection status and the shop options used for video
registration. Closing the panel aborts its pending work. A lost response retains
the idempotency key for the same command intent.

## Native API and composition

`GET/POST /api/v1/staff/shop-videos/connections` is a Node, dynamic route gated by
identity, marketing and TikTok video flags. The staff page receives the video flag
from the server and hides the video sections when it is off. No browser can supply
an owner URL, service token, verifier or platform override.

`video-connections.ts` owns the grant-filtered status query and delegates commands
to `video-lifecycle.ts`. Reads use current native staff permission checks and SQL
aggregates bounded to 100 granted shops and each shop's current schedule/revision.
`owner-runtime.ts` composes the D075 owner client from server-only configuration.
Missing/invalid owner setup yields no verifier, allowing status and Pause to remain
available while Verify is disabled. This does not bypass identity/database binding.

The shared HTTP wrapper keeps same-origin JSON POST validation, bounded body
handling, current session checks, safe errors and private/no-store responses.
Its command budget is 30 seconds to contain the owner's bounded verification
roundtrip. Facebook retains its own verifier and lifecycle. The common snapshot
accepts Facebook or TikTok and an optional retryable count; existing Facebook
responses are unchanged.

## Evidence and remaining work

Native PostgreSQL integration covers source-free GET, scope/grant isolation,
current-period counts, retryable versus access-held work, origin rejection, Pause
with no owner, grant revocation and HTTP Verify through both signed synthetic
upstream calls. Shared component tests cover two panels under one query provider,
wrong-platform rejection, missing-owner Pause and retry visibility. The development
preview uses one shared in-memory shop state for both controls and registration.

The existing in-app preview was exercised through Pause and Verify; registration
became unavailable after Pause and available after Verify. Day/Dark token state was
checked and Day restored. Rendered main text/buttons were 16px at the observed
1016px CSS viewport. This is not native authenticated browser acceptance or a
mobile/200% zoom test. The screenshot capture had scaling/clipping artifacts;
DOM measurements are retained separately and are not a broad visual acceptance.

No schema migration, actual account activation, source service installation,
credential provisioning or supervisor installation is included. Next work remains
the source-specific owner integration and real entitlement, supervised worker and
health, large-shop staging, native end-to-end browser/load/recovery verification
and the remaining platform and release phases. Rollback disables the capability
route/UI while preserving audit, mappings and last-good observations.
