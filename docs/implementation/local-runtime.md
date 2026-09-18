# Single local application

Run `npm run dev` from this repository using Node24. The canonical local entry is
https://127.0.0.1:4443/login. It serves the current checkout and the existing local
PostgreSQL identity database. No copied build or secondary frontend is required.

The launcher reads ignored `.local/environment.json` and `.local/tls/{cert,key}.pem`.
These contain local configuration and secrets; never commit them. Provision from
the approved local environment, preserving BETTER_AUTH_URL, DATABASE_URL and
BETTER_AUTH_SECRET. The existing database binds identity to the HTTPS origin;
changing the port is not an ordinary UI preference. Keep PostgreSQL available.

The old HTTP4187 UI-only server, HTTPS4443-to4210 copied-build wrapper, and4195/4196
login mockups are retired. Do not launch historical `.agent-work` scripts. Previous
source and mockups are retained under `.agent-work/20260918-main-consolidation/backup/`.

The source retains development previews for regression tests, but both their pages
and APIs are disabled by default, including in the main development runtime. Only
an explicit LABSD_DEVELOPMENT_PREVIEWS_ENABLED=1 in an isolated development session
can enable them; production always refuses them. Archived ad sample media is no
longer in the public directory. Synthetic trial accounts are not persistent identities.

The current repository has no remote configured. `main` is the local base; a
production release still needs a reviewed commit, target configuration and a
deployment receipt. Do not represent the development server as deployed production.

## Approved pitch presentation (2026-09-18)

The owner selected the latest accepted partner design and existing sample data with real login.
Local configuration now opts into `LABSD_PRESENTATION_MODE=pitch`, with
`LABSD_PITCH_USER_ID` and `LABSD_PITCH_PARTNER_ID` referencing the native account/membership.
These identifiers are local configuration; passwords are never part of it or Git.

The single HTTPS4443 runtime serves canonical `/overview`, `/content`, `/transactions`, and
`/account`. The approved partner-demo compositions are reused behind native authentication;
legacy preview links redirect to canonical paths. Old controls and alternate sample identities
are unavailable. Dataset, stored ad snapshot and exact-file sample media requests require the
same native session and allowlist. External ad reports now come from PostgreSQL through the
hourly worker described below. Provider credentials resolve from `LABSD_LOCAL_KEYCHAIN_REFS`
at startup and are injected into the worker only when database mode is enabled.
They are never stored as values in configuration. See `docs/dev/ad-performance-snapshot.md`.
The account page and password change remain native. Sample withdrawal balances and mutations
are illustrative and stored separately in user/partner-namespaced browser storage; they never
transfer money or modify native financial records. A footer identifies the sample presentation.

This is a **local pitch configuration**, not a production release. Standard production builds
still exclude development datasets and this pitch composition. A hosted pitch build requires an
explicit packaging/deployment task; do not deploy the default build expecting sample pages.
Source regressions in `dev/` remain test support, not extra running applications. Inactive
mockup copies and historical builds are archived under ignored `.agent-work/`.

### Connected-ad notice flag

`LABSD_PITCH_SHOW_AD_NOTICES` defaults OFF (unset or `0`). Set it to `1` in local
runtime configuration and restart the canonical server to show the connected-ad
status messages beside their Overview earnings entries. URL parameters cannot
enable it. Production presentation is unaffected.

This flag controls notification text only. All approved content KPIs, ad IDs,
performance reports, ad lists, commission details, amounts and pending totals stay
visible in both states. Source reads, financial calculations, exports and native
authorization are unchanged.

Overview retains base accounting status separately from ad enrichment status, so
ad-specific messages appear in their earnings context rather than a whole-page
banner. Unrelated accounting warnings remain visible, even if wording matches an
ad message. Older payloads without provenance retain their original notices.

### Navigation read cache

Verified pitch pages retain query results in root-layout memory across navigation.
The cache owner includes the native user, active partner and membership revisions;
existing query keys still separate dates, generation and preview scope. Visits
continue to refetch. A previously opened page can show its last result during the
new read; a first visit or a new filter still waits for data. The content library
shows a small update status while refreshing.

Logout, public access routes, verification failure and native scope changes clear
retained clients. A live permission revision change hides the report and refreshes
server authorization before reuse. Nothing is written to browser persistent storage;
non-pitch query providers retain their original isolation and disposal behavior.

### Hourly external data worker

`LABSD_AD_SNAPSHOT_DATABASE=1` makes the connected-ad endpoint read PostgreSQL only.
`LABSD_EXTERNAL_DATA_WORKER_ENABLED=1` starts a supervised worker with `npm run dev`.
Keep `LABSD_AD_SNAPSHOT_AUTO_REFRESH=0` and `LABSD_AD_SNAPSHOT_REFRESH_ON_VISIT=0` in
this mode. Even if accidentally enabled, the database read path takes precedence.
The web child receives no configured Facebook token/app-secret environment values.

The current external-data inventory serving the pitch consists of the two configured
Facebook ad bindings. The native marketing and TikTok Shop paths already read PostgreSQL;
their disabled acquisition lanes and unrelated registered fixtures are not activated here.
The approved sample accounting dataset and withdrawal state retain their own authority.
A report observation does not become a confirmed payable simply because it was refreshed.

Migration `0028_external_ad_snapshots.sql` adds the isolated provider read model.
`scripts/seed-external-snapshots.ts`, run with the existing local environment injected,
imports validated exact-binding reports once and preserves their original timestamps.
Post-cutover the web never falls back to files or an external request on a database miss.

Each configured/default window and rolling current-month/latest-seven-day window stays
active. Other requested exact windows stay active for seven days after last use. Each
successful report is refreshed after one hour; failures retry after one hour and retain
last-good data. New valid date windows register a bounded database job and initially
show unavailable ad values; the worker polls every 15 seconds and fills the window
independently of the page request. At most128 active windows per binding are admitted.
Dates remain exact; overlapping full-period reports are never added or averaged.
Reload/normal query refresh reads newly stored results. Saved reports are retained after
retirement; there is no automatic deletion. This preserves provider-defined ratios.

The worker verifies the native namespace, complete binding identity and exact period,
uses expiring SQL leases, and bounds each source fetch to20 seconds. Restart/startup
catches up due work. The launcher supervises crashes/stalls via the existing heartbeat
supervisor, owns shutdown, and opens no additional frontend or health port. It logs
state/attention changes without raw provider error text. A source failure or report older
than two hours is returned stale with its original update time. The current local worker
runs while the local launcher and Mac are running; it is not an always-on hosted service.

Rollback: stop the launcher, disable both new flags, and restart with the previously
approved snapshot policy. Keep the additive table and reports; code rollback needs no
schema rollback. Never enable broad native acquisition merely to start this lane.
