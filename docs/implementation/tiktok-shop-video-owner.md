# TikTok Shop Video owner bridge and worker

D075 · local implementation. Both protocol peers and the Portal worker are
implemented. The owner handler is **not installed in Sale Dashboard**, no real
service credential has been provisioned, and no real seller account was read.
This extends [verification](tiktok-shop-video-verification.md),
[provisioning](tiktok-shop-video-provisioning.md) and
[daily scheduling](tiktok-shop-video-schedule.md).

Follow-up: [D076 native staff controls](tiktok-shop-video-controls.md) connects
status/Verify/Pause/Retry to the shared UI and native HTTP route. Source owner
installation and production supervision remain separate pending work.

[D077 process supervisor and health](marketing-worker-supervision.md) now provides
the executable foreground supervisor; production service installation is still pending.

## Responsibilities

The source owner holds the TikTok seller OAuth credentials, refresh logic and
shared app/shop quota. The Portal holds connection grants, schedules, leases,
immutable observations and the clip-to-partner mapping. Browser reads use the
Portal's stored projection; they never trigger a platform request.

`owner-handler.ts` provides the source-side Web Request/Response handler;
`owner-client.ts` provides the Portal adapter. They share strict schemas in
`owner-protocol.ts`. A separate machine-to-machine credential authenticates the
Portal to the owner. It is not a seller access token.

The owner module currently lives in this repository with its verifier, collector,
transport and contract dependencies. Installing it in Sale Dashboard requires
packaging/adapting those dependencies and mounting the handler in that service.
The existing Sale Dashboard staff-cookie endpoints are not this service API.
Constructor injection and a passing local test do not establish a live bridge.

## Narrow protocol

Only `POST /internal/partner/shop-videos` is accepted. Requests require JSON and
a bearer service credential. Browser Origin headers are rejected. No caller can
supply a URL, endpoint, OAuth token, shop cipher or arbitrary platform query.

Each request carries a UUID request ID, configured connection ID, configured
source connection reference, and one action:

- `verify`: returns the safe authorized-shop and Analytics capability proof.
- `collect`: also requires a 1–31 day half-open period, and returns a normalized
  complete report or a partial status with no video observations.

The owner validates the service credential against configured SHA-256 hashes and
an explicit per-client connection allowlist. Its own profile determines the shop
and source connection. The injected credential resolver must map this profile to
the existing owner record and preserve the existing refresh and quota authority.
Do not introduce a second token refresh loop in the Portal.

The Portal checks response schema, request ID, action, connection identity and
exact requested dates. Verification also checks the profile digest. Source counts
and money remain exact strings; missing values remain null. A partial report
cannot become a zero report or replace last-good data. GMV and platform performance
do not update commissions or payables.

Requests are capped at 4 KB, successful responses at 12 MB and error envelopes at
4 KB. Source collection retains its existing 20-page/2,000-video bound. Exceeding
these limits is not a successful full-shop import; large-shop staging remains
future work. The owner handler has a 65-second budget; Portal calls allow 25 seconds
for verification and 70 for collection, bounded further by worker cancellation.
Source calls retain their own shorter limits. Redirects are rejected. All responses
are private/no-store. Raw error bodies and source credentials are not surfaced.

HTTPS is required for owner origins except explicit `http://127.0.0.1` loopback
testing. Production hosting must enforce TLS, request-size/concurrency limits,
forward disconnect cancellation and redact Authorization headers from logs.
Service token rotation and owner-client allowlists belong to the owner operator.
No service host, TLS ingress or supervisor is installed by this batch.

## Portal worker composition

`createConfiguredShopVideoWorker` composes the owner client with the native SQL
store and daily worker. It returns null unless all three flags are `1`:

```text
LABSD_MARKETING_ENABLED
LABSD_TIKTOK_VIDEO_ENABLED
LABSD_TIKTOK_VIDEO_SYNC_ENABLED
```

The default example keeps them off. Once the real owner endpoint is installed,
the worker needs metadata in `LABSD_TIKTOK_VIDEO_PROFILES`, a root HTTPS origin in
`LABSD_TIKTOK_OWNER_ORIGIN`, and runtime-injected
`LABSD_TIKTOK_OWNER_SERVICE_TOKEN`. These settings belong only on the server.
Portal database/credential-namespace configuration is also required. Every store
transaction checks the native namespace binding; the worker SQL pool is capped
at two connections with statement/lock timeouts.

The command `npm run shop-video:sync` executes one bounded tick. Add
`-- --continuous` for a foreground loop with a 15-second delay between ticks.
This is a runnable process, not an installed scheduled service. Daily due times,
retry state and leases remain durable in PostgreSQL, so the loop does not fetch
every shop every 15 seconds. Starting it never enables an unverified connection.
Pause remains effective even while the owner is unavailable.

One-shot output is safe structured metadata. Exit 0 indicates normal completion
(including disabled/idle); exit 2 indicates a partial report or a job needing
attention; exit 1 indicates configuration/runtime failure. SIGINT/SIGTERM abort
ongoing work and close SQL. External supervision and health reporting remain to
be connected. Host restart and actual production process behavior are not proven
by a unit test.

The client distinguishes source access/schema problems from transient owner
outages. An HTML/empty gateway 5xx is retryable; HTTP 429 and Retry-After preserve
the requested cooldown, including values longer than the normal retry policy.
Neither an outage nor a partial report overwrites complete observations.

## Validation and remaining installation work

Unit coverage exercises authorization, connection allowlists, swapped shop/date/
request responses, cancellation, body limits, disabled composition and proxy
cooldown handling. A local HTTP server test runs the native owner handler and
Portal client through a real socket, then verifies the native PostgreSQL path:
disabled shop → verified shop → worker publication → video mapping → partner
projection → pause. Only upstream platform responses and credentials are synthetic.

Remaining: install a source-specific credential/quota adapter and mount the owner
handler; provision separate service identity; verify actual account Analytics
entitlement; wire native lifecycle routes/UI; supervise the worker and expose
health; test large-shop staging, real load and recovery. Keep rollout off until
these checks pass. Stopping the worker/turning off the sync flag preserves audit
and last-good data; no schema migration is introduced here.

[D078 source credential adapter](sale-dashboard-video-credentials.md) now reads
an exact Sale Dashboard account/credential snapshot. It remains uninstalled.
Fresh source inspection did not establish a shared outbound quota governor or
active refresh scheduler wiring; the earlier responsibilities describe intended
ownership, not verified operational readiness. Native lifecycle UI and the
foreground supervisor were completed in D076/D077; source mounting, quota,
refresh scheduling proof and real entitlement remain.

[D079 installable package](shop-video-owner-package.md) provides a bundled ESM
archive, generated public types and artifact verification, ready for source
installation work. It also locates the existing refresh scheduler in `worker/`.
No source mount or live-account enablement has happened yet.
