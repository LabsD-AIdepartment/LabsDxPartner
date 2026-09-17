import { describe, it, expect, vi } from 'vitest';
import {
  createFacebookSnapshotReader,
  facebookSnapshotDateRange,
} from '@/server/modules/marketing-ads/facebook/snapshot-reader';

const connection = {
  id: 'fb',
  namespace: 'meta',
  accountId: '123',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
};
const identity = {
  schemaVersion: 2,
  platform: 'facebook',
  capability: 'facebook.ad_insights',
  namespace: 'meta',
  connectionId: 'fb',
  accountId: '123',
  objectType: 'ad',
  externalId: '52513673563767',
};
const account = { id: 'act_123', account_id: '123', currency: 'THB', timezone_name: 'Asia/Bangkok' };
const ad = { id: identity.externalId, account_id: '123', name: 'Tendrix', effective_status: 'ACTIVE' };
// 2026-07-01..2026-09-01 Bangkok = one 62-day full-period window.
const period = {
  from: '2026-06-30T17:00:00Z',
  toExclusive: '2026-08-31T17:00:00Z',
  timezone: 'Asia/Bangkok',
};
const now = () => Date.parse('2026-09-02T00:00:00Z');
const row = {
  ad_id: identity.externalId,
  account_id: '123',
  account_currency: 'THB',
  date_start: '2026-07-01',
  date_stop: '2026-08-31',
  spend: '18260.17',
  cpc: '2.35',
  ctr: '1.53',
  cpm: '85.20',
  inline_link_clicks: '753',
  purchase_roas: [{ action_type: 'omni_purchase', value: '3.760042' }],
  cost_per_action_type: [{ action_type: 'omni_purchase', value: '120.55' }],
  // Broad Meta arrays: only the single omni_purchase is projected; the unrelated video_view/link_click
  // counts must be discarded and never serialized into the report.
  actions: [
    { action_type: 'video_view', value: '48120' },
    { action_type: 'link_click', value: '910' },
    { action_type: 'omni_purchase', value: '51' },
  ],
  action_values: [{ action_type: 'omni_purchase', value: '57820' }],
};
function fixture(pages: unknown[] = [{ data: [row] }]) {
  const calls: { url: URL }[] = [];
  let index = 0;
  const fetcher: typeof fetch = vi.fn(async (input) => {
    const url = new URL(String(input));
    calls.push({ url });
    return Response.json(
      url.pathname.endsWith('/act_123')
        ? account
        : url.pathname.endsWith('/insights')
          ? pages[index++]
          : ad,
    );
  });
  const credential = vi.fn(async () => ({ token: 'synthetic-token' }));
  const reader = createFacebookSnapshotReader(connection, { credential, fetch: fetcher, now });
  return { calls, credential, reader };
}
const signal = () => new AbortController().signal;

