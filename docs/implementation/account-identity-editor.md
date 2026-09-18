# Account identity and payout cards

The account page shows name, current login username and a password mask in one card. Its right-aligned edit button opens a dialog for name/username and the existing password-change form. The payout card shows the current beneficiary and opens the existing scoped editor without navigating away. Legacy payout URLs remain supported.

## Native credential authority

The owner authorized actual self-service name/username changes on 2026-09-18. This supersedes the earlier immutable-username product restriction for this controlled path only. `POST /api/access/account/identity` requires the maintained signed session, same origin, current password, expected user/name/username and active partner membership/permission revision. The native Better Auth public update-user route remains blocked and its username plugin remains immutable for other paths. The synthetic account-settings request-intent transport has no native write authority.

The application writer acquires the existing A02 credential lock before row locks, uses the maintained internal adapter in the same transaction, preserves the password hash and identity email, enforces the native unique username index, invalidates pending reset links and revokes all sessions. Success requires a fresh login with the new username. The append-only audit stores change flags and revoked session IDs; it never stores the password or form payload. Failed writes roll back together. A transport failure does not prove the operation failed: logging in with the chosen username is the recovery path if the session was revoked.

Migration `0030_account_identity_audit.sql` expands the audit action constraint only. Applied migrations remain untouched. Rolling back application code does not revert usernames chosen by users; no down migration is needed. The migration was applied only to the verified project-owned local test cluster, preserving the identity binding.

## Scope and validation

The payout card reuses the existing development beneficiary runtime, catalog, revision guards, uncertain-save handling and historical-recipient separation. It remains a synthetic demo; no bank provider or real transfer path was added. Native contacts remain independently stored, unverified, with no SMS/email sending enabled.

Native tests use random synthetic actors and maintained password/session verification. They cover persistence, old/new login, session/reset revocation, collisions, stale forms, scope/origin boundaries and concurrent saves. UI tests cover popup composition, command scope, errors and late completion after unmount. Browser checks cover both themes at 280, 375, 800 and 1957 pixels. No actual user's login credentials or bank information were changed during verification.
