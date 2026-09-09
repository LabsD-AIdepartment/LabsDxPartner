# Preapproved invitation activation — local service candidate

2026-09-09 · D-025/D-027 · Backend continuation of [invitation-only access](../design/invitation-only-access.md).

## Implemented behavior

Staff issue an activation invitation with an existing active partner, recipient name, verified contact reference and explicit nonempty capabilities. Fresh authenticated staff authority is checked against the database. Expiry is bounded to seven days. Reissuing for the same partner/contact revokes older unused links in the same transaction and records their IDs; idempotent replay never returns the bearer token again.

Inspection is read-only and returns only partner name, recipient name and expiry. It never consumes the link. Legacy invitations lacking preapproval cannot create credential accounts, and the old pending-claim service cannot consume new activation links.

Registration validates the submitted username/password confirmation and rechecks the invitation under the existing authorization-writer lock. The maintained library hashes the password before write locks; identity-owned credential creation uses its internal adapter on the caller's Postgres transaction. User/account creation, active membership, invitation consumption and audit commit together. Rights, display name and contact evidence come from the invitation, never registration input. Invalid input, taken username, revocation, expiry or an audit failure leave no partial activation.

The service returns committed identifiers, not hand-built session cookies. Frontend wiring will immediately call the maintained username login with the entered credentials. If that subsequent request fails, the account remains created and the user can retry ordinary login. No session is returned before activation commits.

Existing users accept an invitation with a fresh verified session. An existing membership, including a suspended one, is rejected rather than merged or reactivated. Server scope checks continue to deny other partners. Passwords, password hashes and invitation bearer tokens are absent from audit details/results.

## Storage and compatibility

Migration0007 adds nullable recipient/contact/capability fields and a complete-preapproval constraint. Existing invitations/identities are preserved. Applied0001–0006 were checksum-verified; only the project-owned isolated55487 database was migrated. Drizzle projections were extended; no deployed database or provider configuration changed.

Shared access schemas and a structural principal interface are reused across the maintained credential adapter and existing membership services. No additional service, deployment unit or database pool was introduced for credential creation.

## Evidence

Logs under `.agent-work/20260909-invite-activation/evidence/`:

- `integration-02.log`:63/63 PostgreSQL tests across six files, including eight invitation tests and existing credential/access regressions.
- `activation-03.log`: focused eight-case rerun after strengthening suspended-member and authenticated-nonstaff assertions.
- `unit-01.log`:192/192 unit/contract tests.
- `typecheck-03.log`, `build-01.log`: both passed; production browser fixture exclusion also passed.
- `migrate.log`: isolated target and immutable earlier migrations verified by the restricted runner.

The invitation tests create synthetic staff credentials through the maintained adapter, log in through native HTTP, issue and redeem invitations in real Postgres, then verify native login and partner-scoped access. Concurrent redemptions produce one membership. A partner-scoped test trigger forces the final audit insert to fail and verifies user/membership/claim rollback; the trigger is removed in `finally`. Startup refuses stale trigger-function residue after an interrupted run. Append-only audit controls are never disabled. Test records with audit references remain in the disposable cluster.

## Remaining release work

No public activation HTTP endpoint or invitation UI was mounted in this batch. Before mounting: enforce browser origin, body-size/rate limits, safe error mapping, no token logging/referrer/third-party leakage, deployment binding, and the complete registration→native-login browser path. Runtime public signup remains disabled. Native password mutation stays closed until verified reset/change services and concurrent-login revocation are implemented.

Reconcile the preserved D-023 account UI to credentials, then wire staff invitation forms and exact member selection. Existing provider-specific screens are not accepted for D-025. No actual invitation was sent, real partner activated, deployment performed or independent review claimed. The approved partner design and financial scope are unchanged.
