# Published earning corrections and private CSV

An updated source amount must not replace an issued statement or charge the same refund twice. An approved adjustment may now carry the original generation and canonical entitlement, a monotonically increasing reviewed source sequence and the new cumulative earning amount. Existing adjustment records without this proof remain blocked for original-history review.

The importer resolves originals from issued statements in the same partner, in an earlier closed period. It verifies the original agreement, content attribution, canonical authority/account and opaque line reference. Only the difference between the new amount and the latest **published** cumulative amount can be booked. One current draft per original avoids competing pending claims in different periods; a newer complete snapshot may supersede that draft in its own period. Publication rechecks the pinned history under the partner lock. The SQL history lookup is batched, with indexed original/revision lookups and batches of500 for immutable links.

For example, the issued earning is ฿12,800. A revised cumulative ฿11,800 books −฿1,000. A later cumulative ฿11,300 books only −฿500. Repeating the earlier revision or supplying −฿1,500 for the second delta is rejected. The original statement remains unchanged, and each later statement separately reports new earnings and signed adjustments. These are approved monetary corrections; the importer does not invent a revised sales base or recalculate an unsupported upstream refund rule.

Negative period obligations stay in the partner's signed outstanding balance, carried forward without copying debt into another opening balance. The settlement importer checks both each allocation and the signed partner-wide balance. It cannot ignore a credit and record payment of the larger positive statement balance. Credits are not automatically debited/refunded through a bank. Later reads must retain this signed aggregation rather than clamp each statement independently.

## Download boundary

`GET /api/v1/partner/statements/:statementId/export?partnerId=…&version=…` checks current native membership and `view_statements`, then the exact frozen generation. It emits a private, no-store UTF-8 CSV attachment with published period totals and included/excluded rows. Stable hashed line references preserve correction links without exporting raw canonical entitlement keys. Signed numeric amounts are formatted with integer arithmetic; untrusted text cells are quoted and spreadsheet formula prefixes are neutralized.

The response streams CSV chunks after a bounded authorized read. Exports above10,000 earning/excluded rows are rejected before row loading; the route does not silently truncate. This is the immutable earning statement export, not a current bank-payment report or manufactured tax document. External payment evidence/agreement delivery remains separate work.

The route defaults off via `LABSD_FINANCE_ENABLED=0` and also requires configured native identity/binding. The HTTP factory is tested against actual native sessions and the isolated PostgreSQL store. Public deployment/exposure was not enabled, and the frontend document adapter is not yet wired to this route. The env example now reflects invitation credentials rather than the superseded required social providers.

## Evidence

- Migration0013 adds immutable links to original earning rows;0001–0012 stay checksum-locked. Applied only to owned isolated PostgreSQL55487.
- Native integration cases prove cumulative deltas, out-of-order denial, unpublished/missing originals, conflicting pending claims, original statement preservation and credit-aware payment rejection.
- The export HTTP case proves current membership, exact version, cross-partner denial, revoked membership denial, private response headers, six exact amounts and exclusion of raw entitlement keys. A unit case covers Thai/quoted cells and formula prefixes.
- Work packet: `.agent-work/20260909-earning-corrections/`. Full prior receipts and validation logs are preserved. Query/load limits, production parity/HTTPS, source binding, real evidence delivery and full G04 frontend/API acceptance remain open.
