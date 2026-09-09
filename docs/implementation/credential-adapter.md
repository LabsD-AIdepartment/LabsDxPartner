# D-025 credential adapter — local candidate

2026-09-09. Implements the backend entry configuration for [invitation-only access](../design/invitation-only-access.md). This is not completion of invitation activation, recovery or frontend wiring.

## Changes

- Production runtime constructs the maintained Better Auth username/password configuration. It requires only HTTPS origin, auth secret and database, not social credentials. Legacy social code/tests remain preserved but are not mounted by this runtime.
- Native HTTP allowlist exposes username sign-in, session lookup and sign-out only. The library before hook also rejects other native endpoint paths. Public registration, social/linking, password mutation and username enumeration remain closed until their guarded application workflows exist.
- Username normalizes to lowercase after trimming, permits3–30 ASCII letters/digits/dot/underscore and has a database uniqueness/format constraint. Passwords are never trimmed; new-password contract is12–128 characters. Native password hashing and verification are retained.
- Migration0006 adds a nullable username and constraints; existing identities remain untouched. Applied0001–0005 were checksum-verified by the isolated runner. No record conversion, password assignment or deletion occurred.
- Runtime requires an explicitly provisioned `credentials-v1` binding matching its HTTPS origin. Old social `current` binding cannot silently activate credential access. No binding is automatically inserted, and the identity feature remains off by default.

## Verification

Evidence: `.agent-work/20260909-credential-adapter/evidence/`.

- `migrate.log`:0006 applied only to project-owned PostgreSQL55487/labsd_partner_test; earlier checksums verified.
- `integration-02.log`:54/54 isolated PostgreSQL tests passed, including six new native credential cases and48 existing cases.
- `credential-03.log`:7/7 credential tests passed after adding concurrent normalized username creation. This focused rerun is separate from the earlier54-test regression count.
- `unit-01.log`:192/192 unit/contract tests passed.
- `typecheck-03.log` and `build-01.log`: successful commands; production browser fixture exclusion passed. No new rendered-browser acceptance in this backend batch.
- Tests seed synthetic credentials via the maintained internal adapter, then exercise real native HTTP password/session paths and real database constraints. They do not simulate an invitation as accepted.

The first credential test exposed foreign-Origin login returning200 through the username plugin. An explicit same-origin check for browser mutations now rejects foreign and missing Origin, including sign-out; native CSRF protections remain enabled. The failing `credential-01.log` is retained, not overwritten.

## Remaining work and rollback

- Guarded preapproved invite redemption must atomically create credentials, activate the intended membership, consume the invite and audit before usable session issuance. Existing invitation service still assumes a logged-in user and pending membership; it must change coherently.
- Implement verified reset and current-password change with session revocation and concurrent login/reset proof. These native routes remain unavailable now, so this candidate does not claim recovery readiness.
- Replace social login/account UI and transports, reconcile paused D-023 provider-specific changes, and verify the complete browser journey. Exact membership targeting remains useful. No visible UI transition is claimed by this receipt.
- Native allowlist/configuration and registration/reset lifecycle must be retested on any auth-library upgrade. Actual staging binding, HTTPS, operator recovery and independent release acceptance remain open.
- Code rollback preserves the additive username column, identities and audit; no down migration or provider-record deletion. Do not expose old social routes automatically as a rollback strategy.

Other uncommitted D-023 and plan changes existed during verification. The reported tests describe the inspected working tree, not an independently accepted frozen release. No upstream calls, external sends, provider setup or deployment occurred.
