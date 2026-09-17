# TikTok Shop Video — native persistence and API

D070, 2026-09-10. Extends the [P05a collector](tiktok-shop-video-collector.md).
Native SQL publication, staff association and partner read services are locally
implemented, including HTTP handlers. The signed collector, SQL store and cycle
run together in integration tests with synthetic upstream responses. **The production credential owner and supervised live runtime remain pending.**
D071 supplies the [shared frontend](tiktok-shop-video-ui.md); D072 supplies the
[durable planner and bounded worker tick](tiktok-shop-video-schedule.md).
Both marketing and TikTok Video flags must be enabled to expose the new routes;
the example configuration leaves them off.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| video-collector / video-transport | Fixed endpoint, signed reads, complete source collection; no SQL or commission calculation |
| video-store | One shop-period window, account lease, validated immutable generations, indexed observations, atomic publication/revisions |
| video-cycle | Claim, collect outside SQL, publish or record safe failure; no scheduler installed |
| video-registration | Current staff/grant checks, exact video/creator proof and immutable association to the existing agreed clip target |
| video-partner-read | Current membership and clip authorization, exact compatible range projection, safe graph series |
| shop-videos HTTP / video-runtime | Method/origin/body/cache controls and independent capability switch |

No source calls occur when a partner reads or changes date filters. A complete
shop collection is shared across mappings, never copied into each celebrity's
public response. The initial clip selection remains the marketing team's audited
decision. Source creator identity proves the retrieved video's identity; it does
not automatically prove that a display name or photo belongs to a celebrity.

## Storage and compatibility

Migration0024 depends on0023 and retains all existing data. It expands the
connection constraint to two exact platform/capability pairs: Facebook Ads and
TikTok Shop Video. It does not allow an arbitrary platform/capability combination.
The existing Facebook-only registration and account management paths now select
their capability explicitly, including lookup authorization. TikTok connections
cannot accidentally enter Facebook verification or ad-ID parsing.

New tables in portal_marketing:

- video_windows: unique connection + calendar interval + timezone, lease and
  current-generation pointer, last-success/error state.
- video_generations: immutable metadata and collection digest, unique lease
  publication, exact connection revision.
- video_observations: indexed generation + video ID, stable creator ID and exact
  normalized measurements. Generation ownership prevents mixed snapshots.
- video_mappings: immutable source-to-target association, proof generation and
  actor. Namespace + shop + video uniqueness prevents silent reassignment.

Account leases reuse connection_runtime so concurrent periods cannot duplicate
whole-shop collection. Claim and publish use the same account-before-window lock
order. The worker rechecks configured identity, current enabled/verified state,
connection revision and lease validity at publication. Source I/O is outside the
transaction. A complete collection and all observations are inserted atomically,
then the pointer and affected partner metrics revisions advance together.

Repeated publication with the same lease and digest returns the original
generation; a changed digest conflicts. Partial, malformed or failed collection
cannot replace last-good data. An expired worker cannot overwrite its successor.
Failure releases its lease and preserves a provider cooldown without shortening a
long valid Retry-After. Runtime expiry is reflected as stale when reading retained
data even if a worker died before recording failure.

These are immutable observations, not an evidence-deletion policy. No purge,
rollback DROP or changes to financial ledgers are included. Apply expansion
before enabling this lane; rollback disables it and retains the tables. The local
numeric migration number must be reconciled with the eventual merge/deployment
ledger. No production migration was run.

## API contracts and checks

| Route | Method / behavior |
| --- | --- |
| /api/v1/staff/shop-videos/lookup | POST; current actor revision, target, connection and video ID → exact indexed source proof |
| /api/v1/staff/shop-videos/save | POST; proof generation/creator, target/connection revisions and idempotency key → immutable mapping |
| /api/v1/partner/content/shop-videos | GET; current partner permission revision, clip ID and calendar interval → authorized totals and graph series |

Requests are defined in src/contracts/shop-video.ts. Staff mutations require the
same origin, JSON, bounded body and current session/staff/account grant. Saving
also requires fresh authentication, as with the existing marketing save path.
Duplicate query keys and unexpected inputs fail. Responses are private/no-store.
Errors contain safe codes, never source payloads, signed URLs or credentials.

Lookup uses the latest complete ready collection under the current connection
revision. If that collection lacks the video, lookup does not search older rows
and pretend they are current proof. A source-generation change between lookup and
save invalidates the proof. Current grants are checked even for idempotent replay.
The mapping cannot be reassigned to another target or creator by resubmission.

Partner reads authorize membership, then join through the selected clip, active
target and exact video/creator mapping. A creator change or absent video cannot
inherit old values. Other shop rows, request IDs, namespace, connection/shop IDs
and creator identifiers are excluded from the public projection. Reports and
metrics revision are read in **one SQL snapshot**, avoiding old data paired with a
new revision. SQL uses indexed bounded lateral reads, not one network round trip
per mapping.

Calendar requests span up to366 days. The acquisition windows remain at most31
days. An exact interval report takes precedence; otherwise projection accepts
complete, compatible, disjoint intervals. Gaps prevent full-range totals.
Overlaps, incompatible definitions or mixed source identities are rejected.
Views, SKU orders, units and GMV use exact arithmetic. A single report retains the
source decimal representation. CTR is retained only for an exact full interval
report, never summed or averaged. Per-period series preserves known values while
totals remain null for incomplete coverage. Missing values never become zero.

The response explicitly identifies TikTok Shop Video. It is not a paid-ad report
and does not create or alter commission, order eligibility or payable balances.

## Verification and remaining acceptance

Full unit suite432 cases/46 files and full integration suite226 cases/23 files
passed before final expiry/cooldown/series refinements. The final affected runs
cover12 TikTok native cases plus11 existing marketing registration cases, and the
collector/transport/projection tests. Typecheck and production build are recorded
in the D070 receipt. Only the owned isolated PostgreSQL55487 received0024; earlier
migration checksums were verified.

Failures retained in evidence: the first test binding callback incorrectly asked
the single-connection pool for another connection inside a transaction; it now
uses that transaction. A revision assertion assumed the catalogue had not already
advanced metrics; it now compares the before/after delta. An exact-range projection
initially normalized the source decimal scale; it now preserves that string.

Next work is a concrete completion path, not another platform-sized rewrite:

1. Wire a verified single credential/refresh owner and quota owner, source-account
   verification, and trusted TikTok connection provisioning. Metadata-only flags
   or a successful store-order OAuth grant do not prove analytics access.
2. D071 completed shared marketing lookup/save and partner totals/series UI locally.
   Native authenticated browser and account acceptance remain.
3. D072 adds durable daily planning/retry and a bounded worker tick. Finish supervision and
   bounded resumable staging for shops beyond the current2000-video collector
   cap. Ensure new and historical clips have a usable acquisition interval.
4. Verify native browser journeys, mobile/200% zoom, source freshness and load,
   then obtain actual account/report evidence before enabling the capability.

No frontend or rendered-browser change, live source request, real credential,
production exposure or independent release review is claimed by D070. P05 as a
whole and the original remaining project phases are still open.
