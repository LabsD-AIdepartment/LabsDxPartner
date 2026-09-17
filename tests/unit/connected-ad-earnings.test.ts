import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectedAds } from '@/contracts/connected-ad-earnings';
import { ContentDetailResponse, ContentListResponse, AdListResponse } from '@/contracts/content';
import { Overview } from '@/contracts/overview';
import { buildDataset } from '../../dev/demo-dataset/dataset';
import { createDemoSession } from '../../dev/demo-dataset/client';
import { commissionFor, accountingCommission, withoutConnectedSamples } from '../../dev/demo-dataset/connected-earnings';
const period = { from: '2026-07-01T00:00:00+07:00', toExclusive: '2026-09-01T00:00:00+07:00', timezone: 'Asia/Bangkok' };
function reports(rate: number | null = 30000) {
  return ConnectedAds.parse({ period, connections: ['clip-3', 'clip-sep-2'].map((clipId, index) => ({
    clipId, adId: index ? '52554922813367' : '52513673563767', ratePpm: rate,
    performance: { schemaVersion: 2, source: 'Facebook', definition: null, period,
      coverage: { status: 'complete', periods: [period] }, fetchedAt: '2026-09-18T03:00:00+07:00', dataThrough: null,
      state: 'ready', reasons: [], series: [], metrics: [{ schemaVersion: 2, key: 'platform_value', value: index ? '15668' : '57820',
        unit: 'money', currency: 'THB', definition: 'ยอดขายจาก Meta', unavailableReason: null, aggregation: 'sum-disjoint' }],
    },
  })) });
}
const filters = { from: '2026-07-01', toExclusive: '2026-09-01', brand: null };
const context = { ...filters, origin: 'content' as const, generation: null, cursor: null, history: [], q: '' };
const data = () => buildDataset({ datasetId: 'partner-demo-a', asOf: new Date('2026-09-18T03:00:00+07:00') });
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
describe('connected platform commissions', () => {
  it('computes exact 3% and zero without using sample earnings or floating point', () => {
    const input = reports();
    expect(commissionFor(input.connections[0], input.period).amount?.minor).toBe('173460');
    expect(commissionFor(input.connections[1], input.period).amount?.minor).toBe('47004');
    input.connections[0].performance!.metrics[0].value = '0';
    expect(commissionFor(input.connections[0], input.period).amount?.minor).toBe('0');
    input.connections[0].performance!.metrics[0].value = '0.1666667';
    expect(commissionFor(input.connections[0], input.period).amount?.minor).toBe('1');
  });
  it('never invents a rate or uses stale sales to calculate a current commission', () => {
    const input = reports(null);
    expect(commissionFor(input.connections[0], input.period).amount).toBeNull();
    input.connections[0].ratePpm = 30000;
    input.connections[0].performance!.state = 'stale';
    expect(commissionFor(input.connections[0], input.period).amount).toBeNull();
  });
  it('keeps organic and settled history, and blocks adding a second gross estimate over confirmed ads', () => {
    const original = data(), input = reports();
    const filtered = withoutConnectedSamples(original, input);
    expect(filtered.earnings.filter(e => e.contentId === 'clip-3')).toEqual(original.earnings.filter(e => e.contentId === 'clip-3'));
    expect(filtered.earnings.some(e => e.contentId === 'clip-sep-2' && e.status === 'estimated')).toBe(false);
    const booked = { ...original, earnings: original.earnings.map(e => e.contentId === 'clip-3' ? { ...e, channel: 'brand_ads' as const } : e) };
    expect(accountingCommission(booked, input.connections[0], input.period).amount).toBeNull();
  });
  it('uses the same source and math in Content/list/Overview, replaces linked sample rows, preserves payouts', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(reports())));
    vi.stubGlobal('fetch', fetcher);
    const records = data(), before = JSON.stringify(records);
    const session = createDemoSession(records, 'a', true), sample = createDemoSession(records, 'a');
    const base = { scope: session.scope, signal: new AbortController().signal };
    const detail = ContentDetailResponse.parse(await session.content({ ...base, context, resource: 'detail', contentId: 'clip-3' }));
    expect(detail.data.adCommission?.amount?.minor).toBe('173460');
    expect(detail.data.content.earned?.minor).toBe('9600000');
    expect(detail.data.adCommission?.status).toBe('estimated');
    const list = ContentListResponse.parse(await session.content({ ...base, context, resource: 'list' }));
    expect(list.data.items.find(c => c.id === 'clip-3')?.earned).toEqual(detail.data.content.earned);
    expect(list.data.items.find(c => c.id === 'clip-3')?.adCommission?.amount).toEqual(detail.data.adCommission?.amount);
    const overview = Overview.parse(await session.overview({ ...base, filters }));
    const original = Overview.parse(await sample.overview({ ...base, filters }));
    expect(overview.earnings.confirmed).toEqual(original.earnings.confirmed);
    expect(overview.earnings.channelBreakdown).toEqual(original.earnings.channelBreakdown);
    expect(overview.earnings.connectedAdEarnings?.map(c => c.amount?.minor)).toEqual(['173460', '47004']);
    expect(overview.earnings.estimated?.minor).toBe('220464');
    expect(overview.obligation).toEqual(original.obligation);
    expect(JSON.stringify(records)).toBe(before);
    const ads = AdListResponse.parse(await session.content({ ...base, context, resource: 'ads', contentId: 'clip-3' }));
    expect(ads.data.items.map(a => a.id)).toEqual(['52513673563767']);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('does not fall back to synthetic commission on missing policy or missing provider report', async () => {
    const result = reports(null); result.connections[1].performance = null;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(result))));
    const session = createDemoSession(data(), 'a', true);
    const base = { scope: session.scope, signal: new AbortController().signal };
    const detail = ContentDetailResponse.parse(await session.content({ ...base, context, resource: 'detail', contentId: 'clip-3' }));
    expect(detail.data.adCommission?.amount).toBeNull();
    expect(detail.data.content.earned?.minor).toBe('9600000');
    const overview = Overview.parse(await session.overview({ ...base, filters }));
    expect(overview.earnings.estimated).toBeNull();
    expect(overview.dataState).toBe('partial');
  });
  it('rejects wrong-window responses and network errors instead of showing unrelated sample finance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const session = createDemoSession(data(), 'a', true);
    await expect(session.overview({ scope: session.scope, filters, signal: new AbortController().signal })).rejects.toThrow('unavailable');
  });
});
