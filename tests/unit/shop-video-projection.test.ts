import { describe, it, expect } from 'vitest';
import { projectShopVideoPeriod } from '@/server/modules/marketing-ads/tiktok-shop/video-partner-read';
import { CompleteVideoCollection } from '@/server/modules/marketing-ads/tiktok-shop/video-contract';
type Segment = Parameters<typeof projectShopVideoPeriod>[1][number];
const period = { from: '2026-09-01', toExclusive: '2026-09-03' };
function segment(from: string, toExclusive: string, amount = '9007199254740993.01'): Segment {
  return {
    metadata: {
      connection: {
        connectionId: 'c',
        namespace: 'n',
        shopId: 'shop',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
      },
      period: { from, toExclusive },
      fetchedAt: '2026-09-10T01:00:00Z',
      latestAvailableDate: '2026-09-09',
      reportDefinition: 'tiktok.shop-video.202605.local.all.v1',
    },
    stale: false,
    observation: {
      videoId: 'video',
      title: 'Sample',
      creator: { openId: 'creator', username: 'name', nickname: 'Name', authorType: 'AFFILIATE' },
      views: '12',
      paidSkuOrders: '2',
      itemsSold: '3',
      gmv: { amount, currency: 'THB' },
      productClickThroughRate: '0.05',
    },
  };
}
describe('Shop Video range projection', () => {
  it('sums disjoint complete ranges exactly without summing CTR', () => {
    const r = projectShopVideoPeriod(period, [
      segment('2026-09-01', '2026-09-02'),
      segment('2026-09-02', '2026-09-03'),
    ]);
    expect(r).toMatchObject({
      state: 'ready',
      views: null, // audience count masked from the public partner response
      paidSkuOrders: '4',
      itemsSold: '6',
      gmv: { amount: '18014398509481986.02', currency: 'THB' },
      productClickThroughRate: null,
    });
    expect(r.series).toHaveLength(2);
    expect(r.series[0]).toMatchObject({
      period: { from: '2026-09-01', toExclusive: '2026-09-02' },
      views: null,
      gmv: { amount: '9007199254740993.01' },
    });
    expect(JSON.stringify(r.series)).not.toContain('creator');
  });
  it('prefers an exact range observation over overlapping daily alternatives', () => {
    const r = projectShopVideoPeriod(period, [
      segment('2026-09-01', '2026-09-02'),
      segment('2026-09-01', '2026-09-03', '7.50'),
    ]);
    expect(r).toMatchObject({
      state: 'ready',
      views: null,
      gmv: { amount: '7.50' },
      productClickThroughRate: '0.05',
    });
  });
  it('gaps prevent full-range totals instead of summing partial data', () => {
    expect(projectShopVideoPeriod(period, [segment('2026-09-01', '2026-09-02')])).toMatchObject({
      state: 'partial',
      views: null,
      gmv: null,
    });
  });
  it('missing video and missing metrics never turn into zero', () => {
    const a = segment('2026-09-01', '2026-09-03');
    a.observation = null;
    expect(projectShopVideoPeriod(period, [a])).toMatchObject({
      state: 'partial',
      views: null,
      gmv: null,
    });
    a.observation = segment('2026-09-01', '2026-09-03').observation;
    a.observation!.views = null;
    expect(projectShopVideoPeriod(period, [a]).views).toBeNull();
  });
  it('does not expose mismatched or overlapping definitions', () => {
    const b = segment('2026-09-02', '2026-09-03');
    b.metadata.connection.timezone = 'UTC';
    expect(() =>
      projectShopVideoPeriod(period, [segment('2026-09-01', '2026-09-02'), b]),
    ).toThrow();
    expect(() =>
      projectShopVideoPeriod({ from: '2026-09-01', toExclusive: '2026-09-04' }, [
        segment('2026-09-01', '2026-09-03'),
        segment('2026-09-02', '2026-09-04'),
      ]),
    ).toThrow();
  });
  it('marks retained failed-source evidence stale and an absent report unavailable', () => {
    const a = segment('2026-09-01', '2026-09-03');
    a.stale = true;
    expect(projectShopVideoPeriod(period, [a])).toMatchObject({ state: 'stale', views: null });
    expect(projectShopVideoPeriod(period, [])).toMatchObject({
      state: 'unavailable',
      views: null,
      latestAvailableDate: null,
    });
  });
  it('rejects partial normalized evidence at the durable publication boundary', () => {
    const a = segment(period.from, period.toExclusive);
    const report = {
      ...a.metadata,
      schemaVersion: 1,
      capability: 'tiktok.shop_video',
      apiVersion: '202605',
      grain: 'shop-video-period',
      completeness: 'complete',
      reason: null,
      sourceRequestIds: ['req'],
      videos: [a.observation],
    };
    expect(CompleteVideoCollection.safeParse(report).success).toBe(true);
    expect(
      CompleteVideoCollection.safeParse({ ...report, latestAvailableDate: '2026-09-01' }).success,
    ).toBe(false);
    expect(CompleteVideoCollection.safeParse({ ...report, completeness: 'partial' }).success).toBe(
      false,
    );
    expect(
      CompleteVideoCollection.safeParse({ ...report, videos: [a.observation, a.observation] })
        .success,
    ).toBe(false);
  });
});
