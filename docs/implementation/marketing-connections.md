# Staff connection checks and acquisition recovery

Implemented locally on 2026-09-10 (D065), following the native registration and acquisition runtime. This is a small operational section within the existing Ads console, not a second data-approval process. No live account was activated in this batch.

## Staff experience

The shared `ConnectionsPanel` is collapsed initially. Opening it reads the accounts already granted to the current staff member, shows acquisition enabled/paused, associated ad count, jobs requiring attention, the last successful account verification and latest successful report import. It refreshes the portal snapshot every 15 seconds while mounted. A page read does not call Facebook.

Actions:

- **Check connection / check and enable:** verify the exact configured Facebook account's ID, currency and reporting timezone, then enable acquisition for that connection.
- **Pause:** stop future normal lookups/acquisition through the existing connection checks. Existing reports remain stored; a report already in flight must pass the existing publication fence before it can publish.
- **Retry failed jobs:** return terminal failed windows to the queue after the cause has been repaired. Active leases, previous report generations and upstream quota cooldowns remain intact. Healthy reports are not reset.

The page contains no token field, commission approval, payment action or self-grant. A trusted operator must first register the account and staff account grants. That provisioning interface remains separate work. Enabling a connection does not itself install or start the worker; the flags and running acquisition process described in `marketing-sync-runtime.md` remain necessary.

## Boundaries and implementation

| Responsibility | Location |
| --- | --- |
| Typed scope, snapshot and commands | `src/contracts/marketing-connections.ts` |
| Current staff and account grant checks, revisions, audit, recovery writes | `src/server/modules/marketing-ads/connections.ts` |
| Exact configured account metadata GET | `src/server/modules/marketing-ads/facebook/verify-account.ts` |
| Shared request pacing and persisted cooldown | `src/server/modules/marketing-ads/facebook/quota.ts` |
| Same-origin HTTP boundary | `src/server/http/marketing-connections.ts` |
| Native route | `app/api/v1/staff/ads/connections/route.ts` |
| Lazy server composition | `src/server/modules/identity/runtime.ts` |
| Shared UI and native transport | `src/features/marketing-ads/ConnectionsPanel.tsx` |
| Development simulation | `dev/ad-registration-transport.ts`, `dev/AdRegistrationPreview.tsx` |

`GET /api/v1/staff/ads/connections` accepts the current actor ID and permission revision. `POST` accepts those fields plus connection ID, connection revision, action (`verify`, `pause`, `retry`) and a UUID idempotency key. The native route remains behind `LABSD_MARKETING_ENABLED`, existing identity namespace binding and authenticated staff authorization.

Read access is limited to explicitly granted accounts. Mutations require fresh staff authentication and `manage_partners`; staff identity and revision are checked against the submitted scope. The native service checks current staff rights, account grant and connection revision both before and after source I/O. Source HTTP occurs outside SQL transactions. A concurrent revocation or connection change prevents the final write. Canonical command hashes reject changed payloads under an existing idempotency key; replay is permitted only after current authority is checked again.

The verifier consumes existing server profiles and injected environment references. Its only network operation is a bounded GET to Graph v25.0 `act_<configured-account-id>` for `id,account_id,currency,timezone_name`. It uses the same persisted quota and binding checks as normal reads, with a narrowly scoped exception allowing this metadata check while a connection is paused/unverified. It does not bypass the quota or allow arbitrary URLs. The ordinary ad reader and worker still require enabled, verified connections.

Successful metadata verification proves account metadata access and the identity/currency/timezone match **only**. It does not prove every report permission, ad's availability or a current live entitlement. The first real report remains independently checked by the ad reader. Neither stored verification time nor an enabled switch is a claim that the worker is currently healthy.

Malformed or unavailable optional Facebook configuration yields an unconfigured state in this section; it does not prevent staff from pausing an existing account. Public errors contain safe categories, never source response bodies or credentials. The read response excludes namespace and secret references.

## Persistence

Additive migration `0021_marketing_connection_audit.sql` adds a successful verification record on `portal_marketing.connections` and immutable `connection_commands`. Account-level commands have their own audit because they may affect several partners; fabricating a partner ID in the existing partner audit would misrepresent the action.

Migration 0021 was applied only to the owned isolated PostgreSQL test database. Earlier migration checksums were verified and remain unchanged. No staff grant or connection is inserted/enabled by the migration. Rollback for exposure is to stop the worker or disable the feature while retaining additive records. No destructive down migration was run.

## Verification and limits

- 362 unit cases / 41 files and 197 integration cases / 20 files passed across the project. Final affected backend run: 8 connection lifecycle cases passed after the configured-account display check was tightened.
- Native integration uses real authentication, PostgreSQL, HTTP/service composition and the Graph reader, with upstream fetch replaced by synthetic responses only.
- Covers wrong account/currency/timezone, current scope and account grants, revocation during source I/O, invalid optional configuration, stale revisions, replay conflicts, same-origin HTTP, immutable audit, terminal-only retry, active lease/cooldown retention and unchanged financial revisions.
- Three UI cases cover lazy loading/result state, stable command retry and wrong-scope/unmount cancellation. Typecheck and production build with development fixture exclusion passed.
- Existing `/ops-preview/ads` browser: pause changed the available account selection; verify reopened the account and displayed its check time. Day/Dark inspected at a measured 1016 CSS-pixel viewport without document or connection-row horizontal overflow. This is synthetic UI evidence, not a native live-account or mobile/200% zoom acceptance claim.

Still open: trusted account/grant provisioning; real permission and report proof; durable failed-verification attempt history; worker health summary and operational supervision; archived-ad history and old-window retirement; P04 authorized partner metric projections and exact range semantics; readiness-based Shopee/Lazada/TikTok adapters. Original account/document journeys, financial source integration, load/recovery and independent release review remain part of the full plan.
