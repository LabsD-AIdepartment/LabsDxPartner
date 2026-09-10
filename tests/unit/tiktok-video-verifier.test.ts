// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createShopVideoVerifier } from '@/server/modules/marketing-ads/tiktok-shop/video-verifier';
import { AUTHORIZED_SHOPS_PATH } from '@/server/modules/marketing-ads/tiktok-shop/video-transport';
import { SHOP_VIDEO_PATH } from '@/server/modules/marketing-ads/tiktok-shop/video-collector';

const profile = {
  connectionId: 'shop-one',
  namespace: 'labsd',
  shopId: 'shop-id',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
  acquisitionOwner: 'sale-dashboard' as const,
  sourceConnectionRef: 'owner-shop-1',
};
const credential = {
  shopId: 'shop-id',
  appKey: 'synthetic-key',
  appSecret: 'synthetic-secret',
  accessToken: 'synthetic-token',
  shopCipher: 'synthetic-cipher',
};
const now = () => Date.parse('2026-09-10T03:00:00Z');
const shops = () => ({
  code: 0,
  request_id: 'auth-proof',
  data: {
    shops: [
      { id: 'shop-id', cipher: credential.shopCipher, region: 'TH' },
      { id: 'other-shop', cipher: 'private-other-cipher', region: 'TH' },
    ],
  },
});
const report = () => ({
  code: 0,
  request_id: 'analytics-proof',
  data: { videos: [], total_count: 0, latest_available_date: '2026-09-09', next_page_token: '' },
});
function setup(auth: unknown = shops(), analytics: unknown = report()) {
  const resolve = vi.fn().mockResolvedValue({ ...credential });
  const beforeRequest = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      Response.json(new URL(String(url)).pathname === AUTHORIZED_SHOPS_PATH ? auth : analytics),
    );
  const deps = { credential: resolve, beforeRequest, fetch: fetcher, now };
  return {
    resolve,
    beforeRequest,
    fetcher,
    deps,
    verifier: createShopVideoVerifier([profile], deps),
  };
}
const signal = () => new AbortController().signal;
describe('TikTok authorized-shop and video Analytics verification', () => {
  it('signs both exact endpoints, checks both scopes by reads, pins one credential and exposes only safe proof', async () => {
    const f = setup();
    const proof = await f.verifier.verify(profile.connectionId, signal());
    expect(proof).toMatchObject({
      accountId: 'shop-id',
      capability: 'tiktok.shop_video',
      marketPolicy: 'TH-v1',
      reportReady: true,
      authorizationRequestId: 'auth-proof',
      analyticsRequestId: 'analytics-proof',
    });
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.beforeRequest).toHaveBeenCalledTimes(2);
    expect(f.fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      AUTHORIZED_SHOPS_PATH,
      SHOP_VIDEO_PATH,
    ]);
    for (const [raw, init] of f.fetcher.mock.calls) {
      const url = new URL(String(raw));
      const sign = url.searchParams.get('sign');
      url.searchParams.delete('sign');
      const input =
        url.pathname +
        [...url.searchParams.keys()]
          .sort()
          .map((k) => k + url.searchParams.get(k))
          .join('');
      expect(sign).toBe(
        createHmac('sha256', credential.appSecret)
          .update(credential.appSecret + input + credential.appSecret)
          .digest('hex'),
      );
      expect(init).toMatchObject({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'x-tts-access-token': credential.accessToken },
      });
      expect(url.searchParams.has('shop_cipher')).toBe(url.pathname === SHOP_VIDEO_PATH);
    }
    for (const privateValue of [
      credential.appKey,
      credential.appSecret,
      credential.accessToken,
      credential.shopCipher,
      'other-shop',
      'private-other-cipher',
    ])
      expect(JSON.stringify(proof)).not.toContain(privateValue);
  });
  it.each(['missing', 'cipher', 'duplicate', 'region'])(
    'rejects %s shop identity before an Analytics request',
    async (kind) => {
      const auth = shops();
      if (kind === 'missing') auth.data.shops = [];
      if (kind === 'cipher') auth.data.shops[0].cipher = 'different';
      if (kind === 'duplicate') auth.data.shops.push({ ...auth.data.shops[0] });
      if (kind === 'region') auth.data.shops[0].region = 'US';
      const f = setup(auth);
      await expect(f.verifier.verify(profile.connectionId, signal())).rejects.toMatchObject({
        code: kind === 'region' ? 'invalid-source' : 'access',
      });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('does not confuse authorization success with Analytics entitlement', async () => {
    const f = setup(shops(), { code: 106001, message: 'private upstream detail' });
    await expect(f.verifier.verify(profile.connectionId, signal())).rejects.toMatchObject({
      code: 'access',
      message: 'Source read: access',
    });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it('permits a readable but delayed report while recording that its data is not ready', async () => {
    const delayed = report();
    delayed.data.latest_available_date = '2026-09-08';
    expect(
      await setup(shops(), delayed).verifier.verify(profile.connectionId, signal()),
    ).toMatchObject({ reportReady: false, latestAvailableDate: '2026-09-08' });
  });
  it('rejects malformed or future-dated evidence and unsupported configured market policies', async () => {
    const future = report();
    future.data.latest_available_date = '2026-09-10';
    await expect(
      setup(shops(), future).verifier.verify(profile.connectionId, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    await expect(
      setup({ code: 0 }).verifier.verify(profile.connectionId, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    const f = setup();
    await expect(
      createShopVideoVerifier([{ ...profile, currency: 'USD' }], f.deps).verify(
        profile.connectionId,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('honors quota rejection without a fetch and preserves long Retry-After from the provider', async () => {
    const f = setup();
    f.beforeRequest.mockRejectedValueOnce(new Error('quota owner unavailable'));
    await expect(f.verifier.verify(profile.connectionId, signal())).rejects.toMatchObject({
      code: 'temporary',
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    const limited = setup();
    limited.fetcher.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '864000' } }),
    );
    await expect(limited.verifier.verify(profile.connectionId, signal())).rejects.toMatchObject({
      code: 'throttled',
      retryAfterMs: 864000000,
    });
  });
  it('cancels a stalled credential resolution before any source request', async () => {
    const f = setup();
    const controller = new AbortController();
    f.resolve.mockImplementation(() => new Promise(() => {}));
    const work = f.verifier.verify(profile.connectionId, controller.signal);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
