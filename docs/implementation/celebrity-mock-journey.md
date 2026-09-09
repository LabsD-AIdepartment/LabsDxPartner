# Celebrity mock journey — D032

The owner explicitly requested mock data and to act as the celebrity. A real partner, agreement owner or API account is not a prerequisite for completing this frontend journey.

Open `http://127.0.0.1:4187/access-preview` in the development server. The starting assumption is a deal already agreed with Labs D. Open the simulated invitation, choose a trial username/password, and enter the existing Overview, continuous six-clip library, clip/ad details and statements. The original imagery, shared shell/theme and typography remain. The supplied celebrity imagery represents the owner in this mock; it does not identify a real account.

The default dataset reconciles ฿550,000 eligible sales, ฿37,360 commission (Organic ฿29,800 at 10%; Brand ads ฿7,560 at 3%), ฿11,840 settled and ฿25,520 outstanding. Existing domain fixture transports and contracts supply these values; the UI does not independently invent totals. Unknown upstream counts remain unavailable, not zero.

## Boundaries

- `CredentialEnvironment` injects request, sign-in, navigation and link access into the shared public forms. Without an override these forms still call the guarded native HTTP services. No fixture import enters production identity modules.
- `dev/celebrity-journey.ts` owns an ephemeral simulated account/session, invitation and reset. A digest of the trial password exists only in memory; this is deliberately not a password storage implementation or security proof. No account credential, bearer or session is persisted. Reload starts over. No real account is provisioned and no message is sent.
- Mock invitation and reset are single-use/expiring. Reissuing reset invalidates the old mock link; resetting signs out the mock session; wrong and old passwords are rejected. Reset is 30 minutes, matching the intended real flow.
- `dev/AccessPreview.tsx` composes the existing feature components with the existing financial adapters. Internal navigation stays within the in-memory journey. Deep development preview links opened in a new tab start a fresh journey. This preview does not promise browser back/forward session restoration.
- `/access-preview/[[...segments]]` is development-only and resolves to the existing unavailable preview stub for production builds. Bundle checks now explicitly reject `Celebrity mock journey` in production output.

## Validation and limits

Author checks: 213 unit/component tests and 90 isolated PostgreSQL tests pass; typecheck, production build and fixture-exclusion checks pass. New tests cover invitation reuse/expiry, credentials, reset replacement/expiry, session revocation, no mock network/storage writes and the shared-form → Overview → six covers → clip detail → statements → logout/reset sequence. PostgreSQL tests exercise the separate real staff access service/HTTP path; they do not make the mock production authentication.

Rendered local browser journey and outstanding items are recorded in `.agent-work/20260909-staff-access/evidence/`. Real HTTPS identity journey, actual source integration, all-width/native-zoom acceptance and independent release review remain separate gates. No deployment, push, merge, real recipient send or production migration occurred.
