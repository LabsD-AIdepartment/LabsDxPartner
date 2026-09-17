# Native application routes after logical recovery

This is the application-read follow-up to the [isolated database restore drill](../runbooks/backup-restore.md). It runs the actual Next route exports, identity runtime, maintained password/session engine, authorization and data readers in a fresh Node process against the restored database. It does not start an HTTP listener, browser, acquisition worker or provider connection.

From the project root with Node 24, set two project-local file references:

```sh
LABSD_RESTORE_RESULT=<absolute-project-path-to-successful-restore-result.json> \
LABSD_DRILL_IDENTITY_CONFIG=<absolute-project-path-to-private-synthetic-identity-config.json> \
node scripts/run.mjs test:restored-app
```

The runner supplies project-local temporary/cache paths. The acceptance entry is `tests/helpers/restored-app-acceptance.ts`, inside the normal full TypeScript check. It accepts no target arguments. Both files must be real regular files inside `.agent-work`, with no symlink redirection and at most 64 KiB. The receipt must report successful schema and immutable-trigger verification, name its own containing work directory and name a generated `labsd_restore_<32 hex>` database. The destination then has to confirm its exact name and physical project-owned cluster. The private config's source URL must match the existing isolated-database guard.

This particular acceptance deliberately targets the existing synthetic celebrity journey: logical origin `https://127.0.0.1:4443`, account `celeb_trial`, its already-established trial password and partner fixture. It refuses a different config or a missing fixture rather than provisioning a new account, resetting its password or editing the restored identity namespace. The secret is loaded from the private file at runtime, never printed. The concrete database URL changes only in the new process; the original logical origin and identity binding remain intact. This tests recovery at the same logical application origin, not moving the service to another domain.

Verification exercises:

- Anonymous session access returns 401; a login from a different Origin returns 403. The original restored password succeeds, emits Secure/HttpOnly session cookies and creates one persisted session for the existing user. The existing partner membership is selected.
- Native Overview returns confirmed commission 3,736,000 minor units, eligible sales 55,000,000 and unpaid balance 3,736,000. The daily chart sums to the commission total and the portrait remains present.
- Native content returns six clips whose earnings sum to that same amount; all have media references. Native account returns the existing username and the correct partner's agreement at revision 2.
- Native statements return one issued statement with the same closing balance. The native streaming export returns an attachment with six lines whose exact decimal amounts sum to 3,736,000 minor units and eligible bases sum to 55,000,000. The test's CSV shape is intentionally the known simple synthetic fixture; it is not a general-purpose CSV parser or browser save test.
- A different partner is denied with 403. Native logout succeeds and the old cookie subsequently gets 401 on Overview. The restored identity binding is byte-for-byte unchanged. Source account/session/binding fingerprints before and after match for the tested identity; their values and digests are never output.
- A test-only outbound fetch sentinel records zero calls. Actual provider access and worker startup are not part of this path.

The recorded complete run on 2026-09-11 passed in about 1,137 ms for the scripted checks; this excludes subsequent idle-pool shutdown. The first Overview handler read in that fresh process is recorded separately in its result. It is **not** a cold PostgreSQL-cache, TLS/network or browser rendering measurement. The native runtime retains its normal ten-connection pool; the separate validation connections use two each. No production pool limit or login throttle was changed.

Three subprocess entry tests prove supplied targets, outside-project receipts and absent receipts fail before connection/output creation. Full TypeScript validation passed after correcting initial test-only response-envelope and literal-type mistakes. An initial passing route run had weaker export/account assertions; the final run also checks all six export lines and restored agreement revision.

`app-acceptance-<timestamp>.json` is written with mode 0600 beside the successful restore receipt. It contains only statuses, counts, timing and synthetic controls. Native authentication intentionally changes the restored database's session/rate-limit state; the original logical-restore equality result records the earlier recovery point, not a promise that the exercised copy stays forever byte-identical. The owner's active preview keeps its original database and session. No namespace, credentials, financial history or source data are rewritten to make the application pass.

This closes the scoped native-route/login/read/logout recovery check. It does not close full R01/R02 or prove a production build booting on a restored service, browser rendering, 200% zoom, final browser file save, TLS cutover, provider-key restoration, external file availability, production grants or off-device disaster recovery. Those still require their own evidence and applicable deployment authority.

## Built-service HTTP recovery acceptance

Set `LABSD_RESTORE_BUILD_DIRECTORY` to an absolute, isolated build-copy directory under this project's ignored `.agent-work` and run the same `test:restored-app` command. Omit it to retain the native-route mode. The directory must contain a regular, non-redirected `.next/BUILD_ID`; the active root `.next` is refused. Prepare the copy using the same pinned Node 24/default Turbopack build and production fixture-exclusion check. Copy product sources and required config, never private environment files or another runtime's `.next`. Record the exact source manifest/build ID with the run. This is a local dirty-tree artifact, not an approved production release.

The harness validates the restored database and identity config first, then starts a separate Next production custom server on an OS-assigned loopback port. It passes only the restored database, original logical origin/secret, required feature flags and local cache paths to the child. The child does not inherit source API credentials or worker settings. A test-only fetch sentinel refuses outbound calls. It binds neither the owner's HTTPS port nor their Next port and closes its listener on completion; failure cleanup force-terminates only its own child if needed.

All existing login, session, Overview, six-clip totals, agreement, statement/CSV, foreign-partner and logout checks now travel through real Node HTTP requests and the built Next router. There are no direct route imports in HTTP mode. The loopback client explicitly preserves the original Host/forwarded HTTPS origin and manually carries the Secure session cookie, as a trusted local reverse proxy would. **This does not test TLS termination, browser cookie enforcement or recovery at a different public origin.** The test records HTTP timing separately from native handler timing.

Additional checks request `/login`, `/overview`, `/content`, `/account` and `/transactions` and require branded HTML, then fetch every discovered first-document JS/CSS bundle plus the portrait and six cover references. All must return nonempty non-HTML asset responses. This proves built routing and file availability for those references; it does not execute browser JavaScript, prove hydration, check every lazy chunk or measure visual layout/LCP.

On 2026-09-11 the first built-service run passed all existing assertions, five HTML routes and their assets, with zero child outbound-fetch attempts and successful listener shutdown. Source identity fingerprints and the restored binding remained unchanged. Read the timestamped result for the exact build ID, static bundle count and timing. Its private adjacent server log is retained for debugging; do not publish it indiscriminately. Two additional guard tests cover the active/outside build and incomplete/redirected build IDs.

This advances application recovery beyond direct handler invocation. Browser/TLS cutover, source cold-cache measurements, off-device recovery, roles/grants, provider-key restoration and production release acceptance remain separate open checks.
