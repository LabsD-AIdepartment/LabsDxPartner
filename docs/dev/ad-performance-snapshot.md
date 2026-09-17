# Dev ad-performance snapshot preview

Real, owner-authorized Facebook ad economics (CPC, CTR, CPM, ROAS, cost-per-purchase, the link-click
count (`link_clicks`), the derived sales conversion rate (`purchase_conversion_rate`), the Meta
purchase-order count (`platform_orders`) and purchase value (`platform_value`), and — only for
authorized viewers — spend) surfaced on the **partner-demo** clip detail, WITHOUT shipping a live
token, an arbitrary Graph proxy, or any still-forbidden audience count to the browser. Everything here
is development-only and OFF by default.

## What a Celebrity may see

`src/contracts/celeb-safe-metrics.ts` is the single shared policy (imported by both the server
projectors and the UI):

- **Always excluded**, regardless of any permission: `impressions`, `video_views`, `reach`. These
  raw counts never appear in Celeb-visible metrics, series, reasons or metadata.
- `link_clicks` is now **owner-authorized** as a Celeb-safe count. The latest owner instruction
  supersedes the earlier D170 click exclusion — but ONLY for `link_clicks`; `impressions`,
  `video_views` and `reach` stay hidden, and every unknown/future key stays denied by default.
- `spend` is hidden unless the viewer holds `view_ad_spend` (native) / the binding's `canViewSpend`
  (preview).
- Everything else the projector emits is safe: `roas`, `cpc`, `ctr`, `cpm`, `cost_per_purchase`,
  `purchase_conversion_rate`, `link_clicks`, `platform_orders`, `platform_value`. **ROAS stays
  visible even when spend is hidden.**

Metric units: `cpc`, `cpm`, `cost_per_purchase` are money (THB); `ctr` and `purchase_conversion_rate`
are ratios whose value is already a **percent** (Meta returns e.g. `1.53` for 1.53%; the conversion
rate is expressed the same way) — presentation appends `%`, never `×100`. `roas` is a ratio shown as
a multiplier (`x`). All of cpc/ctr/cpm/roas/cost_per_purchase/purchase_conversion_rate are
**non-additive** — never summed or averaged across periods or ads. `link_clicks` and `platform_orders`
are `sum-disjoint` counts.

### Derived sales conversion rate

`purchase_conversion_rate` is a **derived** metric owned by the shared projection
(`partner-performance.ts`), so it is computed identically for native reports and dev snapshots:

- Formula: `platform_orders / link_clicks * 100`, computed with **BigInt** at a fixed scale of 6
  decimal places, rounded half-up, trailing fractional zeros stripped (never through a lossy
  `Number`). E.g. 51 orders / 753 link-clicks → `6.772908`.
- It is derived AFTER the compatibility/coverage-guarded totals **and** for each series period, and is
  **never** summed or averaged: a whole-period total is a ratio of the summed counts, not an average of
  daily rates. Two unequal periods 51/753 and 12/121 total `63/874*100 = 7.208238`, not the mean of the
  per-period rates.
- A supplied `purchase_conversion_rate` on an input report is **never trusted**: it is excluded from the
  aggregation candidates and recomputed from the authoritative order/click counts (no duplicate).
- Unknown when a needed count is missing/null, when there are zero link-clicks, or when the exact result
  falls outside the wire range → `value: null` with a plain-Thai short reason. A positive click count
  with zero orders yields a real `0` (never clamped, and there is no 100% ceiling: the attribution
  numerator can include view-through purchases). Totals from incomplete coverage carry a null
  numerator/denominator (rate unknown) while a valid partial-window series rate can still surface.
- Attribution note: the numerator is Meta's attributed omni_purchase count under `7d_click+1d_view`, so
  this is **attributed purchases per link-click**, not a matched unique-user checkout probability. The
  Celeb UI labels it `อัตราซื้อต่อคลิก` with a `%` suffix. Human definition:
  `จำนวนการซื้อเทียบกับคลิกลิงก์ของโฆษณา`.

The native `SourceReportV2` raw counts are unchanged; native staff/ingestion keep them. Only the
public projection (`celebSafeAdPerformance` in `partner-performance.ts`, applied by `partner-read.ts`
and the preview projection) strips them.

## Source

- Reader: `src/server/modules/marketing-ads/facebook/snapshot-reader.ts` — a SEPARATE bounded reader
  supporting a single full-period report of up to **93 days** (the native sync adapter is capped at
  31). It requests Meta's official
  `cpc,ctr,cpm,spend,inline_link_clicks,purchase_roas,cost_per_action_type,actions,action_values`
  fields with `7d_click+1d_view` attribution and `action_report_time=impression`, reusing the existing
  safe Graph transport (`facebook/graph.ts`). A window with zero delivery is reported `unavailable`,
  never fabricated as zero.
  - **No still-forbidden audience-count *field* is ever requested** (`impressions`, `reach`,
    `video_view`). The owner-authorized `inline_link_clicks` field **is** requested and emitted as the
    Celeb-safe **`link_clicks`** count (validated as an exact integer via `ExactCount`; definition
    `คลิกลิงก์`). The broad `actions`/`action_values` arrays are a transient source payload that may
    still carry unrelated Meta counts (e.g. `video_view`, and an actions `link_click` that is NOT the
    authoritative inline field); those are **discarded in the reader and never serialized** into the
    `SourceReportV2` or persisted snapshot. Only the single `omni_purchase` entry is projected from the
    arrays — as the Celeb-safe **`platform_orders`** count and **`platform_value`** money (account
    currency). So the Celeb-safe counts `link_clicks` and `platform_orders` do enter the source
    response; the still-excluded raw audience-count *fields* never do.
  - `action()` projects a single value per array: it **rejects a duplicated `omni_purchase`** and never
    sums an overlapping purchase/offsite purchase type or any attribution sub-field. A missing entry is
    `null` with a reason; an explicit `0` is preserved (never fabricated, never derived from
    spend/ratios). Snapshots written before these keys existed stay compatible (the keys are absent).
