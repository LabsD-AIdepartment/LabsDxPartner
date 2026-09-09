# Shared member access and practical password setup

D034–D035, 2026-09-09. Local implementation; no production release or real provisioning.

Member status, verified contact reference, capabilities and revision now share MembershipSummary and MemberAccessForm across operations and staff access. CapabilityPicker owns the labels and checkbox presentation. An active member can have permissions edited without suspension/reactivation. Confirmation binds partner, recipient and expected revision. Historical pending accounts have an explicit legacy explanation; new invitations activate the agreed recipient directly after account setup.

POST /api/access/memberships/change delegates to the existing native partner access service. Fresh staff authorization, exact member/revision checks, idempotency, atomic audit and old-session revocation remain server responsibilities. The legacy date-only invite command was removed from active operations; the retained legacy service/schema is not a new invitation entry.

The owner rejected the twelve-character password minimum and requested a strength bar. Shared passwordPolicy now requires 8–128 characters, with no uppercase, digit or symbol requirement. Setup/reset/change contracts, input constraints and native auth configuration use the same policy. Passwords are not trimmed. Existing account passwords do not require conversion or reset.

PasswordField provides an opt-in strength meter for new passwords. It estimates length and obvious repeated/common patterns locally, displays an approximate level, and never changes validation or submits the password elsewhere. It is advisory, not an entropy calculation or breached-password lookup. Login, current-password and confirmation fields do not duplicate the meter. Shared theme tokens support both Day and Dark.

Validation: 220 unit/contract tests; 92 isolated PostgreSQL integration tests, including 8-character registration/change/reset/native sign-in, rejection below 8, exact-member authorization, stale revision denial, idempotent replay and old-session invalidation. Typecheck and production build/fixture-exclusion checked. Browser: 8-character mock registration reached the original Overview; advisory weak-password meter rendered without a submit lock. No native HTTPS browser or release acceptance is claimed.

Remaining: staff mock console is not yet joined to the recipient mock lifecycle; operations preview still links to the guarded real /ops/access entry. Financial persisted read models/imports and release work remain open. This receipt does not mark F07 or the overall plan complete.
