// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createShopVideoOwnerHandler } from '@/server/modules/marketing-ads/tiktok-shop/owner-handler';
import { createShopVideoOwnerClient } from '@/server/modules/marketing-ads/tiktok-shop/owner-client';
import {
  OWNER_PATH,
  boundedOwnerJson,
} from '@/server/modules/marketing-ads/tiktok-shop/owner-protocol';
import { AUTHORIZED_SHOPS_PATH } from '@/server/modules/marketing-ads/tiktok-shop/video-transport';
import { createConfiguredShopVideoWorker } from '@/server/modules/marketing-ads/tiktok-shop/video-composition';
import { configuredShopVideoOwner } from '@/server/modules/marketing-ads/tiktok-shop/owner-runtime';

const profile = {
  connectionId: 'shop-one',
  namespace: 'labsd',
  shopId: 'shop-id',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
  acquisitionOwner: 'sale-dashboard' as const,
  sourceConnectionRef: 'owner-shop-1',
};
const token = 'synthetic-service-credential-at-least-32-characters';
const period = { from: '2026-09-09', toExclusive: '2026-09-10' };
function fixture() {
  const sourceFetch = vi.fn<typeof fetch>().mockImplementation(async (raw) =>
    Response.json(
      new URL(String(raw)).pathname === AUTHORIZED_SHOPS_PATH
        ? {
            code: 0,
            request_id: 'authorization',
            data: { shops: [{ id: 'shop-id', cipher: 'synthetic-cipher', region: 'TH' }] },
          }
        : {
            code: 0,
            request_id: 'performance',
            data: {
              videos: [],
              total_count: 0,
              latest_available_date: '2026-09-09',
              next_page_token: '',
            },
          },
    ),
  );
  const resolve = vi.fn().mockResolvedValue({
    shopId: 'shop-id',
    appKey: 'synthetic-key',
    appSecret: 'synthetic-secret',
    accessToken: 'synthetic-seller-token',
    shopCipher: 'synthetic-cipher',
  });
  const handler = createShopVideoOwnerHandler(
    [profile],
    [
      {
        tokenSha256: createHash('sha256').update(token).digest('hex'),
        connectionIds: [profile.connectionId],
      },
    ],
    {
      credential: resolve,
      beforeRequest: async () => {},
      fetch: sourceFetch,
      now: () => Date.parse('2026-09-10T04:00:00Z'),
    },
  );
  const wire = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url, init) => handler(new Request(url, init)));
  return {
    handler,
    wire,
    resolve,
    sourceFetch,
    client: createShopVideoOwnerClient([profile], 'https://source.example.test', token, wire),
  };
}
const signal = () => new AbortController().signal;
describe('restricted TikTok source-owner protocol', () => {
  it('keeps status and pause composition available when owner configuration is disabled or invalid', () => {
    expect(configuredShopVideoOwner({})).toBeNull();
    expect(
      configuredShopVideoOwner({
        LABSD_MARKETING_ENABLED: '1',
        LABSD_TIKTOK_VIDEO_ENABLED: '1',
        LABSD_TIKTOK_VIDEO_PROFILES: 'invalid',
      }),
    ).toBeNull();
    expect(
      configuredShopVideoOwner({
        LABSD_MARKETING_ENABLED: '1',
        LABSD_TIKTOK_VIDEO_ENABLED: '1',
        LABSD_TIKTOK_VIDEO_PROFILES: JSON.stringify([profile]),
        LABSD_TIKTOK_OWNER_ORIGIN: 'https://owner.example.test',
        LABSD_TIKTOK_OWNER_SERVICE_TOKEN: token,
      })?.configured(profile.connectionId),
    ).toEqual(profile);
  });
  it('retains proxy throttling and treats a non-JSON gateway outage as retryable', async () => {
    for (const status of [429, 502, 503]) {
      const client = createShopVideoOwnerClient(
        [profile],
        'https://source.example.test',
        token,
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response('<html>upstream unavailable</html>', {
            status,
            headers: { 'retry-after': '864000' },
          }),
        ),
      );
      await expect(client.collect(profile.connectionId, period, signal())).rejects.toMatchObject({
        code: status === 429 ? 'throttled' : 'temporary',
        retryAfterMs: 864000000,
      });
    }
  });
  it('runs both owner operations without returning or transmitting seller credentials to the portal', async () => {
    const f = fixture();
    expect(await f.client.verify(profile.connectionId, signal())).toMatchObject({
      accountId: profile.shopId,
    });
    expect(await f.client.collect(profile.connectionId, period, signal())).toMatchObject({
      completeness: 'complete',
      videos: [],
    });
    expect(f.sourceFetch).toHaveBeenCalledTimes(3);
    for (const [url, init] of f.wire.mock.calls) {
      expect(new URL(String(url)).pathname).toBe(OWNER_PATH);
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token },
      });
      expect(JSON.stringify(init)).not.toContain('synthetic-seller-token');
      expect(JSON.stringify(init)).not.toContain('synthetic-secret');
    }
  });
  it('rejects missing credentials, browser requests and unexpected routes without source access', async () => {
    const f = fixture();
    expect(
      (await f.handler(new Request('https://source.example.test' + OWNER_PATH, { method: 'POST' })))
        .status,
    ).toBe(401);
    expect(
      (
        await f.handler(
          new Request('https://source.example.test' + OWNER_PATH, {
            method: 'POST',
            headers: { Origin: 'https://browser.test', Authorization: 'Bearer ' + token },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await f.handler(new Request('https://source.example.test/arbitrary', { method: 'POST' })))
        .status,
    ).toBe(404);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it('enforces allowlisted source identity even for an authenticated service caller', async () => {
    const f = fixture();
    const altered = createShopVideoOwnerClient(
      [{ ...profile, sourceConnectionRef: 'another-owner-shop' }],
      'https://source.example.test',
      token,
      f.wire,
    );
    await expect(altered.verify(profile.connectionId, signal())).rejects.toMatchObject({
      code: 'access',
    });
    const other = createShopVideoOwnerClient(
      [{ ...profile, connectionId: 'ungranted' }],
      'https://source.example.test',
      token,
      f.wire,
    );
    await expect(other.verify('ungranted', signal())).rejects.toMatchObject({ code: 'access' });
    expect(f.sourceFetch).not.toHaveBeenCalled();
  });
  it('rejects swapped correlation, shop and period responses instead of publishing them', async () => {
    for (const change of ['requestId', 'shop', 'period']) {
      const f = fixture();
      f.wire.mockImplementation(async (url, init) => {
        const data = await (await f.handler(new Request(url, init))).json();
        if (change === 'requestId') data.requestId = '00000000-0000-4000-8000-000000000001';
        if (change === 'shop') data.result.connection.shopId = 'other';
        if (change === 'period') data.result.period.from = '2026-09-08';
        return Response.json(data);
      });
      await expect(f.client.collect(profile.connectionId, period, signal())).rejects.toMatchObject({
        code: 'invalid-source',
      });
    }
  });
  it('copies requested periods before awaiting the owner', async () => {
    const f = fixture();
    const mutable = { ...period };
    f.wire.mockImplementation(async (url, init) => {
      mutable.from = '2026-09-01';
      return f.handler(new Request(url, init));
    });
    expect((await f.client.collect(profile.connectionId, mutable, signal())).period).toEqual(
      period,
    );
  });
  it('preserves source cooldowns, cancels stalled reads and rejects oversized responses', async () => {
    const f = fixture();
    f.sourceFetch.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '864000' } }),
    );
    await expect(f.client.collect(profile.connectionId, period, signal())).rejects.toMatchObject({
      code: 'throttled',
      retryAfterMs: 864000000,
    });
    f.wire.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const work = f.client.verify(profile.connectionId, controller.signal);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      boundedOwnerJson(new Response('x'.repeat(4097)).body, signal(), 4096),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });
  it('rejects unsafe origins and unknown proxy parameters', async () => {
    for (const origin of [
      'http://source.example.test',
      'https://user:password@source.test',
      'https://source.test/path',
      'https://source.test?token=x',
    ])
      expect(() => createShopVideoOwnerClient([profile], origin, token)).toThrow();
    const f = fixture();
    const response = await f.handler(
      new Request('https://source.example.test' + OWNER_PATH, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: '00000000-0000-4000-8000-000000000001',
          action: 'verify',
          connectionId: profile.connectionId,
          sourceConnectionRef: profile.sourceConnectionRef,
          url: 'https://attacker.test',
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it('keeps disabled composition free of configuration, database and network access', () => {
    expect(
      createConfiguredShopVideoWorker(null as never, {}, async () => {
        throw Error('must not run');
      }),
    ).toBeNull();
  });
});
