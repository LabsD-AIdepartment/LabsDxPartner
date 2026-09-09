# A02 — Guarded native OAuth callback candidate

2026-09-09 · Local author verification after the whole-system practicality review. A02 and actual three-provider acceptance remain incomplete.

## Behavior

The maintained Better Auth callback continues to own provider code exchange, profile/subject extraction, state/browser validation and cookies. The identity module owns a single post-provider transaction joining native account/session changes with application revocation checks and link audit. No new auth service or protocol was created.

At initiation, a short-lived server-owned intent records the configured provider and current identity mutation revision. Explicit linking also binds the current fresh user/session. Client additionalData cannot choose the server intent. On verified provider return, a bounded transaction consumes the intent, rechecks ownership/freshness and revocation floors, and routes native database writes through the transaction-bound Drizzle adapter. The host sends a successful callback response only after commit. Audit/commit failure rolls back account changes and discards successful response cookies.

Identity revocation now advances per-user and, when unlinking, per-subject cutoffs before deleting sessions. A callback started before that revocation cannot recreate the revoked login. A different user's revocation does not invalidate everyone. Membership remains a separate authorization check; a new social login does not grant partner membership.

Native link is available only through the guarded configured identity runtime. Raw HTTP unlink remains disabled because the atomic unlink service and its exact-method frontend/HTTP contract are not yet wired. `LABSD_IDENTITY_ENABLED` remains off by default. No real partner routes were opened by this batch.

## Repair and verification

The earlier `invalid_code` failure was a test lifecycle defect: integration configuration uses `restoreMocks: true`, which undid provider spies installed in beforeAll. Install them in beforeEach; reject and assert zero fetch calls so synthetic credentials cannot accidentally reach a provider. Limiter state is reset only in the validated disposable test database, including cleanup after the explicit429 test so subsequent files do not inherit it. Runtime rate limiting remains enabled.

Latest evidence under `.agent-work/20260909-a02-callback-repair/evidence/`:

- `integration-05.log`: **48/48** tests across four files, including14 callback cases and34 existing identity/access cases.
- `unit.log`: **190/190** unit/contract tests across17 files.
- `typecheck-02.log`: full typecheck passes after route type generation.
- `build.log`: production build and development-fixture exclusion pass; later changes were test-only.
- `migration-preserved.txt`: migration0005 exactly matches the previously applied snapshot. Existing0001–0004 and0005 SQL were not edited or reapplied this batch; TypeScript projections added outside the maintained auth schema.

Callback evidence covers missing-email LINE linking, native signup without membership, provider-bound sign-in without implicit email merging, foreign subject rejection, fresh-session/expiry/intent/browser checks, returning login after unlink or membership-style revocation, another user's unaffected login, no SQL transaction while provider result is pending, concurrent same-state callbacks yielding one identity/session, and final audit failure after native linking rolling everything back. Native Apple form POST → browser-bound GET is also exercised through the Next handler.

External provider results in these tests are deliberately synthetic. Native token cryptography, registered HTTPS providers, actual Safari/Chrome cookie behavior and Apple secret renewal are **not** accepted by this evidence. No new browser/UI acceptance or independent review was performed.

## Remaining work and practical scope

- Prove actual Google/LINE/Apple login using registered portal credentials/HTTPS; no reuse of another project's identities or fake demo fallback.
- Finish verified recovery/replacement, maintained HTTP mutations and exact method/membership frontend contracts. Do not confuse this callback candidate with completed A02/A03.
- Specify and implement bounded expired-intent housekeeping before exposure; never indiscriminately delete persistent revocation cutoffs or audit history.
- Preserve short transaction timeouts and pool budgets; reassess this adapter boundary whenever the pinned library's write lifecycle changes. These tests are a compatibility boundary, not a justification to grow a general auth framework.
- Independent review, release artifact, production migration/exposure and owner acceptance remain separate gates. Rollback disables exposure and uses compatible code while retaining additive schema/history; no applied migration edits or history deletion.

Source files: `identity/{oauth-boundary,revocation,http,auth,runtime,transaction-auth,methods}.ts`, `partners/access.ts`, the native host route, `db/schema/identity.ts`, immutable migration0005 and `tests/integration/oauth-boundary.test.ts`. Full pre-repair sources and scoped boundary decision are retained in the project work area.
