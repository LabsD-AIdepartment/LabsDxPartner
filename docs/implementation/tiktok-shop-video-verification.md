# TikTok Shop Video — source verification and native lifecycle

D074,2026-09-10. Builds on metadata provisioning and daily acquisition. The source
verifier and native staff command service are implemented and tested together.
They are not installed as a live owner bridge or exposed by a newly enabled route.
No actual TikTok account was accessed or enabled during this batch.

Follow-up: [D075 owner bridge and worker](tiktok-shop-video-owner.md) implements
the two service peers and the Portal process. Its source-side installation and
real account activation remain pending; the D074 evidence below is unchanged.

## What verification proves

The official [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/get-authorized-shops-202309)
endpoint requires seller.authorization.info and returns the seller-authorized shops,
including ID,cipher and region. It does not itself prove video Analytics access.
The separate [Get Shop Video Performance List](https://partner.tiktokshop.com/docv2/page/get-shop-video-performance-list-202605)
endpoint requires data.shop_analytics.public.read. Its calendar dates use the shop's
registered timezone and LOCAL currency is the shop's local currency.

The verifier performs both fixed signed GETs:

1. Resolve one bounded credential snapshot from the existing source owner for the
   configured shop. Pin that snapshot for the entire verification attempt.
2. Fetch `/authorization/202309/shops` and require exactly one matching shop ID,
   the expected cipher and TH region. A different shop, stale cipher, missing or
   duplicate matching identity fails before the Analytics request.
3. Fetch one page of `/analytics/202605/shop_videos/performance` for the completed
   previous shop day. Validate source success, report shape/counts, observed GMV
   currency and watermark. Only a successful Analytics read proves this capability.
4. Return a bounded internal proof with configured identity/owner reference,
   configuration digest, request IDs, probe interval, watermark and checked time.
   No token,appsecret,cipher,other-shop record or video payload leaves this boundary.

This first market policy is explicitly **TH-v1: THB / Asia/Bangkok**. Currency and
registered timezone are not claimed as fields returned by authorized-shops. The
configured values must match this supported policy, authorized region must beTH,
and any sampled GMV currency must beTHB. Other markets require a separate verified
policy and tests; do not silently infer arbitrary settings from a region code.

`reportReady:false` means the Analytics endpoint is readable but its watermark
has not caught up to the requested completed day. The probe is not a full-shop
collection, an exact current total or a promise of realtime data. Normal collector
completeness rules still apply before publication. Empty valid reports can prove
read access; missing metrics remain unavailable, not invented zeros.

## Shared transport and ownership

`video-transport.ts` reuses signing,fixed-host,15-second call timeout,2MB body bound,
no-redirect handling,quota callback,error normalization and Retry-After logic for
two strictly allowed request shapes. The existing public video transport port
still accepts only video requests; it cannot be used to call authorization or an
arbitrary URL/path/query. Authorization requests omit shop_cipher in their query.
The source token stays in the x-tts-access-token header. The whole verification
has a20-second abort budget, including a stalled credential resolver.

The injected credential callback resolves the configured owner shop reference.
Its owner must already verify the app/shop relationship and enforce app/account
quota before each call. Source reads are outside portal transactions. This code
never rotates a token, installs a credential store, bypasses quota or exposes an
API for returning source credentials to a browser. The eventual restricted owner
service is still required; constructor injection is not a deployed bridge.

## Native staff lifecycle

`createShopVideoLifecycle(access,verifier)` uses the existing ConnectionCommand
and ConnectionResult contracts, native access wrapper, grant tables, immutable
connection command audit and partner metric revisions. It handles:

- Verify: check fresh staff session/manage_partners, exact TikTok capability,
  current grant and connection revision before source I/O. Afterwards recheck all
  of them with a short connection update lock, bind the proof to the same configured
  identity/digest captured before I/O, and require a checked timestamp no more than
  two minutes old or in the future. Only then enable and persist the safe proof.
- Pause: disable the granted shop; works with a null verifier so unavailable source
  configuration cannot prevent stopping acquisition. Member evidence becomes stale.
- Retry: requeue unleased failed reports within the active horizon; preserve the
  account cooldown and access/schema holds. Those account problems require a new
  successful Verify rather than a Retry shortcut. Normal temporary retries remain
  automatic under D072.

Duplicate commands replay one persisted result; current authorization is checked
before replay. Concurrent verify commands may duplicate read-only probes, but
only one command write is recorded. A concurrent grant revocation or connection
revision change prevents enablement. The lifecycle has no live HTTP/runtime factory
installed yet; composition must not substitute a fake verifier for missing source
ownership. The existing Facebook lifecycle remains unchanged.

## Evidence and rollout

Official public document JSON was captured in D074 project-local evidence; browser
fetch of the SPA either timed out or returned its JavaScript shell, so the public
document-detail endpoint supplied the full schemas. No account credential was
needed or read. The on-disk docs and source module hashes identify the exact proof.

Unit tests cover both signatures/headers/paths,pinned credential,quota calls,wrong
shop/cipher/region,missing/duplicate identity,Analytics denial,late/malformed source,
long throttle minimum and cancellation. Native PostgreSQL tests cover the full
verify->enable->scheduled collection->mapping->member projection->pause flow,
revocation/version races,concurrent command replay and controlled retry semantics.
Upstream responses are synthetic; SQL/auth/grants/collector/projection are native.
Exact final counts and any failed runs are recorded in the D074 context receipt.

No migration is needed. Rollback stops this verification entry and retains safe
proofs/audit/last-good data. Actual account entitlement,restricted source-owner
service,credential/quota runtime composition,supervised host,UI activation/native
browser acceptance,load tests and independent release review remain before live
rollout. Large-shop staging and other platforms/original project phases remain.
