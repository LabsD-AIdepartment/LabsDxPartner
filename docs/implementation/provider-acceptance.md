> Historical receipt — superseded for this release by invitation-only username/password access (D-025). Google/LINE/Apple setup, callbacks and Apple renewal below are not remaining tasks. Current implementation and acceptance gaps: [D116 audit](remaining-work-audit.md); actual local credential journey: [native account acceptance](native-account-acceptance.md). Preserve this record as historical evidence only.

# A01 — Identity adapter preparation and provider acceptance

2026-09-09. **In progress, not accepted for real sign-in.** F08 frontend checkpoint is `09b7ff929fa703d3db3e76ad755d3225af30d2b8`. The new auth surface remains off by default. Partner/staff guards still deny access until A02/A03; having an auth cookie will not reveal fixture finance.

## Implemented local boundary

- Better Auth pinned to1.7.3, Drizzle PostgreSQL adapter with transactions, separate `portal_identity` schema, bounded10-connection runtime pool. Vitest changed from5.0.0 to4.1.11 because Better Auth's declared optional peer range ends at4; npm resolves without force/legacy-peer-deps. Existing147 tests passed after this change.
- `provider-config.ts` requires explicit HTTPS origin, secret references and all three provider configurations. Configuration failures expose only field names. The runtime requires a provisioned namespace digest row before invoking auth: switching provider clients/Apple Team cannot silently reuse existing subjects. Rotating secrets does not change the public namespace digest. No binding is automatically created from the environment.
- Maintained Next handler receives the original Request. Responses preserve cookies/body/redirect and use private/no-store and no-referrer. Unconfigured/off/unavailable identity returns503 without issuing cookies. No password or direct ID-token sign-in, email recovery, token retrieval, raw unlink/link or profile mutation is exposed in this batch. A02 owns fresh-proof and atomic linking/recovery workflows before those paths open.
- Database sessions proposed30 days with24-hour refresh and5-minute freshness. Cookie cache off, implicit linking off, explicit different-email linking configured, last-method removal disallowed, provider tokens encrypted. Origin/CSRF checks explicitly enabled even in tests; telemetry and raw library logging disabled. R01 must supply sanitized operation/error counters rather than dumping provider payloads.
- LINE requests only `openid profile`, uses maintained S256 PKCE and a deterministic namespace+subject `.invalid` auth-storage email. Google/Apple profile metadata never overrides provider subject. Apple relay/name omission/missing email map safely; no email field is contact verification or membership proof.
- Native Apple POST callback redirects to its own GET callback; signed state cookie remains Secure/HttpOnly/Lax and state persists in the DB. No blanket SameSite/CSRF bypass. This transport was exercised with synthetic cancellation only; actual Safari/Chrome provider behavior remains unproven. Logs/proxies must omit auth query strings because the native POST→GET redirect carries authorization parameters.

## Current evidence

Work area `.agent-work/20260909-a01/evidence/`:

| Evidence | Result and limit |
|---|---|
| `install.log`, `install-compatible.log` | First install refused Vitest5 peer conflict; compatible pinned install succeeds, npm audit reports0 vulnerabilities at that run |
| `tests-route.log` |155/155 tests in16files; includes8 new identity configuration/profile/native-adapter/off-route tests |
| `integration-final.log` |3/3 real isolated PostgreSQL tests: persisted state/wrong browser/sequential cancellation replay; signed fixture session DB lookup/forged cookie/revocation; concurrent duplicate provider-subject insertion |
| `e2e-regression.log`, `production-http.json` |28/28 browser regression cases;9/9 production HTTP checks on pre-format build (protected redirects, preview404, auth503 with flag off). Final source formatting is behavior-preserving; final build also passes |
| `migrate-first.log`, `migrate-repeat.log` |0001 applied only to isolated local cluster; repeat verifies checksum and skips. Applied SQL must not be edited |
| `typecheck-third.log`, `build-final.log` |Full-program typecheck and production build/fixture exclusion pass |

The isolated cluster is inside `.agent-work/20260909-a01/postgres/data`, loopback55487, database `labsd_partner_test`, test role `labsd_test`, no upstream data. The owned cluster was stopped after checks; existing Postgres5432 was untouched. `db:migrate:test` and `test:integration` require `LABSD_TEST_DATABASE_URL`; the helper refuses other host/port/database or a data directory outside project `.agent-work`. This is a test runner, not a production migration command. Tests seed synthetic principals/signed cookies as setup; those are not evidence of Google/LINE/Apple authentication. Sequential state replay is tested; concurrent successful OAuth exchanges remain part of the provider acceptance matrix.

## Readiness inventory and remaining proof

Inventory checked portal-root env filenames and current process key presence only: no env files and no configured provider/auth/DB keys there. Provider consoles, vault entries and other application credential stores have **not** been inventoried; this does not claim the owner lacks existing credentials. The owner was asked for references and a registered HTTPS hostname, never secret values. `.env.example` documents runtime names; no provider registration or domain change was made.

| Provider | Needed reference and actual proof |
|---|---|
| Google | Client/consent registration, exact `/api/auth/callback/google` HTTPS URL, controlled-account first/repeat/cancel/error; verified subject/audience/issuer/nonce/token handling |
| LINE | Login provider/channel references, same callback for `line`, no email permission dependency, real missing-email login and S256 exchange; namespace must not be borrowed from Messaging API assumptions |
| Apple | Team/App ID/Services ID/Key ID references, registered domain and `/api/auth/callback/apple`, runtime ES256 client-secret JWT; first/repeat/relay/missing-name, form POST/browser state in Safari and Chrome, replay/wrong-state/expired-token failures |

Apple secret renewal owner, key reference, actual expiry and next renewal date are unassigned. Planned operational policy is30-day JWT renewal with14/7-day alerts; no scheduler or renewal success is claimed. Runtime currently consumes a vault-injected `APPLE_CLIENT_SECRET`; renewal and expired-secret failure need completion before A01 acceptance. If the maintained adapter cannot pass actual callback/missing-email tests without unsafe custom OAuth, switch only identity to the planned fallback before A02.

A02 pending: hashed single-use invites and known-contact activation; current membership/capability resolution; atomic explicit linking/last-method protection/recovery; fresh staff auth and revocation. A03 pending: real login/account UI bindings and change-watermark bootstrap before financial query observers. Production exposure remains R02.

## Primary references inspected

- [Better Auth LINE](https://better-auth.com/docs/authentication/line), [Apple](https://better-auth.com/docs/authentication/apple), [Next adapter](https://better-auth.com/docs/integrations/next), [account linking](https://better-auth.com/docs/concepts/users-accounts), [Drizzle](https://better-auth.com/docs/adapters/drizzle).
- [LINE S256 PKCE](https://developers.line.biz/en/docs/line-login/integrate-pkce/).
- Installed1.7.3 source: `@better-auth/core/dist/social-providers/{line,apple}.mjs`, `better-auth/dist/{state.mjs,api/routes/callback.mjs,api/middlewares/origin-check.mjs,integrations/next-js.mjs}`. Actual source exposed the test-only default origin bypass; explicit false settings keep the rejection tests meaningful.
