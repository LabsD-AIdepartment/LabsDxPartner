# TikTok Shop Video — bounded owner page reads

D084, 2026-09-11. This is the acquisition prerequisite for durable scans beyond
the existing whole-shop collector cap. It does not yet activate resumable native
workers or change what partners see.

## Contract and ownership

Owner package0.3.0 adds `action: "page"` to the existing fixed POST
`/internal/partner/shop-videos`. Existing `verify` and `collect` requests and
responses remain compatible. Page requests carry the same request ID, configured
connection ID and source connection reference, plus the closed calendar interval
and `pageToken` (null for the first page, the opaque returned token thereafter).

Each request resolves the current source credential and reserves shared source
quota before the fixed signed TikTok read. The page reader fixes the same 202605
endpoint, local currency, all creators, descending GMV and page size100. It never
accepts an arbitrary URL, shop cipher, token or query dimension from the caller.
The existing source transport enforces its15-second request deadline and2MB body
cap; the page reader bounds the whole operation to20seconds. Existing4KiB inbound
owner body limits remain in force. Page response limits are2,004,096 bytes on both
peers, including the owner envelope. Large escaped cursors that exceed the request
body bound are rejected; the bound is not bypassed by pagination.

The returned `shop-video-page` evidence echoes connection, period and requested
cursor, records fetched time, and carries one validated API page. The client
checks the exact request ID/action/shop/profile/period/cursor correlation. Raw
unknown response fields are stripped by the source schema. Seller secrets and
shop cipher are never included. Cursor and other-shop video data remain at the
server boundary, not in browser APIs.

The reader rejects duplicate video IDs within a page, incompatible currency,
unsafe counts, malformed measurements, future readiness dates, empty continuation
pages, direct cursor loops and impossible first-page counts. Missing metrics and
reported zeros stay distinct; decimal money is preserved as strings. A behind
source watermark is evidence for the scan validator, not fabricated readiness.

## Completeness is deliberately separate

A page cannot pass `CompleteVideoCollection`, so existing publication cannot
mistake one page for a shop total. The new method performs exactly one source read
and never silently restarts a full-shop scan. A page action rejected by an old
owner fails explicitly, with no fallback to `collect`.

Install owner0.3.0 before enabling its future native caller. Old clients can use
new owners; do not enable a page client against owner0.2.x. The native configured
worker still calls `collect` in this change and retains its current2000-video cap.
No migration or staged cursor store is included here. Rolling back the package
keeps existing collect/verify behavior; leave the future page caller disabled
until both peers support it.

## Required next integration

The native store must own persisted scan rows and cursor under the current
connection revision, account/window lease and immutable period definition. A
worker restart must reclaim a scan without allowing an expired worker to append
or publish. Validate cross-page total/watermark stability, cursor history, global
video uniqueness and final count before atomic publication. Retain last-good
reports throughout partial scans, cancellation and quota cooldown; never sum
partial pages into partner totals. Bound scan age, page/row/storage work and
invalid-cursor recovery with explicit operational policy.

The upstream API has no documented transactional snapshot token. Resuming a
cursor is not proof of a transactionally consistent snapshot; existing count and
watermark checks detect some drift, not every same-count change. Native staging
must retain this limitation rather than calling a scan a financial ledger.

## Validation scope

New tests drive the real Portal client → owner handler → signed transport with
synthetic upstream responses: first/next-page flow, an explicit cursor beyond the
old twenty-page cap, exact money/null/zero, malformed and duplicate rows, currency,
count and cursor failures, future-period denial before source access, cancellation,
request correlation, per-page credential/quota reservation, preserved Retry-After,
and no whole-shop fallback against an old owner. The built archive smoke also
exercises the page action alongside unchanged verify/collect/quota behavior.

No live account/entitlement, native database recovery, browser change or production
readiness is claimed by these tests. The follow-up integration must prove durable
restart and complete publication using the existing worker/store architecture.