describe('Facebook snapshot reader', () => {
  it('supports a bounded full-period window up to 93 days but rejects longer or unaligned ranges', () => {
    expect(facebookSnapshotDateRange(period, now())).toEqual({
      since: '2026-07-01',
      until: '2026-08-31',
    });
    // 94 days exceeds the 93-day bound (2026-06-01 .. 2026-09-03 Bangkok).
    expect(() =>
      facebookSnapshotDateRange(
        { from: '2026-05-31T17:00:00Z', toExclusive: '2026-09-02T17:00:00Z', timezone: 'Asia/Bangkok' },
        Date.parse('2026-09-05T00:00:00Z'),
      ),
    ).toThrow();
    // Unaligned range: `from` is 2026-07-01T01:00 Bangkok (not local midnight) — must be rejected so
    // a partial-day slice can never masquerade as a full-period aggregate.
    expect(() =>
      facebookSnapshotDateRange(
        { from: '2026-06-30T18:00:00Z', toExclusive: '2026-08-31T17:00:00Z', timezone: 'Asia/Bangkok' },
        now(),
      ),
    ).toThrow();
  });

  it('rejects a window whose exclusive end is an in-progress/future day yet accepts a completed boundary', () => {
    // now = 2026-09-01T00:00 Bangkok → today = 2026-09-01. The window's exclusive end lands exactly on
    // that boundary, so `until` is the COMPLETED day 2026-08-31 and the range is accepted.
    const boundaryNow = Date.parse('2026-08-31T17:00:00Z'); // 2026-09-01T00:00+07:00
    expect(facebookSnapshotDateRange(period, boundaryNow)).toEqual({
      since: '2026-07-01',
      until: '2026-08-31',
    });
    // now = 2026-08-31T00:00 Bangkok → today = 2026-08-31. The exclusive end (2026-09-01) now falls on
    // an in-progress calendar day, so it must be rejected rather than served as a full-period aggregate.
    const inProgressNow = Date.parse('2026-08-30T17:00:00Z'); // 2026-08-31T00:00+07:00
    expect(() => facebookSnapshotDateRange(period, inProgressNow)).toThrow();
    // A window that begins after `now` (a wholly future window) is likewise rejected — no future coverage.
    expect(() => facebookSnapshotDateRange(period, Date.parse('2026-06-01T00:00:00Z'))).toThrow();
  });

  it('emits only Celeb-safe economics with exact values and never requests forbidden counts', async () => {
    const f = fixture();
    const report = await f.reader.report(identity, period, signal());
    expect(report.completeness).toBe('complete');
    expect(report.reportDefinition).toBe('facebook.ad-snapshot.v1');
    expect(report.attribution).toBe('7d_click+1d_view');
    expect(report.actionReportTime).toBe('impression');
    const get = (key: string) => report.metrics.find((m) => m.key === key)!;
    expect(report.metrics.map((m) => m.key).sort()).toEqual(
      [
        'cost_per_purchase',
        'cpc',
        'cpm',
        'ctr',
        'link_clicks',
        'platform_orders',
        'platform_value',
        'roas',
        'spend',
      ].sort(),
    );
    // No still-prohibited audience count is present in the report at all.
    for (const forbidden of ['impressions', 'video_views', 'reach'])
      expect(report.metrics.some((m) => m.key === forbidden)).toBe(false);
    // The owner-authorized inline link-click count is emitted exactly from its dedicated field.
    expect(get('link_clicks')).toMatchObject({
      value: '753',
      unit: 'count',
      currency: null,
      aggregation: 'sum-disjoint',
      unavailableReason: null,
    });
    // The requested purchase economics are mapped exactly from the single omni_purchase entry.
    expect(get('platform_orders')).toMatchObject({
      value: '51',
      unit: 'count',
      currency: null,
      aggregation: 'sum-disjoint',
      unavailableReason: null,
    });
    expect(get('platform_value')).toMatchObject({
      value: '57820',
      unit: 'money',
      currency: 'THB',
      aggregation: 'sum-disjoint',
      unavailableReason: null,
    });
    // The broad source actions array carried video_view/link_click counts; they are discarded and must
    // never leak into the serialized report. The authoritative link-click count comes ONLY from the
    // dedicated inline_link_clicks field (753), never the actions link_click value (910), so neither
    // the discarded action_type labels nor their values may appear.
    const serialized = JSON.stringify(report);
    for (const leaked of ['video_view', '48120', '910'])
      expect(serialized.includes(leaked)).toBe(false);
    expect(get('spend')).toMatchObject({ value: '18260.17', unit: 'money', currency: 'THB', aggregation: 'sum-disjoint' });
    expect(get('cpc')).toMatchObject({ value: '2.35', unit: 'money', currency: 'THB', aggregation: 'non-additive' });
    expect(get('cpm')).toMatchObject({ value: '85.20', unit: 'money', currency: 'THB' });
    expect(get('ctr')).toMatchObject({ value: '1.53', unit: 'ratio', currency: null, aggregation: 'non-additive' });
    expect(get('roas')).toMatchObject({ value: '3.760042', unit: 'ratio', currency: null, aggregation: 'non-additive' });
    expect(get('cost_per_purchase')).toMatchObject({ value: '120.55', unit: 'money', currency: 'THB' });
    // The requested Graph fields never include a still-forbidden audience-count field, but they DO
    // include the owner-authorized inline_link_clicks count.
    const insights = f.calls.find((c) => c.url.pathname.endsWith('/insights'))!;
    const fields = insights.url.searchParams.get('fields') ?? '';
    for (const forbidden of ['impressions', 'reach', 'video_view'])
      expect(fields.includes(forbidden)).toBe(false);
    expect(fields.split(',')).toContain('inline_link_clicks');
    expect(f.calls.every((c) => !c.url.toString().includes('synthetic-token'))).toBe(true);
  });

  it('treats a missing metric as unknown (never zero) and an empty delivery as unavailable', async () => {
    const partial = { ...row };
    delete (partial as { cpc?: string }).cpc;
    const missing = await fixture([{ data: [partial] }]).reader.report(identity, period, signal());
    const cpc = missing.metrics.find((m) => m.key === 'cpc')!;
    expect(cpc.value).toBeNull();
    expect(cpc.unavailableReason).not.toBeNull();

    const empty = await fixture([{ data: [] }]).reader.report(identity, period, signal());
    expect(empty.completeness).toBe('unavailable');
    expect(empty.metrics).toEqual([]);
    expect(empty.reason).not.toBeNull();
  });

  it('emits an exact inline link-click count, unknown when absent, and rejects a malformed one', async () => {
    // Present: mapped exactly from the dedicated inline_link_clicks field.
    const present = await fixture().reader.report(identity, period, signal());
    expect(present.metrics.find((m) => m.key === 'link_clicks')?.value).toBe('753');

    // Absent field → unknown (never zero) with a reason, but still emitted.
    const withoutClicks = { ...row };
    delete (withoutClicks as { inline_link_clicks?: string }).inline_link_clicks;
    const missing = await fixture([{ data: [withoutClicks] }]).reader.report(identity, period, signal());
    const clicks = missing.metrics.find((m) => m.key === 'link_clicks')!;
    expect(clicks.value).toBeNull();
    expect(clicks.unavailableReason).not.toBeNull();

    // A non-integer inline_link_clicks fails ExactCount validation before it can be projected.
    await expect(
      fixture([{ data: [{ ...row, inline_link_clicks: '75.3' }] }]).reader.report(
        identity,
        period,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });

  it('rejects a foreign identity/account before trusting the report row', async () => {
    await expect(
      fixture().reader.report({ ...identity, accountId: '999' }, period, signal()),
    ).rejects.toMatchObject({ code: 'access' });
    await expect(
      fixture([{ data: [{ ...row, account_currency: 'USD' }] }]).reader.report(identity, period, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });

  it('projects only the omni_purchase entry and never sums an overlapping offsite purchase type', async () => {
    const overlapping = {
      ...row,
      actions: [
        { action_type: 'omni_purchase', value: '51' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '40' },
      ],
      action_values: [
        { action_type: 'omni_purchase', value: '57820' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '40000' },
      ],
    };
    const report = await fixture([{ data: [overlapping] }]).reader.report(identity, period, signal());
    const get = (key: string) => report.metrics.find((m) => m.key === key)!;
    // Values equal the omni_purchase entry alone — the offsite purchase type is neither summed nor swapped.
    expect(get('platform_orders').value).toBe('51');
    expect(get('platform_value').value).toBe('57820');
  });

  it('reports a missing purchase count/value as unknown (never zero) with a reason', async () => {
    const bare = { ...row };
    delete (bare as { actions?: unknown }).actions;
    delete (bare as { action_values?: unknown }).action_values;
    const report = await fixture([{ data: [bare] }]).reader.report(identity, period, signal());
    for (const key of ['platform_orders', 'platform_value']) {
      const metric = report.metrics.find((m) => m.key === key)!;
      expect(metric.value).toBeNull();
      expect(metric.unavailableReason).not.toBeNull();
    }
  });

  it('preserves an explicit zero purchase count/value instead of nulling it', async () => {
    const zeroed = {
      ...row,
      actions: [{ action_type: 'omni_purchase', value: '0' }],
      action_values: [{ action_type: 'omni_purchase', value: '0' }],
    };
    const report = await fixture([{ data: [zeroed] }]).reader.report(identity, period, signal());
    const get = (key: string) => report.metrics.find((m) => m.key === key)!;
    expect(get('platform_orders')).toMatchObject({ value: '0', unavailableReason: null });
    expect(get('platform_value')).toMatchObject({ value: '0', unavailableReason: null });
  });

  it('rejects a duplicated omni_purchase in either the count or value array', async () => {
    await expect(
      fixture([
        { data: [{ ...row, actions: [
          { action_type: 'omni_purchase', value: '51' },
          { action_type: 'omni_purchase', value: '7' },
        ] }] },
      ]).reader.report(identity, period, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    await expect(
      fixture([
        { data: [{ ...row, action_values: [
          { action_type: 'omni_purchase', value: '57820' },
          { action_type: 'omni_purchase', value: '10' },
        ] }] },
      ]).reader.report(identity, period, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });

  it('rejects a malformed decimal in a purchase array before it can be projected', async () => {
    await expect(
      fixture([
        { data: [{ ...row, action_values: [{ action_type: 'omni_purchase', value: '5.' }] }] },
      ]).reader.report(identity, period, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });
});
