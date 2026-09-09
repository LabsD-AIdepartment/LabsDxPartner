# Partner change metadata and automatic refresh

The native partner application now checks small scoped change metadata every30–35seconds while visible and online. A committed payment refreshes Transactions automatically; it does not recalculate or increment displayed balances in the browser. Hidden/offline tabs pause, resume checks immediately, transient failures back off, and permission loss clears private queries and rechecks the session.

## Ownership and storage

`portal_meta.partner_changes` (additive migration0015) stores four independent decimal counters per partner. The importer advances earnings when a reconciled candidate commits; statement publication advances earnings and settlements; payment/reversal advances settlements. Each update uses the same PostgreSQL transaction as its owning data write. Replays and rolled-back writes do not advance metadata. Candidate signals never authorize access to unpublished rows. Metrics/notices storage is reserved for their later owning writers; those product services are not implemented by this change.

The GET `/api/v1/partner/changes` route accepts only partnerId, permissionRevision and a PartnerCapability. It verifies the maintained session and current active membership/capability, then requires the exact permission revision before one primary-key metadata lookup. It sends no monetary rows, user identifiers or upstream source details and is private/no-store. Missing metadata returns a zero-change baseline and unknown source coverage, not zero money. PublishedAt is metadata publication time; it is not source data-through. Sources remain empty until owner-specific source freshness is implemented.

The native ChangeWatcher first reconciles mounted queries once to close a first-query/first-poll race, then invalidates only groups whose counters advance. Old/in-flight responses cannot overwrite a newer baseline. Existing scoped cache keys, transaction list/detail contracts, layouts and fixtures remain separate.

## Verification

-235unit tests and23affected PostgreSQL integration tests pass; typecheck, build, fixture exclusion and diff checks pass.
-Actual native identity→membership→HTTP test exercises blank metadata, import, statement publication, payment replay, transaction rollback, concurrent independent counters, strict duplicate/unknown inputs, foreign partner/capability/revision denial and suspended membership.
-Native trusted loopback HTTPS4443→production Next4188 using the isolated55487database: Transactions showed฿25,520, an authorized synthetic payment10000satang committed, and the same open page automatically showed฿25,420 without navigation/reload/refresh. DOM snapshots and payment receipt are retained in `.agent-work/20260909-change-metadata/evidence/`.
-A native staff POST then suspended that synthetic member (HTTP200). The open partner page automatically returned to login and no longer rendered the balance. Both the existing session check and the new change watcher enforce revocation; this browser observation does not attribute the redirect to only one of them.
-The first broad unit run failed an old test asserting only session requests existed. Updated it to validate the exact new scoped metadata request and added revoked-metadata→session-recheck coverage; full rerun passed.

## Compatibility and remaining scope

Migration0015 only adds/backfills metadata; it never changes financial amounts or applied migrations. Keep finance disabled until every owning writer runs companion code. Old binaries can use the additive schema but must not coexist with enabled new polling: their writes do not update these new counters. Code rollback leaves metadata in place; before re-enabling polling, repair/backfill counters from owner records. Production rollout and independent release acceptance remain separate.

This completes the native change-signal slice of G04, not the full phase. Overview/content/earnings read APIs, shared generation/freshness, partner notifications and seen state, source and finance ops acquisition, external documents, performance/recovery and release evidence remain tracked. Actual browser file delivery and native200%zoom remain unverified; no production exposure or external transfer occurred.
