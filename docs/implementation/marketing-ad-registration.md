# Marketing Ad ID registration

Implemented 2026-09-10 as D058, step 1 of the automatic integration plan.

## Current deliverable

Development route `/ops-preview/ads` adds the Marketing workflow to the existing staff shell. Select a partner and clip; its agreement is inherited. Select Facebook, Shopee, Lazada or TikTok and an authorized account, paste an Ad ID, inspect the resolved ad and connect it once. A sole account is selected automatically. The list tracks first fetch, progress, success or connection problems without a recurring approval step.

This is a working synthetic journey, not a live integration. Records and lookup receipts exist only in memory and reset on reload. Automatic status transitions simulate acquisition; no provider metrics, partner projection or payable commission is written. The preview banner states these limits. Production builds exclude the synthetic implementation.

## Module ownership

- `src/contracts/ad-registration.ts`: scoped targets, connections, opaque IDs, resolved previews and association statuses, validated with Zod.
- `src/features/marketing-ads/model.ts`: shared read/resolve/save transport boundary, current scope checks and response consistency checks.
- `src/features/marketing-ads/AdRegistrationConsole.tsx`: reusable registration and status UI using shared typography, fields, cards, buttons, covers and staff navigation.
- `dev/ad-registration-transport.ts`: synthetic account authority, short-lived draft-bound receipts, association uniqueness and simulated fetch lifecycle.
- `dev/AdRegistrationPreview.tsx`: development-only scenarios. `UnavailablePreview.tsx` is the production alias target.

Marketing owns the association; the source owns ad performance; finance retains commission and payment authority. The existing operations transport and financial services are not broadened into an ad source. A future native transport must derive identity and current authorization from the server session, rather than trust the client scope.

## Accuracy and failure behavior

IDs remain strings, including leading zeros and values beyond JavaScript's safe integer range. Associations are unique by platform, account, object type and external ID. Saving the same mapping is idempotent; mapping the same ad to a different clip, partner or agreement is rejected. A different account can legitimately contain the same external ID.

The synthetic authority rechecks access, allowed target/account, exact lookup receipt and expiry on save. Changing a form field cancels the prior lookup and discards its preview. Unknown context, denied access, missing ads, unsupported grain and ambiguous creatives produce explicit errors. Unknown source timestamps remain absent, not invented freshness. Fetch-success time and source-data cutoff are displayed separately.

The list polls every two seconds while visible in the preview. This is UI polling of simulated status, not a production platform refresh SLA or a durable scheduler.

## Verification

42 focused tests passed: 20 registration model/UI cases and 22 existing account/operations cases. Typecheck and production build passed, including the development-fixture browser-bundle exclusion check. Browser proof covers lookup, exact long ID, save and automatic transition to ready at 1162 × 2314; Day/Dark have no document overflow and form typography is 16px. A full mobile/200% zoom acceptance matrix remains open.

Evidence: `.agent-work/20260910-marketing-ad-registration/evidence/` and full task receipt alongside it. No native database, actual account grant, live provider response, performance or release acceptance is claimed.

## Next implementation

1. Discover the existing authorized system APIs and verify source report grain, starting with Facebook as the proposed first adapter. Confirm Shopee, Lazada and TikTok ad/report capabilities independently; the selector is not proof of live access.
2. Add native scoped registration endpoints, durable association/receipt/job storage and server authorization. Preserve the shared UI/transport boundary.
3. Implement bounded backfill, retries, leases, lookback and restart recovery, then publish supported metrics into the partner read model with explicit source cutoff.
4. Verify equivalent source and portal values using matching account, attribution, timezone and date range. Commission and payment automation require their own authoritative source contracts.

No company Marketplace connector, recurring manual metric approval or duplicated financial approval is introduced.
