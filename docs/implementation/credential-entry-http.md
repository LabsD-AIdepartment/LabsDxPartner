# Invitation-only public entry and HTTP adapter

2026-09-09 · D-029 · Local candidate, following D-025/027/028.

## Visible behavior

`/login` now asks for username/password, with password-manager autocomplete, a show/hide control and a support route for forgotten passwords. It explains that first-time setup starts from the invitation supplied by the LabsD contact. Google/LINE/Apple buttons are no longer the public entry flow. The development access preview uses the same form and explicitly injected preview navigation.

`/invite#token=…` reads the bearer only in the browser and inspects it with a POST body. A valid invitation shows the approved recipient and partner and lets the recipient choose username/password/confirmation. Existing account holders can authenticate and accept the additional invitation. Successful registration commits before native login. If registration succeeds but login fails, the UI displays the completed-account state and a normal login link; it cannot resubmit account creation from that state. A response lost during registration is an uncertain outcome, not proof the account was not created; the normal login/support path remains available.

`/reset-password#token=…` inspects the verified reset link and lets its holder choose a new password. Success removes the fragment and requests a new login. No account setup/reset token is placed in a query parameter, server page prop, local/session storage or API URL. Opening/inspection does not consume a link. The fragment is cleared after confirmed success; it is retained on recoverable failures so a reload does not silently lose the invitation.

`PasswordField` shares field styling and typography with the existing design system and is used by all new forms. The public frame, Day/Dark theme and partner presentation are retained. `credential-client.ts` validates response shapes and maps failures to fixed Thai messages; raw backend error messages never enter the page.

## Server composition

`src/server/http/access.ts` composes existing partner and identity services. It owns HTTP parsing and attempt admission, not commercial approval or credential/membership invariants. Dependencies are browser -> HTTP adapter -> domain services. `src/server/http/bounded-request.ts` is shared with native login, keeping the 8 KiB/five-second network-read bound outside credential write locks.

The runtime remains disabled unless `LABSD_IDENTITY_ENABLED=1` and the credential namespace/HTTPS origin binding is correct. `/api/access/[...action]` is explicit POST-only dispatch for:

- session lookup;
- invitation inspect/register/accept/issue/revoke;
- password reset inspect/reset/change/issue.

Strict service contracts enforce authorization after admission. Native signup, native reset/change and social-provider endpoints remain closed. A bearer alone cannot create staff access. Staff issue/revoke/reset commands still require maintained sessions and server-side authority. Issuance returns a one-time token for deliberate staff delivery; no automatic send or message integration is added.

All commands require the exact configured Origin and JSON media type. Binding failure and unexpected service/database errors return generic responses. Replies use private no-store/no-referrer/nosniff headers. Public entry pages are dynamic and set no-referrer plus self-only connection/font/image/form/base restrictions. Development Next.js overrides its page cache header to no-cache; public page HTML contains no bearer/private account data. Command responses enforce no-store directly.

Admission is persisted in existing identity rate-limit storage, separately committed before the command. Current initial policy uses fixed one-minute windows: 240 global requests per read action (inspection/session), 60 per mutation action, then 60 read or 8 mutation attempts per bearer/verified-user scope (an invalid anonymous request uses its cookie scope). A second server instance sees the same counters. Global budgets remain effective when untrusted cookies rotate; authenticated actions resolve the maintained session first and key the personal budget to immutable user ID, so unrelated cookie changes do not reset it. Keys use HMAC with the configured server secret and do not store the raw bearer/cookie; expired application buckets are deleted in bounded batches without deleting native auth counters. No client-supplied proxy/IP identity is trusted. These are initial admission limits, not a measured capacity claim; tune them against real partner usage in R01.

## Verification and scope limits

Evidence: `.agent-work/20260909-access-http/evidence/`.

- `integration-02.log`: 87/87 real isolated PostgreSQL tests across eight suites, including authenticated-user budget protection; includes staff HTTP issuance -> inspection -> account registration -> native login -> scoped session -> reset -> old-session denial.
- `http-03.log`: seven focused HTTP tests after adding global-budget rotation and concurrent-budget cases and moving the adapter to the composition layer. Earlier full suite contained five of these cases.
- `unit-01.log`: 197/197 tests across19 files; includes shared field/autofill/literal-password behavior, fixed errors, invalid fragment, mismatch blocking, POST-only bearer transport, reset completion and registration-committed/login-failed handling. Initial form tests incorrectly queried a label without its hint; corrected the query, not the product label.
- `typecheck-04.log` passed; `build-04.log` records the final build and production fixture exclusion after preventing an invalid-link flash before the fragment is read. `forms-03.log` reran all five credential form cases after that UI change. An earlier typecheck saw a transient generated Next route declaration while the running dev server regenerated it; a subsequent fresh typegen/typecheck passed without suppressing types or excluding files.
- Existing listener4187 is the current checkout. Read-only GET `/login` and `/invite` returned200; invitation response carried the no-referrer/CSP headers. Saved HTML/header evidence is local only. These HTTP checks do not prove hydration, responsive layout or interaction.
- The existing Browser tab was an error document. Browser URL policy rejected navigation/control from that `data:` error page; no alternate browser/tool/policy bypass was attempted. Rendered browser acceptance is still open.

No migration was added in this batch. PostgreSQL target remains the project-owned isolated55487 cluster with immutable0001–0008. No real account conversion, credentials provisioning, sends, external-source mutation, deployment or independent release acceptance.

## Next required work

A03 is not complete: real partner leaves still use the earlier deny-only gate, so a successful credential session does not yet produce a usable authenticated Overview. Connect verified session/partner scope to the real application and handle unavailable source data truthfully; do not substitute development fixture data or remove the approved layout. Reconcile the pending D023 account/staff UI with invitation recipient/capability controls and password management. Verify the complete invitation-to-overview/logout/recovery browser journey and cache isolation at that point. F03/F07 changes remain candidates until rendered/responsive acceptance; source and financial integration tasks remain in the full plan.
