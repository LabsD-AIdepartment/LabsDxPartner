# Ad-snapshot automatic local preview acquisition (dev-only, opt-in)

Adds generic automatic acquisition of the ad-performance preview snapshot for EVERY already-verified
configured binding, on the EXACT requested report window (1..93 days). Dev-only, OFF by default, no
provider writes, no secret resolution here. The read-only Graph token is injected at runtime by root
(Keychain → `profile.tokenEnv`); this code never reads or writes a token.

See `.agent-work/20260917-wallet-redesign/system/ads/integration-contract.md` for the full contract.

## Enabling (root, dev machine only)

- `LABSD_AD_SNAPSHOT_ENABLED=1` — gates the whole preview (existing).
- `LABSD_AD_SNAPSHOT_AUTO_REFRESH=1` — NEW opt-in: allow the dev endpoint to auto-acquire missing/stale
  windows. When unset/`0`, the endpoint keeps the exact configured-window, read-only behavior and never
  calls the provider.
- Existing `LABSD_FACEBOOK_READ_ENABLED` / `LABSD_FACEBOOK_PROFILES` / `LABSD_AD_SNAPSHOT_BINDINGS` /
  `LABSD_AD_SNAPSHOT_DIR` are unchanged. No `.env` file is edited by this change; root sets the ignored
  local flags for the dev server.

## Behavior (AUTO ON)

1. Standard guards run first and unchanged: dev-only, GET, loopback Host/Origin, `Sec-Fetch-Site`,
   strict query allowlist + duplicate rejection, nosniff, `no-store`. Unknown binding / cross-identity /
   disabled feature never reach the provider.
2. The requested `from`/`to` are validated as real ISO calendar dates with an integer 1..93-day span
   (`deriveRequestedWindowBinding`). Failure → 404 `invalid window`, BEFORE any provider work.
3. Cache lookup (no provider call when fresh, freshness = 300s):
   - window-specific file `${identity}__${clip}__${from}__${to}.json`;
   - legacy base file `${identity}__${clip}.json` ONLY when the requested window equals the configured
     window (never written by auto-refresh, so a manual operator snapshot still previews).
4. Missing/stale → one bounded single-flight acquisition for the EXACT requested window via the existing
   sanitized reader (`buildAdSnapshot`), 5s provider deadline, single-flight per full scope + window.
   The flight owns its deadline and is NOT tied to any client abort. Result is written atomically to the
   window-specific file only.
5. If acquisition does not populate the cache (absent credential / provider error / deadline), a still
   present STALE cache is served; otherwise 404 `no snapshot`. No env/token/Graph URL/error/raw count is
   ever leaked. The served `performance.period` always equals the requested window.
6. `PartnerAdPerformance.automaticRefreshFrom` (already contract-optional) is echoed with the acquisition
   start instant when this response involved an acquisition.

## Client refresh

`dev/ad-performance/client.ts` keeps its bounded 3s overlay timeout, so a stalled server read resolves
the overlay to null and never blocks the already-computed financial detail. A cache-first miss returns a
non-200 → the client resolves null. Because the server single-flight refresh continues past the client's
3s and populates the cache, a subsequent detail-metric refetch returns the freshly acquired window.
`useContent.ts` refetches detail data every 60 seconds while mounted. Scope changes abort obsolete
client reads, and unmount stops the timer. Financial detail remains independently authoritative.

## Files

- `src/server/modules/marketing-ads/facebook/snapshot-config.ts` — `adSnapshotAutoRefreshEnabled`,
  `adSnapshotWindowFileName`, `deriveRequestedWindowBinding` (additive).
- `src/server/modules/marketing-ads/facebook/snapshot-refresh.ts` — factored `buildAdSnapshot`
  (single authority for one validated snapshot); `refreshAdSnapshots` now composes it (behavior kept).
- `dev/ad-performance/auto-refresh.ts` — bounded single-flight acquisition coordinator (NEW).
- `dev/ad-performance/handler.ts` — auto-refresh path (OFF path byte-identical to before).
- `dev/ad-performance/handler.unavailable.ts` — mirrored optional deps (still a 404 stub).

## Security limits

- No arbitrary adId/accountId/URL/path/credential accepted from the browser (unchanged).
- Provider is queried only for the EXACT requested window under the verified identity binding; a
  different period is never attached as the selected period.
- No provider writes; financial data untouched; atomic project-local cache writes only.
