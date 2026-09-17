import { describe, it, expect, vi } from 'vitest';
import { refreshAdSnapshots } from '@/server/modules/marketing-ads/facebook/snapshot-refresh';
import { AdPerformanceSnapshot } from '@/contracts/ad-performance-snapshot';

const account = { id: 'act_123', account_id: '123', currency: 'THB', timezone_name: 'Asia/Bangkok' };
const ad = {
  id: '52513673563767',
  account_id: '123',
  name: 'Tendrix',
  effective_status: 'ACTIVE',
  creative: {
    id: '1004085732033027',
    object_story_spec: { video_data: { video_id: '2629443027486387' } },
  },
};
const row = {
  ad_id: '52513673563767',
  account_id: '123',
  account_currency: 'THB',
  date_start: '2026-07-01',
  date_stop: '2026-08-31',
  spend: '18260.17',
  cpc: '2.35',
  ctr: '1.53',
  cpm: '85.20',
  purchase_roas: [{ action_type: 'omni_purchase', value: '3.760042' }],
  cost_per_action_type: [{ action_type: 'omni_purchase', value: '120.55' }],
};
const now = () => Date.parse('2026-09-02T00:00:00Z');
const fetcher: typeof fetch = vi.fn(async (input) => {
  const url = new URL(String(input));
  return Response.json(
    url.pathname.endsWith('/act_123')
      ? account
      : url.pathname.endsWith('/insights')
        ? { data: [row] }
        : ad,
  );
});
const env = () => ({
  LABSD_FACEBOOK_READ_ENABLED: '1',
  LABSD_FACEBOOK_PROFILES: JSON.stringify([
    {
      id: 'fb-primary',
      namespace: 'meta',
      accountId: '123',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
      acquisitionOwner: 'portal-direct',
      tokenEnv: 'LABSD_FB_PRIMARY_TOKEN',
    },
  ]),
  LABSD_AD_SNAPSHOT_ENABLED: '1',
  LABSD_AD_SNAPSHOT_BINDINGS: JSON.stringify([
    {
      identity: 'a',
      clipId: 'clip-3',
      profileId: 'fb-primary',
      namespace: 'meta',
      accountId: '123',
      adId: '52513673563767',
      expectedCreativeId: '1004085732033027',
      expectedVideoId: '2629443027486387',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
      from: '2026-07-01',
      toExclusive: '2026-09-01',
      canViewSpend: false,
    },
  ]),
  LABSD_FB_PRIMARY_TOKEN: 'synthetic-token',
});

describe('ad snapshot refresh', () => {
  it('writes a validated snapshot with no credential and no prohibited count', async () => {
    const written: { file: string; contents: string }[] = [];
    const results = await refreshAdSnapshots({
      env: env(),
      fetch: fetcher,
      now,
      write: async (file, contents) => {
        written.push({ file, contents });
      },
    });
    expect(results).toEqual([{ identity: 'a', clipId: 'clip-3', file: 'a__clip-3.json', state: 'complete' }]);
    expect(written).toHaveLength(1);
    expect(written[0].contents).not.toContain('synthetic-token');
    const snapshot = AdPerformanceSnapshot.parse(JSON.parse(written[0].contents));
    expect(snapshot.report.metrics.map((m) => m.key).sort()).toEqual(
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
    // The source row carries no actions/action_values nor inline_link_clicks, so the writer must still
    // emit these conversion/click metrics as unavailable (value null with a reason) rather than
    // dropping them — this keeps the regression honest that a missing source is surfaced, not omitted.
    for (const missing of ['platform_orders', 'platform_value', 'link_clicks']) {
      const metric = snapshot.report.metrics.find((m) => m.key === missing);
      expect(metric?.value).toBeNull();
      expect(metric?.unavailableReason).toEqual(expect.any(String));
    }
    for (const forbidden of ['impressions', 'video_views', 'reach'])
      expect(snapshot.report.metrics.some((m) => m.key === forbidden)).toBe(false);
    expect(snapshot.binding.canViewSpend).toBe(false);
  });

  it('rejects when the ad no longer resolves to the expected creative', async () => {
    const wrongCreative: typeof fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      return Response.json(
        url.pathname.endsWith('/act_123')
          ? account
          : url.pathname.endsWith('/insights')
            ? { data: [row] }
            : { ...ad, creative: { id: '9999999999' } },
      );
    });
    await expect(
      refreshAdSnapshots({ env: env(), fetch: wrongCreative, now, write: async () => {} }),
    ).rejects.toThrow();
  });

  it('rejects when the creative resolves to a different video than the expected binding video', async () => {
    // Correct creative id, but its only video is NOT the binding's expectedVideoId → the video binding
    // check must fail so a snapshot can never bind to a foreign/replaced creative video.
    const wrongVideo: typeof fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      return Response.json(
        url.pathname.endsWith('/act_123')
          ? account
          : url.pathname.endsWith('/insights')
            ? { data: [row] }
            : {
                ...ad,
                creative: {
                  id: '1004085732033027',
                  object_story_spec: { video_data: { video_id: '9999999999' } },
                },
              },
      );
    });
    await expect(
      refreshAdSnapshots({ env: env(), fetch: wrongVideo, now, write: async () => {} }),
    ).rejects.toThrow();
  });

  it('throws when disabled or when the injected credential is missing', async () => {
    await expect(
      refreshAdSnapshots({ env: {}, fetch: fetcher, now, write: async () => {} }),
    ).rejects.toThrow();
    const noToken = env();
    delete (noToken as Record<string, string | undefined>).LABSD_FB_PRIMARY_TOKEN;
    await expect(
      refreshAdSnapshots({ env: noToken, fetch: fetcher, now, write: async () => {} }),
    ).rejects.toThrow(/credential/);
  });
});
