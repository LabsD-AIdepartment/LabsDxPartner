import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { createSaleDashboardShopVideoOwner: createOwner, createTikTokQuotaGovernor } = await import(
  pathToFileURL(join(process.argv[2], 'index.mjs')).href
);
const quota = createTikTokQuotaGovernor({
  appPerSecond: 2,
  shopPerSecond: 1,
  eval: async () => [0, 400],
});
assert.deepEqual(await quota.reserve({ appKey: 'synthetic-key' }, new AbortController().signal), {
  allowed: false,
  retryAfterMs: 400,
});
let connected = 0,
  queried = 0,
  calls = 0;
const token = 'synthetic-owner-smoke-token-at-least-32-chars';
const profile = {
  connectionId: 'video-1',
  namespace: 'labsd',
  shopId: 'shop-1',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
  acquisitionOwner: 'sale-dashboard',
  sourceConnectionRef: 'source-1',
};
let reservation = { allowed: true };
const options = {
  enabled: false,
  profiles: [profile],
  bindings: [{ sourceConnectionRef: 'source-1', connectedAccountId: 7, credentialId: 9 }],
  clients: [
    { tokenSha256: createHash('sha256').update(token).digest('hex'), connectionIds: ['video-1'] },
  ],
  connect() {
    connected++;
    return {
      query: async () => {
        queried++;
        return {
          rows: [
            {
              shopId: 'shop-1',
              currency: 'THB',
              timezone: 'Asia/Bangkok',
              shopCipher: 'synthetic-cipher',
              expiresAt: new Date('2026-09-11T00:00:00Z'),
              appKeyEnc: Buffer.from('synthetic-key'),
              appSecretEnc: Buffer.from('synthetic-secret'),
              accessTokenEnc: Buffer.from('synthetic-token'),
            },
          ],
        };
      },
      decryptToken: (b) => b.toString(),
      now: () => Date.parse('2026-09-10T00:00:00Z'),
      reserveRequest: async (scope) => {
        assert.deepEqual(scope, {
          connectionId: 'video-1',
          appKey: 'synthetic-key',
          shopCipher: 'synthetic-cipher',
        });
        return reservation;
      },
      fetch: async (url) => {
        calls++;
        return Response.json(
          new URL(url).pathname === '/authorization/202309/shops'
            ? {
                code: 0,
                request_id: 'auth',
                data: { shops: [{ id: 'shop-1', cipher: 'synthetic-cipher', region: 'TH' }] },
              }
            : {
                code: 0,
                request_id: 'video',
                data: {
                  latest_available_date: '2026-09-09',
                  total_count: 0,
                  videos: [],
                  next_page_token: '',
                },
              },
        );
      },
    };
  },
};
const request = (auth = token, action = 'verify') =>
  new Request('https://owner.example.test/internal/partner/shop-videos', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth },
    body: JSON.stringify({
      requestId: randomUUID(),
      connectionId: 'video-1',
      sourceConnectionRef: 'source-1',
      action,
      ...(action === 'collect'
        ? { period: { from: '2026-09-09', toExclusive: '2026-09-10' } }
        : {}),
    }),
  });
assert.equal((await createOwner(options)(request())).status, 404);
assert.equal(connected, 0);
const handler = createOwner({ ...options, enabled: true });
assert.equal(connected, 1);
assert.equal((await handler(request('synthetic-wrong-service-credential-at-least32'))).status, 401);
assert.equal(queried, 0);
let response = await handler(request());
assert.equal(response.status, 200);
assert.equal((await response.json()).result.accountId, 'shop-1');
assert.equal(queried, 1); // verifier pins one snapshot across both calls
assert.equal(calls, 2);
response = await handler(request(token, 'collect'));
assert.equal(response.status, 200);
assert.equal((await response.json()).result.completeness, 'complete');
assert.equal(calls, 3);
reservation = { allowed: false, retryAfterMs: 86400000 };
response = await handler(request());
assert.equal(response.status, 503);
assert.deepEqual(await response.json(), { code: 'throttled', retryAfterMs: 86400000 });
assert.equal(calls, 3);
reservation = undefined;
response = await handler(request());
assert.equal(response.status, 503);
assert.equal((await response.json()).code, 'temporary');
assert.equal(calls, 3);
assert.throws(
  () => createOwner({ ...options, enabled: true, connect: () => ({ reserveRequest: null }) }),
  /Invalid shop video owner configuration/,
);
console.log(
  JSON.stringify({
    disabled: true,
    authorization: true,
    verify: true,
    collect: true,
    quotaDenied: true,
    malformedQuotaDenied: true,
    upstreamCalls: calls,
  }),
);
