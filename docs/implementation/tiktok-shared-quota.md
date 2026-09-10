# Shared TikTok outbound quota

D080 implements `createTikTokQuotaGovernor` in owner package version 0.2.0.
It is tested against an owned Redis process. It has **not** been integrated into
Sale Dashboard's existing callers or enabled on production.

## What it controls

The operator supplies explicit `appPerSecond` and `shopPerSecond` budgets, both
integers between 1 and 10,000, with shop budget no greater than app budget. These
are application traffic policies, not claims about TikTok's actual quota or
entitlement. Choose them from the approved source app's limits and observed load.
A token bucket permits an initial burst up to its capacity, then refills at its
configured per-second rate; it is not a strict rolling-window request counter.

Every outbound signed attempt reserves the app bucket and, when a shop is known,
its shop bucket in one atomic Redis script. If either denies, neither is charged.
This allows separate processes and consumers to share the same budget. Denied
calls return a retry delay; successful reservations are not refunded if the
subsequent API call fails, since the platform may have received the request.

Keys use a fixed versioned namespace and SHA-256 of app key/shop cipher, with the
app hash as a Redis Cluster hash tag. Both buckets share one cluster slot. No
seller access token or app secret is accepted by the governor, stored or logged.
Different Portal partner IDs must not create separate app quotas. An app-only
request still consumes the shared app budget.

Redis supplies time. Integer milli-tokens avoid fractional accumulation across
callers. Idle keys expire after at least 60 seconds, longer than the one-second
full-refill horizon. If server time moves backward, the stored later timestamp is
preserved and retry/expiry account for that gap. Forward time can refill up to
capacity. This is traffic control, not an accounting or financial ledger.

Each bucket records its policy. Another caller using a different rate fails
closed rather than silently increasing capacity. To change policy, coordinate
all callers, pause them until old idle keys expire, then resume with the same new
values. Do not put the policy in the key name, which would create parallel
budgets during rollout. A corrupt/partial state or unavailable Redis produces the
existing safe `temporary` error, never an allow response.

## Source integration

```ts
import { createTikTokQuotaGovernor } from '@labsd/shop-video-owner';

const quota = createTikTokQuotaGovernor({
  appPerSecond: configuredAppBudget,
  shopPerSecond: configuredShopBudget,
  eval: (script, numberOfKeys, ...args) =>
    sourceRedis.eval(script, numberOfKeys, ...args),
});
```

Use the source Redis connection with a bounded command timeout, bounded retries
and offline queue disabled. The governor caps waiting at two seconds and honors
parent cancellation. If a timed-out reservation completes late it may consume
capacity without making an API call; it must never cause a late upstream fetch.
Construction itself performs no I/O and no default Redis connection is created.

The source owner facade can set `reserveRequest: quota.reserve`. Its callback now
receives `{ connectionId, appKey, shopCipher }` from the exact credential snapshot
used to sign that call. It receives no access token or app secret. This requires
resolving the credential before quota reservation; request validation and service
authorization still happen first, and quota still precedes every upstream fetch.
Verification retains its pinned credential across both requests.

The same governor must be called by Sale Dashboard's `callTikTok` before **each**
signed attempt, including retries, using its current app key and optional shop
cipher. Existing native read callers cannot keep bypassing it while the owner
bridge claims to share their quota. On denial those callers must wait the returned
delay with cancellation or return a safe retryable result. Do not use the inbound
HTTP/IP limiter as a substitute. Token refresh uses a separate auth-host path;
this governor does not replace or start the source refresh worker.

## Rollout order

1. Commit and freeze the Portal package dependency, then install its exact archive
   digest in a source branch. Source `CLAUDE.md` hard rule9 prohibits dependent
   cross-lane work against an uncommitted upstream; this batch leaves that source
   tree unchanged.
2. Wire the source's signed client and owner handler to one governor and consistent
   app/shop policies, with the shared-quota and owner features initially off.
3. Verify source concurrent callers, failure/recovery and cancellation under real
   source runtime tests; prove that no signed path bypasses the governor when on.
4. Enable coordinated quota enforcement, then separately enable an entitled owner
   connection. Observe token-refresh worker health, provider throttles and data
   freshness. Redis quota enforcement alone does not prove API entitlement.

Portal already preserves provider Retry-After/cooldown. This local governor is an
additional budget, not permission to ignore platform responses. No new UI setting
or routine manual approval is added for celebrities or normal marketing imports.

## Verification and limits

Real Redis tests start a dedicated loopback process with persistence disabled,
use two governor instances and concurrent requests, verify app/shop isolation,
refill, no app charge on shop denial, mismatched-policy and corrupt-state rejection,
then stop that owned process. Managed Redis is never touched. Tests require
`redis-server` and `redis-cli` on PATH; logs/receipts remain project-local.

Unit tests cover malformed store replies, safe errors, cancellation and private
key scope. The unpacked package's Node smoke and public type consumer cover the
new export and propagation of exact app/shop identity. This proves the package
primitive, not source integration, Redis failover behavior, fairness under load,
actual platform limits or production deployment.
