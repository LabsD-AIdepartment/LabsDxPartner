# Daily chart fill for the hosted demonstration

This optional feature fills missing daily points in the **Daily Clip Earnings card only**. The original dataset, report totals, exports, balances, withdrawals and provider snapshots remain unchanged. It is illustrative data, identified in the card and API as demo data.

## Operation

- `LABSD_DEMO_DAILY_CHART_FILL_ENABLED=1` enables the hosted worker and chart adapter. Default is off.
- Existing authenticated pitch mode is required. Local development uses the same worker and adapter through `scripts/local-dev.mjs`; production additionally requires the hosted-demo artifact. Native production cannot use the endpoint.
- The local launcher and existing hosted web container both supervise a dedicated `scripts/demo-daily-chart-worker.ts` child. No Railway cron service or external scheduler is required.
- The worker starts with a catch-up pass, then wakes at **00:00 Asia/Bangkok (UTC+07:00)**. A 30-second heartbeat permits supervisor liveness checks between midnights.
- Each pass deterministically generates dates from **2026-09-19 through today's Bangkok date**, inclusive. This backfills19September on the first enabled deployment and missed days after downtime. No future dates are returned to clients.
- Optional `LABSD_DEMO_DAILY_CHART_FILL_DIR` selects a dedicated directory (used locally under ignored `.agent-work/runtime/`). Otherwise the versioned file `${LABSD_HOSTED_DATA_DIR}/demo-daily-chart-fill-v1.json` lives on the existing private volume. Atomic replacement prevents partial reads. Repeated passes for the same date do not write. This feature does not use SQL or migrations.
- Values vary deterministically by date and known demo brand. No real clip identities are fabricated. A missing day's all-brand amount equals the sum of its brand amounts; eligible sales are illustrative at10x commission.
- Original daily points, including zero, and completely covered source days always take precedence. The separate weekly query is polled every30seconds so a midnight query racing the writer recovers without a reload.
- Source freshness, warning reasons and timestamps are preserved when adding illustrative points; generated samples cannot mark stale or partial source data as ready.
- Endpoint `GET /api/demo/daily-chart-fill?identity=a` uses the existing pitch allowlist/session guard and private/no-store responses. Flag-off/native returns404. A missing or unavailable fill file falls back to the original chart data.
- Worker failure is isolated: supervisor retries, then reports failure; the optional fill cannot terminate the web process. Check Railway worker state logs, `/proc` process presence and file `through`/row dates for freshness. A running process alone does not prove today's fill exists.

## Verification and rollback

Test Bangkok midnight, restart catch-up, idempotence, future clipping, flag-off/auth gates, existing-point preservation and chart-only reconciliation. Validate the actual hosted chart and unchanged headline/Wallet figures before declaring acceptance.

Disable by setting `LABSD_DEMO_DAILY_CHART_FILL_ENABLED=0` and applying the Railway variable deployment. This stops the child on restart and removes the override on the next page load; API reads stop immediately for that deployment. The persisted file is harmless and retained for rollback. No source data needs restoration.

## Removal map

1. Disable the flag and verify original chart reads and absence of the worker.
2. Remove `src/server/hosted-demo/daily-chart-fill/`, the API route and route-template catalogue entries, `scripts/demo-daily-chart-worker.ts`, `scripts/demo-daily-chart-supervisor.mjs` and its calls in `scripts/start-hosted-demo.mjs` and `scripts/local-dev.mjs`.
3. Remove `dev/daily-chart-fill-transport.ts`, the optional property through `renderPartnerPage -> PitchApplication -> WithdrawalPreview`, and the weekly override wiring. The generic optional weekly polling property may be removed when no other caller uses it.
4. Remove the scoped tests and this runbook; remove the feature flag and optional directory configuration. After confirming no required use, archive/delete only `demo-daily-chart-fill-v1.json` and its own temporary files. Do not touch the original SQLite dataset or pitch-wallet file.
