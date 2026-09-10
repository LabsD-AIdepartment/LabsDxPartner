# Sale Dashboard credential adapter for TikTok Shop Video

D078 adds `createSaleDashboardVideoCredentialResolver` for installation **inside
Sale Dashboard's server**. It is implemented and tested here, but is not mounted
in that project. No real seller credentials or accounts were accessed.

## Why the source-specific adapter exists

Fresh source inspection at commit `f1af3d8b10cdc44573f391f87db2df3f17b7ec3a` found:

- `db/schema/integration.ts` owns `public.providers`, `connected_accounts` and
  `provider_credentials`; app key, app secret and access token are encrypted on
  the credential row, while `scopes.shop_cipher` identifies the authorized shop.
- `src/integrations/tiktok/tokenManager.ts` provides per-credential configuration
  and refresh functions. It permits environment app credentials only when both
  stored app fields are absent. The new service adapter requires stored app
  credentials and does not take that fallback.
- `src/lib/integrations/tokenResolver.ts` supports account-scoped access-token
  lookup. Existing `syncShops.ts` reads token, cipher and app configuration in
  separate calls. The bridge instead reads them in one SQL statement, pinned to
  the operator's exact account and credential IDs.
- `client.ts` implements request-local retry/backoff. `src/lib/rateLimit.ts` is
  an inbound HTTP limiter that fails open when Redis is unavailable. Neither is
  evidence of a shared outbound app/shop quota governor. The bridge must not
  pass that inbound limiter as its required `beforeRequest` quota reservation.

These are source-code findings, not claims about deployed configuration. Refresh
functions exist; searches of `src`, `app` and `scripts` did not establish the
active scheduling caller. Verify that wiring before enabling unattended imports.

## Binding and lifecycle

For every existing video profile, the owner supplies metadata:

```ts
{
  sourceConnectionRef: 'source-shop-1',
  connectedAccountId: 7,
  credentialId: 9,
}
```

IDs above are illustrative. They are trusted owner configuration, never fields
accepted from a browser or derived from an arbitrary request URL. The bindings
must cover exactly the configured profiles; duplicate references/accounts are
rejected. Multiple shops can share a credential only if their configured
bindings and live source rows actually do so.

The adapter accepts the source `pool.query` port and existing `decryptToken`
function. Bind methods when passing them, for example
`query: (config) => pool.query(config)`. Do not supply the Portal database or copy
source encryption keys into the Portal. This module has no connection-string
configuration and performs no reads at construction.

Each resolution executes a parameterized query with a 5-second driver timeout.
The provider, account and credential must all be active; both provider IDs must
be TikTok. Account ID, credential ID and external shop ID must all match. Currency
and timezone must match the configured profile. Missing/ambiguous rows, absent or
corrupt encrypted fields and tokens expiring within 20 seconds are rejected.
That margin covers the existing 20-second verification budget. A later provider
revocation can still reject an in-flight request; existing collection failure
handling preserves last-good data.

All three secret fields are decrypted from the same query snapshot. Every new
resolution rereads source state, so a later token refresh is picked up without
restarting the adapter. Verification already pins this snapshot for its two
upstream calls. There is no credential cache, secret export, database write,
refresh request or provider-level environment fallback. Cancellation prevents
subsequent decryption/use; the injected driver must honor its query timeout even
when cancellation does not terminate server-side SQL immediately.

Database failures become the existing safe `temporary` category. Identity,
expiry and decryption failures become `access`; raw errors or schema validation
values do not leave this boundary. Logs must continue to exclude tokens and
SQL result rows. The source token manager remains the only refresh writer.

## Installation order and remaining work

1. Package the existing owner handler, collector and this adapter for the source
   service; mount only the existing restricted M2M protocol with its flags off.
2. Connect the source pool and decrypt function; resolve the operator bindings
   from actual source metadata. Prove the deployed refresh scheduling path.
3. Supply a shared outbound quota mechanism whose scope covers all callers of
   the same app/shop. Missing quota service must hold collection, not allow it.
4. Provision the separate M2M service identity, verify a real shop's Analytics
   entitlement, then enable that shop and observe the scheduled import.

No production source service, quota governor, scheduler installation or platform
entitlement is established by this batch. Source refresh failures are not repaired
by adding another Portal refresh loop. This is TikTok Shop Video Analytics, not
TikTok Ads or GMV Max and not a commission calculation.

## Verification

Unit tests cover lazy construction, exact binding, rotation, unknown shops,
identity/currency/timezone mismatch, expiry, corrupt/missing ciphertext, missing
or ambiguous rows, safe errors and cancellation. The PostgreSQL test creates
synthetic source-shaped tables inside a rollback-only transaction on the guarded
isolated database. It executes the actual SQL through the owner handler/client,
then revokes/rebinds source state and verifies that no further upstream calls
occur. Source decryption and upstream TikTok responses are synthetic; this does
not prove the production encryption key, driver cancellation or actual API access.

D079 follow-up: [the installable owner package](shop-video-owner-package.md) now
bundles this adapter and its dependencies. The refresh caller was found in the
top-level `worker/index.ts`, outside D078's search roots: scheduling every six
hours and refreshing credentials within 48 hours of expiry. Source wiring is
confirmed; actual deployed execution remains unverified. Quota and source
installation remain open.
