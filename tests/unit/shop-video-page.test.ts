// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createShopVideoOwnerHandler } from '@/server/modules/marketing-ads/tiktok-shop/owner-handler';
import { createShopVideoOwnerClient } from '@/server/modules/marketing-ads/tiktok-shop/owner-client';
import { AUTHORIZED_SHOPS_PATH } from '@/server/modules/marketing-ads/tiktok-shop/video-transport';
import type { VideoPageEvidence } from '@/server/modules/marketing-ads/tiktok-shop/video-page';

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
  const quota = vi.fn().mockResolvedValue(undefined);
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
      beforeRequest: quota,
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
    quota,
    client: createShopVideoOwnerClient([profile], 'https://source.example.test', token, wire),
  };
}
const signal = () => new AbortController().signal;
describe('bounded source-owner page acquisition', () => {
  const row = (id: string) => ({
    id,
    title: 'คลิปตัวอย่าง',
    creator: {
      open_id: 'creator-1',
      user_name: 'creator',
      nick_name: 'Creator',
      author_type: 'AFFILIATE',
    },
    views: 0,
    gmv: { amount: '9007199254740993.01', currency: 'THB' },
  });
  const response = (videos: unknown[], total = 2101, next = '') =>
    Response.json({
      code: 0,
      request_id: 'page-request',
      data: {
        videos,
        total_count: total,
        next_page_token: next,
        latest_available_date: '2026-09-09',
      },
    });

  it('reads one page after the old twenty-page cap without collecting earlier pages or exposing credentials', async () => {
    const f = fixture();
    f.sourceFetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('page_token')).toBe('after-page-21');
      expect(url.searchParams.get('page_size')).toBe('100');
      expect(url.searchParams.get('shop_cipher')).toBe('synthetic-cipher');
      return response([row('video-2101')]);
    });
    const page = await f.client.page(profile.connectionId, period, 'after-page-21', signal());
    expect(page).toMatchObject({
      kind: 'shop-video-page',
      requestedPageToken: 'after-page-21',
      connection: { shopId: profile.shopId },
      page: {
        data: {
          total_count: 2101,
          videos: [{ id: 'video-2101', views: 0, gmv: { amount: '9007199254740993.01' } }],
        },
      },
    });
    expect(f.sourceFetch).toHaveBeenCalledTimes(1);
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(page)).not.toMatch(/synthetic-(seller-token|secret|cipher)/);
    const { CompleteVideoCollection } =
      await import('@/server/modules/marketing-ads/tiktok-shop/video-contract');
    expect(CompleteVideoCollection.safeParse(page).success).toBe(false);
  });

  it('starts without a cursor, then correlates the next request to its exact cursor', async () => {
    const f = fixture();
    f.sourceFetch.mockImplementation(async (input) => {
      const cursor = new URL(String(input)).searchParams.get('page_token');
      return cursor ? response([row('b')], 2) : response([row('a')], 2, 'next=opaque/token');
    });
    const first = await f.client.page(profile.connectionId, period, null, signal());
    const last = await f.client.page(
      profile.connectionId,
      period,
      first.page.data.next_page_token!,
      signal(),
    );
    expect(first.requestedPageToken).toBeNull();
    expect(last.page.data.videos[0]?.id).toBe('b');
    expect(f.sourceFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['duplicates', () => response([row('a'), row('a')], 2)],
    ['wrong currency', () => response([{ ...row('a'), gmv: { amount: '1', currency: 'USD' } }], 1)],
    ['cursor loop', () => response([row('a')], 2, 'loop')],
    ['empty continuation', () => response([], 2, 'next')],
    [
      'oversized page',
      () =>
        response(
          Array.from({ length: 101 }, (_, i) => row(String(i))),
          101,
        ),
    ],
    ['malformed count', () => response([row('a')], -1)],
  ])('rejects %s without returning page evidence', async (_name, make) => {
    const f = fixture();
    f.sourceFetch.mockImplementation(async () => make());
    await expect(
      f.client.page(profile.connectionId, period, 'loop', signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });

  it('rejects a first-page count mismatch but retains source-not-ready evidence for the staging validator', async () => {
    const f = fixture();
    f.sourceFetch.mockImplementation(async () => response([row('a')], 2));
    await expect(f.client.page(profile.connectionId, period, null, signal())).rejects.toMatchObject(
      { code: 'invalid-source' },
    );
    f.sourceFetch.mockResolvedValue(
      Response.json({
        code: 0,
        request_id: 'not-ready',
        data: { videos: [], total_count: 0, latest_available_date: '2026-09-08' },
      }),
    );
    expect(
      (await f.client.page(profile.connectionId, period, null, signal())).page.data
        .latest_available_date,
    ).toBe('2026-09-08');
  });

  it('rejects future periods before credentials or upstream calls and retains parent cancellation', async () => {
    const f = fixture();
    await expect(
      f.client.page(
        profile.connectionId,
        { from: '2026-09-10', toExclusive: '2026-09-11' },
        null,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.sourceFetch).not.toHaveBeenCalled();
    const stop = new AbortController();
    stop.abort();
    await expect(
      f.client.page(profile.connectionId, period, null, stop.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects response cursor, period and connection substitution', async () => {
    for (const mutate of [
      (r: { result: VideoPageEvidence }) => {
        r.result.requestedPageToken = 'different';
      },
      (r: { result: VideoPageEvidence }) => {
        r.result.period = { from: '2026-09-08', toExclusive: '2026-09-09' };
      },
      (r: { result: VideoPageEvidence }) => {
        r.result.connection.shopId = 'other-shop';
      },
    ]) {
      const f = fixture();
      const wire: typeof fetch = async (url, init) => {
        const r = await f.handler(new Request(url, init));
        const body = await r.json();
        mutate(body);
        return Response.json(body);
      };
      const client = createShopVideoOwnerClient(
        [profile],
        'https://source.example.test',
        token,
        wire,
      );
      await expect(client.page(profile.connectionId, period, null, signal())).rejects.toMatchObject(
        { code: 'invalid-source' },
      );
    }
  });
  it('resolves credentials and reserves shared quota for every page, preserving throttle delay', async () => {
    const f = fixture();
    await f.client.page(profile.connectionId, period, null, signal());
    const { SourceReadError } = await import('@/server/modules/marketing-ads/source-error');
    f.quota.mockRejectedValue(new SourceReadError('throttled', 3600000));
    await expect(
      f.client.page(profile.connectionId, period, 'later', signal()),
    ).rejects.toMatchObject({ code: 'throttled', retryAfterMs: 3600000 });
    expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.quota).toHaveBeenCalledTimes(2);
    expect(f.sourceFetch).toHaveBeenCalledTimes(1);
  });
  it('does not fallback to whole-shop collection when an older owner rejects page action', async () => {
    const wire = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 400 }));
    const client = createShopVideoOwnerClient(
      [profile],
      'https://source.example.test',
      token,
      wire,
    );
    await expect(client.page(profile.connectionId, period, null, signal())).rejects.toMatchObject({
      code: 'invalid-source',
    });
    expect(wire).toHaveBeenCalledTimes(1);
  });
});
