// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createShopVideoCollector,
  SHOP_VIDEO_PATH,
} from '@/server/modules/marketing-ads/tiktok-shop/video-collector';
import { SourceReadError } from '@/server/modules/marketing-ads/source-error';

const connection = {
  connectionId: 'shop-one',
  namespace: 'test',
  shopId: '0009007199254740993',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
};
const period = { from: '2026-09-01', toExclusive: '2026-09-10' };
const now = () => Date.parse('2026-09-10T03:00:00Z');
const signal = () => new AbortController().signal;
const video = (id = '0009007199254740993') => ({
  id,
  title: 'คลิปตัวอย่าง',
  creator: {
    open_id: 'creator-stable',
    user_name: 'sample',
    nick_name: 'Sample',
    author_type: 'AFFILIATE',
  },
  views: 0,
  sku_orders: 2,
  items_sold: 3,
  gmv: { amount: '12345678901234567890.01', currency: 'THB' },
  click_through_rate: '0.0528',
});
const page = (
  videos: unknown[] = [video()],
  next = '',
  total = videos.length,
  latest = '2026-09-09',
) => ({
  code: 0,
  message: 'Success',
  request_id: 'request-one',
  data: { videos, next_page_token: next, total_count: total, latest_available_date: latest },
});
function setup(responses: unknown[]) {
  const request = vi.fn();
  for (const response of responses) request.mockResolvedValueOnce(response);
  return { request, collect: createShopVideoCollector([connection], { request, now }) };
}
describe('TikTok Shop video collection boundary', () => {
  it('preserves opaque IDs, exact amounts, SKU semantics and valid zero; no paid-ad fields', async () => {
    const { collect, request } = setup([page()]);
    const result = await collect('shop-one', period, signal());
    expect(result.completeness).toBe('complete');
    expect(result.videos[0]).toMatchObject({
      videoId: video().id,
      views: '0',
      paidSkuOrders: '2',
      itemsSold: '3',
      gmv: video().gmv,
      productClickThroughRate: '0.0528',
    });
    expect(result.videos[0]).not.toHaveProperty('commission');
    expect(result.videos[0]).not.toHaveProperty('spend');
    expect(result.latestAvailableDate).toBe('2026-09-09');
    expect(request.mock.calls[0][0]).toEqual({
      connectionId: 'shop-one',
      path: SHOP_VIDEO_PATH,
      query: {
        start_date_ge: period.from,
        end_date_lt: period.toExclusive,
        page_size: '100',
        sort_field: 'gmv',
        sort_order: 'DESC',
        currency: 'LOCAL',
        account_type: 'ALL',
      },
    });
  });
  it('collects every page before returning rows; carries opaque cursor as a parameter', async () => {
    const cursor = 'https://untrusted.invalid/a?x=1';
    const { collect, request } = setup([page([video('1')], cursor, 2), page([video('2')], '', 2)]);
    const result = await collect('shop-one', period, signal());
    expect(result.videos.map((row) => row.videoId)).toEqual(['1', '2']);
    expect(request.mock.calls[1][0].query.page_token).toBe(cursor);
    expect(request.mock.calls[1][0].path).toBe(SHOP_VIDEO_PATH);
  });
  it('missing/null metrics remain unknown rather than fabricated zeros', async () => {
    const { collect } = setup([
      page([{ id: 'one', title: '', creator: video().creator, gmv: null }]),
    ]);
    expect((await collect('shop-one', period, signal())).videos[0]).toMatchObject({
      views: null,
      paidSkuOrders: null,
      itemsSold: null,
      gmv: null,
      productClickThroughRate: null,
    });
  });
  it('an empty complete shop scan does not invent a requested video or zero report', async () => {
    const { collect } = setup([page([])]);
    expect(await collect('shop-one', period, signal())).toMatchObject({
      completeness: 'complete',
      videos: [],
    });
  });
  it('holds all observations when source data is not ready through the requested last day', async () => {
    const { collect } = setup([page([video()], '', 1, '2026-09-08')]);
    expect(await collect('shop-one', period, signal())).toMatchObject({
      completeness: 'partial',
      reason: 'source-not-ready',
      videos: [],
    });
  });
  it.each([
    ['duplicate video', [page([video('1')], 'two', 2), page([video('1')], '', 2)]],
    ['repeated cursor', [page([video('1')], 'two', 3), page([video('2')], 'two', 3)]],
    ['changing total', [page([video('1')], 'two', 2), page([video('2')], '', 3)]],
    ['changing watermark', [page([video('1')], 'two', 2), page([video('2')], '', 2, '2026-09-08')]],
    ['missing rows', [page([video()], '', 2)]],
    ['empty continued page', [page([], 'two', 2)]],
    ['continued beyond total', [page([video()], 'two', 1)]],
    ['watermark ahead of T-1', [page([video()], '', 1, '2026-09-10')]],
    ['wrong currency', [page([{ ...video(), gmv: { amount: '12.00', currency: 'USD' } }])]],
    ['unsafe count', [page([{ ...video(), views: Number.MAX_SAFE_INTEGER + 1 }])]],
    ['fractional count', [page([{ ...video(), sku_orders: 1.1 }])]],
    ['string count contrary to schema', [page([{ ...video(), views: '9007199254740993' }])]],
    ['CTR outside ratio range', [page([{ ...video(), click_through_rate: '5.28' }])]],
    ['negative amount', [page([{ ...video(), gmv: { amount: '-1', currency: 'THB' } }])]],
    ['missing stable creator', [page([{ ...video(), creator: { user_name: 'sample' } }])]],
    ['nonzero source status', [{ ...page(), code: 123, message: 'private upstream detail' }]],
  ])('rejects %s without exposing an incomplete collection', async (_, pages) => {
    const { collect } = setup(pages);
    await expect(collect('shop-one', period, signal())).rejects.toMatchObject({
      code: 'invalid-source',
      message: 'Source read: invalid-source',
    });
  });
  it('bounds the scan and does not publish the first 20 pages as complete', async () => {
    const { collect, request } = setup(
      Array.from({ length: 20 }, (_, i) => page([video(String(i))], `next-${i}`, 21)),
    );
    expect(await collect('shop-one', period, signal())).toMatchObject({
      completeness: 'partial',
      reason: 'page-limit',
      videos: [],
    });
    expect(request).toHaveBeenCalledTimes(20);
  });
  it('denies an unconfigured connection without invoking transport', async () => {
    const { collect, request } = setup([]);
    await expect(collect('other-shop', period, signal())).rejects.toMatchObject({ code: 'access' });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { from: '2026-09-10', toExclusive: '2026-09-11' },
    { from: '2026-08-01', toExclusive: '2026-09-10' },
    { from: '2026-09-10', toExclusive: '2026-09-10' },
    { from: '2026-02-30', toExclusive: '2026-03-01' },
  ])('rejects unsupported range %j before requesting', async (range) => {
    const { collect, request } = setup([]);
    await expect(collect('shop-one', range, signal())).rejects.toMatchObject({
      code: 'invalid-source',
    });
    expect(request).not.toHaveBeenCalled();
  });
  it('uses shop calendar, including DST, rather than slicing the current UTC day', async () => {
    const request = vi.fn().mockResolvedValue(page([], '', 0, '2026-03-08'));
    const collect = createShopVideoCollector([{ ...connection, timezone: 'America/Los_Angeles' }], {
      request,
      now: () => Date.parse('2026-03-10T01:00:00Z'),
    });
    await expect(
      collect('shop-one', { from: '2026-03-08', toExclusive: '2026-03-09' }, signal()),
    ).resolves.toMatchObject({ completeness: 'complete' });
    await expect(
      collect('shop-one', { from: '2026-03-09', toExclusive: '2026-03-10' }, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });
  it('redacts a transport failure after page one; no accumulated rows escape', async () => {
    const { collect, request } = setup([page([video('1')], 'two', 2)]);
    request.mockRejectedValueOnce(new Error('signed-url-secret'));
    await expect(collect('shop-one', period, signal())).rejects.toMatchObject({
      code: 'temporary',
      message: 'Source read: temporary',
    });
  });
  it('preserves classified throttling for the durable retry owner', async () => {
    const { collect, request } = setup([]);
    request.mockRejectedValueOnce(new SourceReadError('throttled', 60_000));
    await expect(collect('shop-one', period, signal())).rejects.toMatchObject({
      code: 'throttled',
      retryAfterMs: 60_000,
    });
  });
  it('honors cancellation even when a transport ignores its signal', async () => {
    const controller = new AbortController();
    const request = vi.fn().mockReturnValue(new Promise(() => {}));
    const collect = createShopVideoCollector([connection], { request, now });
    const pending = collect('shop-one', period, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('fails a hung collector after its bounded deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const timer = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      setTimeout(() => controller.abort(), 60_000);
      return controller.signal;
    });
    try {
      const { collect, request } = setup([]);
      request.mockReturnValue(new Promise(() => {}));
      const asserted = expect(collect('shop-one', period, signal())).rejects.toMatchObject({
        code: 'temporary',
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await asserted;
    } finally {
      timer.mockRestore();
      vi.useRealTimers();
    }
  });
});
