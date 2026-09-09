# Native partner notifications

The shared header now shows notices from issued statements and recorded payment allocations, including reversals. A notice opens its owned statement. Counts come from current authorized data; the badge caps its display at 99+, without changing the underlying count. Loading, empty, failure, retry, mark-in-progress and older-page states are supported. The original shell and page layouts remain.

## Ownership and ordering

The financial history remains authoritative. Additive migration0017 creates a statement-owned reference index, with no copied amount, message body, delivery queue or external sender. Triggers append an index entry and increment the notice change revision in the same source transaction. Rollback therefore leaves no phantom notice; source replay does not create another entry. Each payment allocation links to its own statement. Reversals use an explicit reversal notice, rather than claiming another payment.

Index positions are allocated under the existing partner financial advisory lock. The ordering follows committed partner writes, independent of historical payment dates or wall-clock changes. Historical statements and allocations are backfilled deterministically while the migration transaction holds the source tables; the trigger installation and backfill have no write gap. Prior history starts unread. This migration should be measured against actual history volume before a production rollout.

One marker per current user and partner records the highest validated notice position read. Marking an older item cannot move the marker backward. A newer payment committed while mark-seen is in flight stays unread. A marker change increments only notice metadata, allowing other open sessions to refresh; it never changes financial totals. The UI's mark action includes that item and earlier items, as indicated by its helper title.

## API and composition

GET `/api/v1/partner/notifications` returns at most20 entries plus an opaque continuation cursor. POST `/api/v1/partner/notifications/seen` accepts the owned target notice. Both require maintained current membership, `view_statements` and exact permission revision. The server derives user identity; it rejects injected user IDs, foreign targets, invalid query/body fields and stale permission scopes. POST verifies the normalized configured origin and uses the existing bounded JSON reader. Responses are private/no-store.

Each list response reads page, counts and seen marker in one PostgreSQL statement. The cursor binds user, partner and permission revision. New entries append above existing positions, allowing stable older-page continuation without discarding new notices. Counts aggregate the indexed partner notice references, not earning rows; performance budgets and plans remain R01 work.

The native notification controller shares the scoped query provider with the rest of the application, loads after critical queries, uses existing notice revision invalidation, and operates on the account page as well. Scope changes/unmount cancel pending work; authorization failure removes private content. The presentational button remains reusable by isolated previews.

## Validation and operational limits

The full PostgreSQL suite passed142 cases across14 files; the unit/contract suite passed265 across33 files. Six notice integration cases cover complete historical reference reconciliation, source replay/reversal, transaction rollback, a deliberately overlapping payment/seen operation, per-user isolation, foreign/current permissions/CSRF, and24 notices continued20+4. Client/UI cases cover scope/abort, delayed loading, badge/read state, failures/retry and older pages. A final focused rerun covers configured origins with a trailing slash. Typecheck, build and production fixture exclusion are checked separately in the work packet.

Actual built Next over trusted loopback HTTPS was exercised using the owned synthetic account and PostgreSQL: three historical notices, marking the oldest reduced the badge to two, the notice opened the correct statement with25,420THB unpaid, and the two unread notices persisted on the account page. Marking the latest cleared the badge. Native staff suspension closed the private view and returned to login. DOM and screenshot evidence are in `.agent-work/20260909-native-notices/evidence/`.

Only the isolated local database was migrated. The prior identity binding was restored and the synthetic recipient suspended after the browser trial. No transfer, new financial record, upstream write, message send, production deployment or independent release acceptance is claimed. Source/finance/catalogue acquisition UI, external documents, remaining native acceptance/zoom, I01/I02 feeds, R01 and R02 remain tracked in project context.
