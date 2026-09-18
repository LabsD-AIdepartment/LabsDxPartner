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
same native session and allowlist. The owner enabled live read refresh for both existing Facebook bindings. Each page visit requests
the exact selected window; concurrent reads share one in-flight acquisition, and failed refreshes
are marked stale. Provider credentials resolve from `LABSD_LOCAL_KEYCHAIN_REFS` at startup and
are never stored as values in configuration. See `docs/dev/ad-performance-snapshot.md`.
The account page and password change remain native. Sample withdrawal balances and mutations
are illustrative and stored separately in user/partner-namespaced browser storage; they never
transfer money or modify native financial records. A footer identifies the sample presentation.

This is a **local pitch configuration**, not a production release. Standard production builds
still exclude development datasets and this pitch composition. A hosted pitch build requires an
explicit packaging/deployment task; do not deploy the default build expecting sample pages.
Source regressions in `dev/` remain test support, not extra running applications. Inactive
mockup copies and historical builds are archived under ignored `.agent-work/`.

### Connected-ad presentation flag

`LABSD_PITCH_SHOW_CONNECTED_ADS` defaults to OFF (unset or `0`). Set it to `1` in
local runtime configuration and restart the canonical server to show linked-ad
commission details, IDs and performance sections in Overview and My content.
This flag is resolved on the server for the local pitch composition only; URL
parameters cannot enable it. Production presentation is unaffected.

This is a visibility switch, not an integration or authorization switch: existing
source reads, accounting projections, confirmed earnings, wallet amounts, exports
and native access checks remain unchanged. No fallback amounts are added. When
visible, linked-ad pending reasons appear next to their earnings entries rather
than as a whole-page Overview warning. Unrelated missing-data and stale/error
notices remain visible. Set `0` (or remove the key) and restart to return to pitch
presentation; no data migration is needed.
Known aggregate pending earnings remain visible; the switch hides connected-ad
breakdowns, not financial totals. The additive `accountingStatus` metadata keeps
accounting warnings distinct from ad enrichment warnings, even with identical
wording. Older responses without this metadata retain their original notices.
