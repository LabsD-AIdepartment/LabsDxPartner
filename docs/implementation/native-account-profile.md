# Native partner account metadata

The authenticated Account page now uses the shared account, agreement, support and password components previously available only in the frontend example. Identity comes from the signed-in account; agreement metadata comes from a separate published partner profile. Historic revenue rows and marketing labels are never treated as the current agreement.

## Ownership and interfaces

- `GET /api/v1/partner/account` requires an active membership for the requested partner and its exact permission revision. Any existing partner capability can permit account access, including a content-only member. Staff access alone does not grant partner access.
- The reader rechecks membership in the data transaction after selecting a permitted capability. It reads only the authenticated user's identity and the selected partner's profile. Missing profile means no published agreement, not a fabricated default. Invalid stored metadata is unavailable.
- `AccountProfileRepository.load(partnerId, reviewId)` supplies independently reviewed server-owned metadata. `createAccountProfilePublisher` validates its digest, partner binding and expected profile revision, and requires a freshly authenticated `manage_partners` actor. Commands are audited and idempotent; concurrent writers cannot overwrite an unseen revision.
- Migration `0027_partner_account_profiles.sql` adds the profile projection. It does not alter earnings, agreements embedded in historic statements, calculations or payment records. Old application code can ignore the additive table. Code rollback leaves the table intact.
- Account permission revisions are opaque identifiers, matching the native composite `pN:mN` revision and existing preview identifiers. Response scope is still validated exactly by `loadAccount`.
- Password changes remain in the identity service. The password form occupies one stable render position so loading or retrying metadata cannot clear typed credentials. It remains available when account metadata is unavailable.

## Verification

The isolated PostgreSQL migration and five integration cases passed: missing/published metadata, content-only access, foreign/anonymous/suspended/stale access, malformed stored data, publisher authorization, source mismatch, stale writes, replay and concurrent publication. Thirty-one unit/component cases passed, including a regression asserting that metadata completion preserves both the password input DOM node and its typed value. Typecheck and optimized build passed with development-fixture exclusion.

A local synthetic profile was published through the actual publisher. Native `/account` displayed its username, terms summary, effective dates, agreement reference, calculation/rounding description, support guidance and one password form. This is local mock verification, not live agreement approval.

## Remaining integration

The durable publisher is a service contract. A production source adapter and the staff workflow for reviewing/publishing these profiles are still needed. The local script is a test harness, not the operator interface. Do not populate the production profile from revenue rates or assume the synthetic terms are Labs D's agreed rates. Support links stay absent until a reviewed destination is supplied.

The broader P04 browser-save/zoom checks, operational readiness, load and real-provider acceptance remain separate. No deployment or production migration was performed.
