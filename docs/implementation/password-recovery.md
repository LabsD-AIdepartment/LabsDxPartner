# Verified password recovery and change

2026-09-09 · D-028 · Local server candidate under D-025 invitation-only access.

## User behavior

LabsD verifies a forgotten-password request against the existing contact record, selects the exact account and issues a 30-minute, single-use reset link. The recipient chooses the replacement password. Issuing or inspecting a link leaves the current password and sessions untouched. Issuing another link invalidates earlier pending links for that account. Repeating the same issuance command returns its receipt without redisclosing the bearer token.

Signed-in users change their password by supplying the current password and confirming a new one. A successful reset or change signs out every session, including the current one. The next step is ordinary username/password login. This does not create a second signup path or let staff view or assign passwords.

These are server services, not yet mounted public reset/activation forms or HTTP endpoints. The public UI transition and actual invitation-to-overview browser journey remain A03 work.

## Modules and authority

- `src/contracts/passwords.ts`: strict issue/reset/change inputs, shared password policy and confirmation validation.
- `src/server/modules/identity/passwords.ts`: fresh staff-session recheck, exact membership/contact/revision, verification evidence reference, short-lived token and immutable audit. The support path rejects staff accounts, including inactive staff grants. Staff account loss needs the separately controlled operator recovery path; self-service password change still applies.
- `src/server/modules/identity/credential-session.ts`: native username verification and native session creation serialize with existing identity authorization writers. All input is buffered before acquiring the writer lock, with an 8 KiB body limit and five-second read deadline. Origin rejection also precedes the lock. Native endpoint allowlist, CSRF, password verification, login rate limiter and cookie behavior remain in the maintained library.
- `db/migrations/0008_password_recovery.sql` and `db/schema/password-recovery.ts`: application-owned reset records, outside the maintained auth schema. No applied migration is edited. Keep historical `link`/`unlink` audit values alongside new credential actions.

The reset token pins partner, active membership revision/contact and issuing staff revision/capability. Consumption rechecks those facts and expiry. A contact reference and verification receipt record the staff decision; software does not independently prove the person contacted support. Delivery must use the established verified channel. There is no email delivery to internal `.invalid` metadata and no automatic invitation/reset send.

Hash new passwords outside the transaction using Better Auth's maintained crypto implementation. Replace the credential through its maintained internal adapter on the same PostgreSQL transaction as token consumption, session revocation, identity fences and audit. A failure at any step rolls back the whole mutation. Neither passwords, password hashes nor bearer tokens enter audit/replay records.

A successful login cannot leave behind an old-password session across a concurrent password mutation: if login commits first, reset revokes that session; if reset commits first, native verification rejects the old password. Return the native response only after transaction commit. No additional revision engine, session trigger, auth service or external network operation is introduced inside the credential lock.

## Local verification

Evidence lives in `.agent-work/20260909-password-recovery/evidence/`.

- Initial isolated migration failed because the draft omitted the historical `link` audit action. The transaction rolled back; ledger remained 0001–0007 and no reset table existed. Corrected the unapplied 0008 after inspecting 0005 and retained all old audit rows. `migrate-02.log` records successful isolated application with earlier checksum verification.
- Real PostgreSQL tests cover non-consuming inspection/issuance; secret-free audit; exact recipient/contact/fresh staff; staff-account exclusion; reissue/idempotency conflict; expiry and authority changes; wrong current password; mismatch; all-session revocation; final-audit rollback; simultaneous redemption; both ordered login/reset races with actual observed database lock waits; native origin/closed-signup/throttle behavior; oversized, slow and timed-out bodies before writer acquisition.
- `integration-02.log`: 79/79 tests across seven real PostgreSQL suites (16 recovery/session cases). `typecheck-03.log`: complete typecheck passed. `unit-01.log`: 192/192 existing unit/contract tests passed before the final login body guard; the final guard is covered by the subsequent PostgreSQL suite. `build-02.log`: final build and production fixture-exclusion check passed. This receipt does not assert production or independent acceptance.

## Remaining release work

Mount invocation through binding/origin/body/attempt-limited routes with generic errors and no token logging. Add themed invitation, credential login and reset/change forms; reconcile the old social account UI. Prove the owner-visible browser journey, actual operator provisioning, HTTPS/cookie and session/cache isolation. Explicit reset revocation UI is not implemented; reissue, password change and membership/staff/partner invalidation already invalidate outstanding links.

The shared identity writer lock is intentionally simple for a small partner portal. Measure login latency and contention in R01; it is not a financial read/import lock and no throughput claim is made. Production remains disabled by default. No real customer account conversion, upstream data mutation, send, deployment, merge or independent release review occurred.
