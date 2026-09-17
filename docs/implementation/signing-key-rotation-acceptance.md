# Isolated signing-key rotation acceptance — D124

Completed locally on 11 September 2026 using the existing D120 built web application (`V_OKbpG5OhG1keKWUBTuD`), real native HTTP handlers over trusted loopback HTTPS, and a newly generated empty database. This is recovery-procedure acceptance, not a production key rotation or a product-code change.

## What ran

The harness verified the project-owned PostgreSQL cluster, created a unique disposable database, and applied all 27 frozen, checksum-matched migrations into that empty target. It copied no account or financial rows from the existing application database. Two synthetic members were seeded, each belonging to a different partner with only `view_content`.

Three sequential Next processes used the same built application and isolated database: first a generated old signing key, then a different generated key after stopping the first process, then the old synthetic key again solely to demonstrate the rollback risk. All used the same isolated HTTPS origin. Keys, passwords and cookies stayed in harness memory; child environments received keys at launch. No existing application signing secret was read or changed.

## Observed results

- Readiness returned 200 under both keys with the same namespace binding and migration ledger.
- Both original logins returned the intended user, partner and exact capability.
- After the new-key restart, both old cookies resolved to no authenticated session; the protected partner-session endpoint returned **401**.
- Both members could log in again with their unchanged passwords. User identity, membership and capability remained correct; selecting the other partner returned **403** for each member.
- Signing-key replacement did **not** remove the old session rows from the database.
- Reintroducing the old synthetic key made the retained old session usable again. The new-key cookie was rejected under that reverted key. This verifies the runbook warning: changing a signing key and transactionally revoking sessions are different operations.
- All three temporary web processes stopped, the TLS proxy closed and the generated database was removed. The existing application's namespace binding was unchanged. Its separate service monitor remained healthy after the drill.

The completed run passed **34 harness assertions**, including isolation, functional behavior, cleanup and output checks. This count is not 34 unit tests. The harness was independently reviewed before execution; no application rebuild or broad test-suite rerun was needed for this documentation-only acceptance.

## Evidence and operational limits

The private local record is `.agent-work/20260911-signing-rotation/`. Run receipt `drill-873b2afd-b070-421e-a505-49670ac7dd59.json` records process IDs/exits, HTTP statuses and assertion outcomes. Raw child output was bounded in memory and never saved; the receipt contains byte counts, truncation and secret-detection booleans only. No secret, password or cookie values are included in retained evidence. Independent review corrected unconditional cleanup/output handling before execution; this successful drill does not claim a separate forced-failure cleanup test.

Remaining before an actual rotation: the target secret store and version references, consistent rollout to every identity-using process, operator recovery access, an agreed sign-in interruption window and target-specific verification. Simultaneous mixed-key instances, multiple devices, production secret delivery and global session invalidation were not exercised. There is still no reviewed global-revocation admin command; use existing per-account revocation paths for their declared scope. Do not restore a compromised key merely to make old sessions work again.

See [identity/session recovery](../runbooks/identity.md) for the operational procedure and [remaining work](remaining-work-audit.md) for the broader release scope.
