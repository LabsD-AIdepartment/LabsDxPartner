# A02 — Transactional identity-method removal

Local implementation candidate, 2026-09-09. This completes the identity-internal unlink transaction, not the complete A02 linking/recovery journey or real provider acceptance. No partner-facing layout or behavior changes in this batch.

## Authority and execution path

`src/server/modules/identity/methods.ts` exposes an identity-internal list and unlink service. Runtime constructs it from the actual database pool, the maintained signed-session resolver with namespace binding, and `transactionIdentity(config)`. A caller cannot supply a user ID as authority.

List projects the authenticated user's account row IDs, provider names, method-set revision and `canUnlink`. It never returns provider subjects, email, OAuth credentials or session tokens. Supported methods are the three providers required by current IdentityConfig: Google, LINE and Apple. Disabled password/unknown-provider rows and empty provider subjects do not count as usable alternatives. This means configured capability, not proof that an external provider is currently available.

Unlink requires an exact account row ID, the displayed method-set revision and an idempotency key. It resolves the maintained signed session, then opens one PostgreSQL transaction. The A02 authorization-writer advisory lock `(981705,2)` precedes actor/session row locks, matching membership revocation. The transaction rechecks user/session existence, expiry and a creation time within the preceding five minutes; a future timestamp does not count as fresh authentication.

The selected method must belong to that user, the method set must still match, and another configured method must remain. The wrapper invokes the **native Better Auth unlink API** on an adapter bound to this same database transaction. It verifies the resulting method set, revokes all existing sessions of the owner, and appends an audit receipt before committing. No remote provider request or external token revocation is performed in the transaction. The receipt requires reauthentication; a deleted session cannot use a retry to regain access.

The maintained library's own count-and-delete check is retained, but the wrapper adds serialization and usable-provider filtering. Calling the raw HTTP unlink route would omit these application guarantees; it remains disabled.

## Transaction adapter

The pinned Drizzle postgres-js constructor expects a pool with `.options`; a postgres.js TransactionSql is not that object. `transaction-auth.ts` uses Drizzle's supported PostgreSQL query-callback driver to execute generated SQL on the already-open TransactionSql. There is no additional server, pool, remote proxy or provider call. Array/object result modes are preserved for maintained Drizzle row mapping. Its internal nested-transaction option is false because the application transaction already owns commit/rollback; failures propagate to that transaction.

No cast disguises a transaction as a pool. The integration fault test observes that the native API really deleted the selected row inside the transaction, forces a PostgreSQL error, and then verifies that the row and sessions are restored outside it.

## Audit, compatibility and replay

Migration `0004_identity_method_audit.sql` adds `portal_identity.method_audit`; existing applied migrations and auth tables are unchanged. The record contains actor/target IDs, action, idempotency key, request digest, before/after internal method IDs and provider names, revisions, revoked-session count and receipt. No subject, email, credential or session token is copied into history. UPDATE and DELETE are rejected by an append-only trigger. Production database-role privileges, retention and privileged DDL/TRUNCATE controls remain release work; a DB owner is not constrained by this application service.

After fresh reauthentication, replaying the exact command returns its historical receipt without deleting anything or revoking the new session. Reusing the key for a different command fails. Consumers must refetch current methods; a historical receipt does not assert current method ownership.

The migration is additive. Code rollback leaves the audit table/history in place; it does not restore removed identities or deleted sessions. Actual recovery must use the verified recovery process. The new migration was applied only to the existing project-owned disposable PostgreSQL cluster on port 55487, never managed port 5432 or production.

## Author verification

Evidence directory: `.agent-work/20260909-a02-unlink/evidence/`.

- `integration-acceptance.log`: **34/34 tests in three files**, including 13 new cases using the real maintained unlink API and isolated PostgreSQL.
- New cases: safe owned projection; native deletion plus all owner-session revocation and unaffected other user; unsupported/password/empty-subject alternatives; foreign/missing IDs; stale displayed revision; stale/future authentication; missing/forged/expired/revoked sessions; revocation between proof and transaction; two concurrent unlinks with both session proofs resolved before either starts; fresh-auth idempotent replay/key conflict; rollback after actual deletion; audit mutation rejection and raw HTTP route denial; strict command validation.
- `unit.log`: **190/190 unit and contract tests in 17 files**. Full typecheck and production build/fixture-exclusion pass. No new browser or external OAuth success is claimed; the UI is unchanged.
- `integration-first.log`: 13/13 initially passed. The first combined rerun failed because the deliberately empty subject is globally unique and its synthetic fixture remained in the disposable database. The fixture now cleans only its exact malformed synthetic residue and removes its own row in `finally`; the full combined acceptance run passes. Audit history is retained and no append-only guard is disabled.

## Required continuation before public use

1. Finish explicit linking: fresh existing identity proof, independently verified provider callback, server-only bound intent, atomic uniqueness and single consumption. Matching email is never proof. Missing-email LINE explicit-link behavior must pass against the pinned library.
2. Fence in-flight OAuth callbacks/session issuance against unlink/recovery. Deleting sessions that exist now does **not** prove that an older callback cannot create a session afterward. That remains an explicit gate before public unlink wiring.
3. Implement controlled recovery and replacement with verified staff authority, identity/session revocation and immutable audit.
4. Connect a guarded maintained-auth host path with CSRF/rate limiting and A03 account UI. Current F07 provider-only action must become exact method selection with revision and idempotency, because a user may have multiple rows for one provider. Native `/link-social` and `/unlink-account` HTTP paths remain disabled; the internal service is not a new unprotected API.
5. Prove actual Google/LINE/Apple and browser callbacks on the registered HTTPS environment, independent implementation review and owner acceptance. Synthetic fixture signing does not satisfy this gate.

The full goal and A02 remain open. This is concrete implementation progress toward that scope, not a redefinition of completion or authorization for production exposure.
