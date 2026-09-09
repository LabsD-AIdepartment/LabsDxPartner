# A02 — Membership and invitation service candidate

2026-09-09. Local service implementation and real isolated PostgreSQL verification. This is part of A02, not completion of the provider/linking/recovery/browser acceptance gates. No partner-facing financial route is enabled by this change.

## Boundaries and state authority

- `identity/resolve-principal.ts` obtains user/session identity from the maintained library's verified session, after the configured identity-namespace check. It does not accept a user ID from a request body. The five-minute fresh-session policy is shared with the auth configuration in `identity/policy.ts`.
- `partners/access.ts` owns current membership, explicit staff authorization, invitation claims, permission revisions and authorization audit. Its constructor takes the SQL pool and identity resolver; the partner domain does not depend on provider callbacks or email matching. Replacing an unsuccessful A01 auth adapter does not require replacing membership semantics.
- `portal_access` owns partners, memberships, staff grants, hashed invitations and append-only audit. `portal_identity` continues to own users/sessions/accounts. No new runtime/deployment unit or operational source database is introduced.
- Financial readers must run their scoped SQL inside `withPartner(headers, partnerId, capability, reader)`. It verifies the signed session, rechecks the current session in PostgreSQL, locks the active membership and partner, then invokes the reader. Every object join still needs the supplied `scope.partnerId`; this helper is not automatic row-level security. Do not stream a response or perform external side effects inside the reader callback before its transaction commits.
- `session(headers, selectedPartnerId?)` lists only the current user's active memberships. A foreign or suspended selection fails; no client partner ID grants authority. The permission revision contains both partner and membership revisions. Metadata never supplies staff rights.

## Invitation and staff behavior

| Operation | Actual behavior |
|---|---|
| Issue invite | Requires current explicit `manage_partners`, fresh authentication, active partner and explicit future expiry. Generates a random 32-byte token; stores only SHA-256. No external message is sent. |
| Retry issue | Same actor/key/content returns the existing invitation ID with `token: null`; it cannot regenerate the secret. If delivery was lost, revoke the unclaimed invitation and issue a new one with a new key. A changed request under the same key conflicts. |
| Claim | Uses the hashed token and atomic unclaimed/unrevoked/unexpired update. Creates a pending membership with no capabilities. Two concurrent accounts cannot both consume it. The token is not proof of the intended person's identity. |
| Activate | Fresh authorized staff identify both partner and user, supply expected permission revision, known-contact evidence reference and explicit capabilities. No email comparison or automatic activation. |
| Change/suspend | Optimistic revision prevents stale overwrites. Bumps the permission revision and deletes all affected user's sessions in the same transaction. Suspension can clear all capabilities; active membership needs at least one. |
| Revoke invite | Only an unclaimed invitation can be revoked through this operation. Revoking a link is not a substitute for suspending an existing membership. |
| Replay mutation | Returns the original command result after current actor authorization. It is historical, marked `replayed`; refetch session/current state. A replay result is not a new authorization grant. |

Staff grants are explicitly provisioned, not self-service. The service checks their active status/capability on every write. Known-contact reference is a staff assertion pointing to independently verified evidence; the service cannot prove the real-world verification by validating its string. Actual staff provisioning and verification procedure remain controlled staging requirements.

Authorization writes serialize on one dedicated PostgreSQL advisory transaction lock before taking actor/target row locks. This is the low-volume administration path, not partner reads, import workers or financial publication. It avoids opposing admin revocations acquiring session locks in reverse order. Session, membership and partner row locks keep an already authorized read consistent until commit; a revocation waits for that read, then subsequent reads fail. SQL lock timeout is five seconds; statement and idle transaction limits are ten seconds. These are defensive limits, not measured throughput/latency claims. R01 must measure contention under the actual load.

Audit records actor, action, target, partner, idempotency key/request hash, result and before/after membership evidence/capabilities/revisions, including the count of revoked sessions. Raw invite tokens and provider credentials are never stored in audit. Database triggers reject audit UPDATE/DELETE. Restricted production DB roles, authenticated HTTP routing, CSRF/rate-limits and sanitized route errors remain necessary; a table trigger is not protection from a database superuser.

## Migration and compatibility

New additive migrations `0002_partner_access.sql` and `0003_access_audit_details.sql` were applied only to the project-owned disposable `labsd_partner_test` cluster at port55487. Preflight confirmed its database name and data directory under this project's `.agent-work`. `0001_identity.sql` was checksum-verified without modification. The audit-details addition was made as0003 because0002 was already applied; older synthetic events retain empty details rather than invented historical facts.

Drizzle declarations are in `db/schema/partners.ts`; the append-only trigger remains migration-owned. There is no destructive migration or production migration runner in this batch. Reverting the additive service code can leave the new schema in place. Never modify an applied file to roll back or add missing facts.

The existing F07 mock `OpsCommand.membership` identifies only a partner, which is ambiguous when a partner has multiple users. It is deliberately **not wired** to this service. Before A03/server routing, change that UI/contract to show and submit the exact user/membership and expected revision. Do not infer the target from the first membership row. Existing visual layout and shared components are unchanged.

## Verification and remaining acceptance

- `tests/integration/access-control.test.ts`: **18 tests** through maintained-library signed session verification and actual PostgreSQL service transactions. Covers missing/forged/revoked sessions, hashed secrets and idempotency, pending access, concurrent claims, expiry/revocation, membership conflict rollback for active and suspended users, explicit/fresh staff rights, exact user activation, all-session invalidation, foreign scopes, denied capabilities, malformed/ambiguous commands, concurrent revisions, read-versus-suspension ordering, partner suspension/revision, append-only audit, required verification and zero-capability suspension.
- Combined A01/A02 database suite: **21/21** in two files. The concurrency test observes a real PostgreSQL lock wait, releases the read, then verifies committed suspension denies both old and newly created sessions. No timer-only assertion substitutes for observing the lock.
- Unit/contract suite: **190/190** in17files. Full typecheck and production build pass; production browser bundles contain no fixture markers. No browser UI was changed or newly accepted in this batch.
- Real DB testing found that Drizzle changes the shared postgres.js JSON serializers. Audit now binds explicit text and casts to JSONB in PostgreSQL. A regression case proves round-trip behavior on both a plain pool and the Drizzle-configured pool.
- Evidence: `.agent-work/20260909-a02-access/evidence/`. `access-first.log` is the failed discovery run; `integration-acceptance.log`, `tests-final.log`, `typecheck-after-caps.log` and `build.log` contain later checks. Initial migrations and repeat checksum verification have separate logs. Synthetic audited records remain in the disposable test database; tests do not disable the audit trigger for cleanup.

Actual Google/LINE/Apple success and namespace ownership are still A01 acceptance work. Explicit provider linking, atomic last-method unlink, recovery/replacement, HTTP session/invite endpoints with CSRF/rate limits, real staff provisioning and A03 frontend session wiring are not completed by this candidate. Existing production partner/staff page guards remain deny-only, and raw library link/unlink routes remain disabled. No independent implementation review, deployment, real money, contact verification or external provider success is claimed.
