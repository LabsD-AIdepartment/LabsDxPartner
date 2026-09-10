// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createShopVideoTransport,
  type ShopVideoCredential,
} from '@/server/modules/marketing-ads/tiktok-shop/video-transport';
import {
  SHOP_VIDEO_PATH,
  createShopVideoCollector,
  type VideoRequest,
} from '@/server/modules/marketing-ads/tiktok-shop/video-collector';
const connection = {
  connectionId: 'shop-one',
  namespace: 'test',
  shopId: 'shop-id',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
};
// Synthetic sentinels only; never use credentials from the source project in tests.
const secrets: ShopVideoCredential = {
  shopId: 'shop-id',
  appKey: 'sample-key',
  appSecret: 'sample-secret',
  accessToken: 'sample-token',
  shopCipher: 'sample-cipher',
};
const now = () => Date.parse('2026-09-10T03:00:00Z');
const request: VideoRequest = {
  connectionId: 'shop-one',
  path: SHOP_VIDEO_PATH,
  query: {
    start_date_ge: '2026-09-01',
    end_date_lt: '2026-09-10',
    page_size: '100',
    sort_field: 'gmv',
    sort_order: 'DESC',
    currency: 'LOCAL',
    account_type: 'ALL',
  },
};
const ok = () =>
  new Response(
    JSON.stringify({
      code: 0,
      request_id: 'test',
      data: {
        videos: [],
        total_count: 0,
        latest_available_date: '2026-09-09',
        next_page_token: '',
      },
    }),
  );
const signal = () => new AbortController().signal;
function setup(response = ok()) {
  const credential = vi.fn().mockResolvedValue(secrets);
  const beforeRequest = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  return {
    credential,
    beforeRequest,
    fetcher,
    send: createShopVideoTransport([connection], {
      credential,
      beforeRequest,
      fetch: fetcher,
      now,
    }),
  };
}
describe('TikTok Shop signed video transport', () => {
  it('honors an HTTP-date retry minimum longer than one day', async () => {
    const { send } = setup(
      new Response('', {
        status: 429,
        headers: { 'retry-after': 'Sat, 12 Sep 2026 03:00:00 GMT' },
      }),
    );
    await expect(send(request, signal())).rejects.toMatchObject({
      code: 'throttled',
      retryAfterMs: 172800000,
    });
  });
  it('rejects malformed JSON without forwarding response text', async () => {
    const { send } = setup(new Response('private non-json reply'));
    await expect(send(request, signal())).rejects.toMatchObject({
      code: 'invalid-source',
      message: 'Source read: invalid-source',
    });
  });
  it('signs exact GET dimensions and sends the token only in a header after quota reservation', async () => {
    const { send, fetcher, beforeRequest, credential } = setup();
    await send(request, signal());
    const [target, options] = fetcher.mock.calls[0],
      url = new URL(String(target));
    expect(url.origin).toBe('https://open-api.tiktokglobalshop.com');
    expect(url.pathname).toBe(SHOP_VIDEO_PATH);
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'x-tts-access-token': secrets.accessToken, 'content-type': 'application/json' },
    });
    expect(url.search).not.toContain(secrets.accessToken);
    expect(url.search).not.toContain(secrets.appSecret);
    const canonical =
      '/analytics/202605/shop_videos/performanceaccount_typeALLapp_keysample-keycurrencyLOCALend_date_lt2026-09-10page_size100shop_ciphersample-ciphersort_fieldgmvsort_orderDESCstart_date_ge2026-09-01timestamp1789009200';
    expect(beforeRequest.mock.calls[0][2]).toEqual({
      appKey: 'sample-key',
      shopCipher: 'sample-cipher',
    });
    const expected = createHmac('sha256', 'sample-secret')
      .update('sample-secret' + canonical + 'sample-secret')
      .digest('hex');
    expect(url.searchParams.get('sign')).toBe(expected);
    expect(credential.mock.invocationCallOrder[0]).toBeLessThan(
      beforeRequest.mock.invocationCallOrder[0],
    );
    expect(beforeRequest.mock.invocationCallOrder[0]).toBeLessThan(
      fetcher.mock.invocationCallOrder[0],
    );
  });
  it('composes the signed transport with the collector without touching a live account', async () => {
    const { send } = setup();
    const collect = createShopVideoCollector([connection], { request: send, now });
    expect(
      await collect('shop-one', { from: '2026-09-01', toExclusive: '2026-09-10' }, signal()),
    ).toMatchObject({ completeness: 'complete', videos: [] });
  });
  it.each([
    { ...request, path: '/authorization/202309/shops' },
    { ...request, query: { ...request.query, access_token: 'injected' } },
    { ...request, query: { ...request.query, shop_cipher: 'other' } },
    { ...request, query: { ...request.query, end_date_lt: '2026-11-01' } },
  ])('rejects mutated path/query before any credential read', async (raw) => {
    const { send, credential, fetcher } = setup();
    await expect(send(raw as VideoRequest, signal())).rejects.toMatchObject({
      code: 'invalid-source',
    });
    expect(credential).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('binds the credential to the configured shop', async () => {
    const { send, credential, fetcher } = setup();
    credential.mockResolvedValue({ ...secrets, shopId: 'another-shop' });
    await expect(send(request, signal())).rejects.toMatchObject({ code: 'access' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [429, 'throttled'],
    [401, 'access'],
    [403, 'access'],
    [500, 'temporary'],
    [302, 'invalid-source'],
  ] as const)('classifies HTTP %s without upstream message leakage', async (status, code) => {
    const { send } = setup(
      new Response('private source text', { status, headers: { 'retry-after': '120' } }),
    );
    await expect(send(request, signal())).rejects.toMatchObject({
      code,
      message: 'Source read: ' + code,
      ...(status === 429 ? { retryAfterMs: 120000 } : {}),
    });
  });
  it.each([
    [36009002, 'throttled'],
    [36009003, 'temporary'],
    [1234, 'invalid-source'],
  ] as const)('classifies source code %s without forwarding its text', async (sourceCode, code) => {
    const { send } = setup(
      new Response(JSON.stringify({ code: sourceCode, message: secrets.accessToken })),
    );
    await expect(send(request, signal())).rejects.toMatchObject({
      code,
      message: 'Source read: ' + code,
    });
  });
  it('rejects oversized responses even with no Content-Length', async () => {
    const { send } = setup(new Response(' '.repeat(2_000_001)));
    await expect(send(request, signal())).rejects.toMatchObject({ code: 'invalid-source' });
  });
  it('redacts transport errors including signed URLs', async () => {
    const { send, fetcher } = setup();
    fetcher.mockRejectedValue(new Error('signed-url ' + secrets.appSecret));
    await expect(send(request, signal())).rejects.toMatchObject({
      code: 'temporary',
      message: 'Source read: temporary',
    });
  });
  it('cancels a stalled response body without returning its earlier bytes', async () => {
    const controller = new AbortController(),
      cancelled = vi.fn();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{'));
      },
      cancel: cancelled,
    });
    const { send } = setup(new Response(stream));
    const pending = send(request, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalled();
  });
  it('rejects credential control characters before fetch', async () => {
    const { send, credential, fetcher } = setup();
    credential.mockResolvedValue({ ...secrets, accessToken: 'bad\r\nheader' });
    await expect(send(request, signal())).rejects.toMatchObject({ code: 'access' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
