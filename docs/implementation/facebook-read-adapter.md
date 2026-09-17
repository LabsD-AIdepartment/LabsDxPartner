# Facebook acquisition adapter — P02 core

Local reader implemented on 2026-09-10. D064 installs lazy native provider composition and durable quota controls behind explicit flags; no real Facebook request or credential provisioning was performed. Native registration reports an installed provider only for configured profiles with injected credentials, and independently requires verified enabled database connections and staff grants. This document records the implemented contract and the outstanding activation work.

## Source choice and evidence

Sale Dashboard was inspected read-only at clean commit `c095405a6cf48d5c2554907529f604f172c21327`. Its `src/lib/integrations/graphClient.ts` pins Graph v25.0, uses header authentication and quota hooks, but caps pagination at 50 without exposing completeness. `src/modules/ads-manager/facebook/adsRead.ts` contains working field/read patterns; some summary projections replace missing values with zero. The portal does not import that client, reuse a staff cookie, copy a production token or access its database.

The direct read adapter is independently testable and fits the existing provider port. A source-owned bridge remains possible behind that port, but there is no verified M2M bridge to call today. Direct configuration explicitly declares `acquisitionOwner: portal-direct`; it must not create a second refresh owner for a Sale Dashboard credential. No token refresh implementation is introduced here.

Meta's primary [Ad SDK source](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py) confirms the GET insights endpoint and parameters for date range, increment, attribution windows and report time. [AdsInsights SDK fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py) identify the metric field families. Direct developer documentation requests returned HTTP429 or tool-fetch rejection in this batch; the local Meta KB and inspected official SDK support implementation fixtures, not proof of current account entitlement or real response semantics. Pin v25.0 deliberately; do not call it the latest version without fresh evidence.

## Implemented responsibilities

`facebook/graph.ts` owns fixed-host GET-only transport, header credentials, optional app-secret proof, abort deadlines, response byte bound, sanitized failures, response usage parsing and cursor extraction. It never follows a provider-supplied URL; it extracts a bounded cursor from a same-origin/same-path next link and rebuilds its own request with the original query. Token-bearing paging query values are discarded. No creation/edit/budget/delete endpoint exists.

`facebook/adapter.ts` checks configured account ID, namespace, timezone and currency against Graph account metadata and the exact ad's account. It returns the source's creative ID without inferring a celebrity from a name. Archived/deleted ads cannot be registered as new associations. Multiple image/video assets inside one creative are rejected; missing creative stays unknown and the registration service rejects it. Broader dynamic-creative/format inference remains unsupported.

Reports cover one exact ad and 1–31 complete account-calendar days, with explicit `all_days` aggregation, `7d_click+1d_view` attribution and `impression` report time. The future worker can request individual days for daily charts. Exclusive instants are converted to inclusive Graph dates through the configured timezone, including daylight-saving transitions; partial-day requests are rejected. Account timezone/currency or row identity/date mismatch fails instead of blending data.

No-breakdown `all_days` returns at most one observation row. Extra rows, overlapping pages or repeated cursors fail. After 20 page requests with a next cursor, the response is explicitly partial and exposes no accumulated metrics. An exhausted empty response is complete acquisition with unknown metric values, not fabricated zero. `dataThrough` stays null because these responses do not prove a source update watermark; `fetchedAt` only states when acquisition occurred.

Metrics retain exact decimal/count strings: impressions, inline link clicks, reach, spend, `actions.video_view`, and specifically `omni_purchase` from actions/action_values/purchase_roas. Alternative purchase aliases are not summed because they may overlap. Missing entries remain null with a reason; fractional values in integer count fields are rejected rather than rounded. Reach and ROAS are nonadditive. Platform-attributed sales are not ERP orders, agreed commission or a payment balance. Actual account fixtures must verify action availability and meaning before exposing those metrics to a partner.

## Configuration and controls

`facebook/config.ts` validates `LABSD_FACEBOOK_READ_ENABLED` and metadata-only `LABSD_FACEBOOK_PROFILES`. Each profile has ID, namespace, bare numeric account ID, currency, timezone, explicit acquisition owner, and secret environment variable **names**. Token values are not accepted in profile JSON. Duplicate canonical account profiles are rejected. Missing credentials yield no installed adapter. Runtime callbacks read injected secret values only when needed; nothing copies them into the database or response.

`configuredFacebookAdapter` requires `beforeRequest` and `recordUsage` callbacks. D064 implements persistent account/app quota controls and installs the resulting adapter in the application/worker composition; see marketing-sync-runtime.md. Database account grants and verification remain independently required; profile JSON does not grant a staff member access. Adapter availability is now connection-specific, preventing a single installed Facebook adapter from advertising unrelated connections as ready.

The transport honors Retry-After, parses app/business/account usage, and surfaces throttle/access/not-found/transient/invalid-source classifications without raw provider messages. It does not immediately retry429. Elevated usage also stops further acquisition. The worker must persist cooldown, retries and exceptional state rather than use a browser timer or a tight retry loop.

## Verification and remaining work

33 focused reader/configuration cases pass: large IDs and exact decimals; missing versus zero; wrong account/currency/timezone; deleted/archived/multiple-asset creatives; empty report; complete/partial/repeated/token-bearing cursor behavior; overlapping rows; action alias nonduplication; Thai and23-hour DST date boundaries; HTTP429/access/5xx including non-JSON bodies; Graph error-in200; quota hints; caller cancellation; byte bounds; metadata-only configuration and runtime references.

Full unit suite passes354 cases in39files. Native registration integration passes11 cases, including a new route→current staff auth→real Facebook adapter→fake fetch→durable receipt→save→mapping/job read flow. Only upstream HTTP was mocked in that case; no real network request was made. Typecheck/build results and complete source copies are in the P02 project context packet. No UI redesign or new browser acceptance is claimed for this backend-only batch.

P02 remains open for the configuration/provisioning lifecycle and actual allowed-account verification. Native runtime composition, quota controls, daily planning and the bounded executable are implemented in D064. P04 must read validated generations and preserve the existing financial boundary. Do not treat this adapter's unit tests as proof that a live account, full daily graph, periodic worker or another platform is operational.
