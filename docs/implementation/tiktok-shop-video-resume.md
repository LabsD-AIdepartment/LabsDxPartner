# TikTok Shop video: durable native scans

D085, 2026-09-11. The configured native worker now uses the source owner's
`page` action, installed in Sale Dashboard owner0.3.0. The existing whole-shop
collector remains available for diagnostic callers and compatibility. No
production worker, credentials or platform access is enabled by this change.

## Acquisition and publication

The native database owns one active scan per connection. Migration0026 expands
0025 with disposable scan metadata, page receipts and normalized rows. Published
video generations, observations and financial data remain unchanged.

The existing scheduler claims an account/window lease for90seconds. Each batch
reads at most two source pages, committing a cursor and rows after each page.
Every source request resolves current credentials and source quota through the
existing owner service. Source I/O is outside SQL transactions. The configured
25second client page deadline keeps two reads within the lease under normal
operation; expiration still fences publication if a database wait exhausts it.

Between batches the worker releases the lease. The active eligible window stays
first for that shop until complete; the existing persisted last-claim ordering
continues rotating shops. Process restart reclaims the same stored scan and
cursor, including a terminal page committed immediately before a crash. A
second process cannot append, discard or publish using an expired lease token.
Connection revision, profile identity and schedule horizon are rechecked on
every write. A replaced profile/window discards only incompatible staging.

The publish transaction verifies terminal count against both declared total and
stored row count, copies staged observations into an immutable generation with
`INSERT ... SELECT`, changes the window's current generation, advances mapped
partner revisions and releases the lease atomically. No large JavaScript array
of the entire shop is required. Existing partner reads see either the previous
complete generation or the new complete generation. They never read staging.
Normalized decimal strings preserve precision; unavailable metrics remain null,
and explicitly reported zero remains zero.

Each page is request-correlated and schema validated. Global video uniqueness,
cursor history, stable total count and source readiness watermark are checked
across pages. Source performance/GMV does not become commission or payment truth.

## Bounded work and recovery

Initial operational limits are200pages,20000rows,32MiB of cumulative serialized
page evidence and2hours per active scan. These are application resource limits,
not TikTok contractual limits. Database/index/normalized-row overhead is
additional to the evidence-byte counter. Limits need re-evaluation against real
shop size, quotas and operational load before release.

- Partial batches are queued progress, not source errors.
- Cancellation, temporary failures and quota holds retain the last committed
  cursor and last-good report; the existing backoff/provider cooldown applies.
- Invalid cursor or contradictory source data discards unfinished staging. A
  window with no earlier failed attempt gets one clean retry; repeated failure
  uses the existing invalid-source attention policy. Attempt count resets only
  after successful publication or a verified connection revision, so earlier
  transient failures can consume this conservative automatic-retry allowance.
- Exceeding operational limits is `page-limit`: discard staging and pause that
  window immediately without another full scan. Other due windows remain
  eligible. Only access/invalid-source holds apply to the entire shop, matching
  D072. Last-good data is retained.
- A behind source watermark yields source-not-ready and a delayed clean retry;
  it cannot be published as complete.
- Inactive/paused scans occupy at most one bounded staging set per connection.
  Reclaim/discard/publication removes staging rows through FK cascade. This is
  not the broader immutable-report retention policy, which remains separate.

The provider does not document a transactional snapshot cursor. Stable counts
and watermarks detect some drift but cannot exclude a same-count mutation while
pages are read. Owner fetch timestamps are not forced to increase strictly:
clock corrections or multiple owner hosts could otherwise create false errors,
and ordering timestamps would not establish provider snapshot consistency.

## Rollout and rollback

Apply additive0026 before running the updated native worker. Install source
owner0.3.0 before its page caller. Both normal feature flags remain OFF until
separate release/entitlement checks. New code requires the expanded schema;
previous worker code remains compatible with it. Stop/revert the worker for
rollback and retain the new tables and all published data. Do not roll back the
source owner below0.3.0 while a page caller is enabled. No applied migration was
edited; no backfill or production database operation is included.

## Verification

Owned PostgreSQL tests exercise the configured worker through the owner handler
and signed source transport with synthetic upstream data:2101videos/22pages,
reconstructed workers between batches, exact money/null/zero, complete-only
publication, expired-lease reclaim, stale writer denial, terminal-page resume
without another source call, quota/cancellation retention, duplicate/cursor/
count/watermark/shop/period failures, bounded clean retry, caps, source-not-ready,
revocation and changed horizon. Cap tests also prove window-local pause while
another day remains eligible. Existing TikTok native HTTP, projection and actual
CLI/supervisor integration tests cover compatibility.

Independent Sol review found operational caps were initially treated as source
corruption and would trigger a redundant restart; fixed with a native page-limit
error. A proposed shop-wide cap hold was rejected against D072 and restored to
window-local pause. Final verdict READY FOR DECLARED SCOPE; release/live provider
and full-load acceptance remain separate. Exact run results are captured in
`.agent-work/20260911-video-resume/FULL_STATE.md` after verification finishes.

The legacy whole-collection publisher also removes unfinished staging for its
own window inside the successful publication transaction. Otherwise a later
page worker could resume a pre-publication cursor and overwrite a newer report.
Staging for a different period remains independent.