- It reuses the native `LABSD_FACEBOOK_READ_ENABLED` / `LABSD_FACEBOOK_PROFILES` / profile `tokenEnv`
  scheme for credentials; it never reads a raw secret itself.

## Config (server-only; never `NEXT_PUBLIC`)

| Env | Meaning |
|---|---|
| `LABSD_AD_SNAPSHOT_ENABLED` | `1` to enable refresh + the dev endpoint. Default off. |
| `LABSD_AD_SNAPSHOT_BINDINGS` | JSON allowlist (below). |
| `LABSD_AD_SNAPSHOT_DIR` | Optional; project-local snapshot directory. Default `.agent-work/20260917-ad-performance/snapshots`. |

Binding entry (`src/server/modules/marketing-ads/facebook/snapshot-config.ts`):

```json
{ "identity": "a", "clipId": "clip-3", "profileId": "fb-primary",
  "namespace": "meta", "accountId": "1234567890", "adId": "52513673563767",
  "expectedCreativeId": "1004085732033027", "expectedVideoId": "2629443027486387",
  "currency": "THB", "timezone": "Asia/Bangkok",
  "from": "2026-07-01", "toExclusive": "2026-09-01", "canViewSpend": false }
```

`profileId` must reference a `LABSD_FACEBOOK_PROFILES` entry whose namespace/account/currency/timezone
match. `expectedCreativeId` is **required** and `expectedVideoId` is **optional**: refresh verifies the
ad still resolves to that creative (and, when set, that its videos include `expectedVideoId`) before
writing, so a replaced/foreign creative is rejected — never snapshotted.

This list is a **strict allowlist**: only a listed `identity+clip` is ever served, matched against its
own bound ad/account and its **exact** `from..toExclusive` window. There is no wildcard, no
"everything-else-is-safe" fallthrough and no arbitrary-Graph proxy. The window is a **closed, complete
calendar range** of 1..93 days whose exclusive end may not fall on an in-progress/future day, so a
partial (still-accruing) day can never masquerade as a full-period aggregate.

Verified sample identities: clip-3 → ad `52513673563767` (creative `1004085732033027`,
video `2629443027486387`); clip-sep-2 → ad `52554922813367`.

## Operator commands (root runs these; Keychain reference only)

Refresh the snapshot files (read-only Graph → validated local files, no token/counts stored). Each
snapshot is fetched for the binding's **exact** closed window and stored verbatim — the endpoint never
re-slices or widens it:

```
LABSD_AD_SNAPSHOT_ENABLED=1 \
LABSD_FACEBOOK_READ_ENABLED=1 \
LABSD_FACEBOOK_PROFILES='[{"id":"fb-primary","namespace":"meta","accountId":"1234567890","currency":"THB","timezone":"Asia/Bangkok","acquisitionOwner":"portal-direct","tokenEnv":"LABSD_FB_PRIMARY_TOKEN"}]' \
LABSD_AD_SNAPSHOT_BINDINGS='[{"identity":"a","clipId":"clip-3","profileId":"fb-primary","namespace":"meta","accountId":"1234567890","adId":"52513673563767","expectedCreativeId":"1004085732033027","expectedVideoId":"2629443027486387","currency":"THB","timezone":"Asia/Bangkok","from":"2026-07-01","toExclusive":"2026-09-01","canViewSpend":false}]' \
LABSD_FB_PRIMARY_TOKEN="$(security find-generic-password -s Meta_FraudCheck_API -w)" \
node --import tsx scripts/ad-performance-refresh.mjs
```

Then start the dev server (port 4187) with the same `LABSD_AD_SNAPSHOT_*` flags set in the ignored
`.env.local`. The snapshot files persist across page refreshes.

## Endpoint + security limits

`GET /api/dev/ad-performance?identity&clip&from&to`

- 404 outside development (route guard **and** the `@ad-performance-handler` production alias → 404
  stub, so the code + `synthetic-ad-performance-snapshot` marker never ship).
- Loopback only: `Host` must be a loopback name and any `Origin` must be loopback; no CORS wildcard.
- Accepts ONLY `identity+clip+from+to`, matched against the server-owned binding + exact window. No
  `adId`, `accountId`, URL, path or secret reference is ever accepted from the browser. It serves
  persisted snapshots only — there is no arbitrary Graph proxy.
- The CURRENT config is authoritative: a persisted snapshot is served only while it still equals the
  live binding for that identity/clip. If config re-points the same clip/window at a different ad
  (or the requested window no longer equals the bound one), the stale file is **not** served → 404.
- Re-validates the ENTIRE persisted snapshot (contract + account/clip/window/currency/timezone/state
  scope) before projecting, then returns Celeb-safe metrics only. A foreign-identity snapshot →
  404; a corrupt snapshot → 503.

The browser client (`dev/ad-performance/client.ts`) merges the optional performance into the clip
detail; it is cancel/race safe and any failure resolves to `null`, never blocking financial data. It
is also time-bounded: the request carries a **3 s** internal timeout combined with the caller's abort
signal, so a stalled connection resolves the overlay to `null` and leaves the financial detail intact.
