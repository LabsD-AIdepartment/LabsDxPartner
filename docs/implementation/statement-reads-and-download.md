# Native statement reads and CSV delivery

The Transactions application now reads published periods and payment history from PostgreSQL through the existing native session and current partner membership. Its layout remains the existing StatementList, StatementDetail and DocumentList. Development previews keep their explicitly synthetic transport. The native routes remain behind `LABSD_FINANCE_ENABLED` and the identity database binding check.

## Read contract

- `GET /api/v1/partner/statements?partnerId&permissionRevision` returns issued periods, a status filter, independent settlement revision, data-through and total confirmed unpaid across all periods.
- `GET /api/v1/partner/statements/[statementId]?partnerId&permissionRevision` returns the frozen statement, included earning lines, current signed payment allocations and owned CSV document reference. Optional `version` checks the frozen generation; `revision` checks both publication and payment state.
- Pages use time and opaque UUID keys. List uses `cursor`; detail uses independent `lineCursor` and `settlementCursor`. Default limit20, maximum100. Cursors bind partner, resource/filter and revision. SQL retains six-digit timestamp precision in the cursor instead of rounding through JavaScript Date. Public display timestamps may use milliseconds.
- One data SQL statement supplies totals, rows, counts, timestamps and revision per response, after authorization in the same access transaction. No upstream call occurs during rendering. Responses are private/no-store. Unauthorized membership gives401/403; stale scope/version/revision gives409; invalid query gives400; unavailable or invalid stored data gives503. No published revision means unavailable rather than a fabricated confirmed zero.
- Total unpaid sums signed period balances before clamping at zero. Filtering to pending periods does not discard credits from the global total. Frozen earning totals remain unchanged by later payments. Payment reversals show negative components, the original payment reference and reversal evidence; other settlement methods retain their reason reference.

## Delivery and compatibility

`transactionHttp` replaces the production Transactions unavailable adapter. `statementDocumentHttp` validates the document against an authorized detail response, then fetches the private CSV again on the actual download click. Revoking membership between preparation and download therefore denies delivery. It accepts only the owned `csv:<statement UUID>` document and a fixed same-origin route; no arbitrary file URL or saved authorization ticket. Pending/denied downloads are shown inline. Shared PreparedDocument supports synchronous preview delivery and asynchronous native delivery.

Migration0014 adds an opaque row UUID and generation/time/UUID index without changing monetary payloads, canonical entitlement keys or existing hashed earning-line references. Existing named-column inserts receive the default UUID. Applied migrations remain immutable. A code rollback can retain the additive metadata/index. Applying this migration to production still needs size/lock and release review; it was applied only to the isolated project database.

## Verification and remaining scope

Native integration runs through maintained credential login, current membership, actual approved-period import/publication/payment services, PostgreSQL, HTTP factories and the same frontend `loadTransactions` response validator. It exercises all six lines at two per page with timestamps differing only in microseconds; totals3736000satang; an immutable-100000credit lowering global unpaid to3636000; pending-filter consistency; partial settlement600000 including other-method evidence; stale cursor/revision denial; complete reversal restoring the obligation; cross-partner/version/permission denial. Client tests exercise same-origin scoped requests, asynchronous errors, revocation at download, CSV type and disposal. Existing financial, invitation and preview tests remain in the full suite.

This is the Transactions slice of G04. Overview/content reads, small changes metadata, selective invalidation, notifications and source acquisition/ops composition remain. Controlled native HTTPS/browser acceptance, actual file delivery in a browser, load/restore proof and independent release acceptance are not established by the factory/unit tests. No production exposure, migration, external payment or notification sending is included.
