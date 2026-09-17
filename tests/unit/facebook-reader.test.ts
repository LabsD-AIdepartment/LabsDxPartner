import { describe, it, expect, vi } from 'vitest';
import {
  createFacebookAdapter,
  facebookDateRange,
} from '@/server/modules/marketing-ads/facebook/adapter';
import {
  createFacebookGraph,
  nextFacebookCursor,
} from '@/server/modules/marketing-ads/facebook/graph';
import { createMarketingProviderRegistry } from '@/server/modules/marketing-ads/provider';
import {
  readFacebookProfiles,
  configuredFacebookAdapter,
} from '@/server/modules/marketing-ads/facebook/config';
import { SourceIdentityV2 } from '@/contracts/platform-capabilities';
const identity = SourceIdentityV2.parse({
  schemaVersion: 2,
  platform: 'facebook',
  capability: 'facebook.ad_insights',
  namespace: 'meta',
  connectionId: 'fb',
  accountId: '123',
  objectType: 'ad',
  externalId: '900719925474099312345',
});
const connection = {
  id: 'fb',
  namespace: 'meta',
  accountId: '123',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
};
const account = {
  id: 'act_123',
  account_id: '123',
  currency: 'THB',
  timezone_name: 'Asia/Bangkok',
};
const ad = {
  id: identity.externalId,
  account_id: '123',
  name: 'Test',
  effective_status: 'ACTIVE',
  creative: { id: '456' },
};
const period = {
  from: '2026-07-31T17:00:00Z',
  toExclusive: '2026-08-01T17:00:00Z',
  timezone: 'Asia/Bangkok',
};
const now = () => Date.parse('2026-08-05T00:00:00Z');
const row = {
  ad_id: identity.externalId,
  account_id: '123',
  account_currency: 'THB',
  date_start: '2026-08-01',
  date_stop: '2026-08-01',
  impressions: '0',
  reach: '900719925474099312345',
  spend: '9007199254740993.01',
  actions: [
    { action_type: 'omni_purchase', value: '2' },
    { action_type: 'purchase', value: '2' },
  ],
  action_values: [{ action_type: 'omni_purchase', value: '100.0001' }],
};
const signal = () => new AbortController().signal;
function fixture(
  pages: unknown[] = [{ data: [row] }],
  changes: { account?: unknown; ad?: unknown } = {},
) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  let index = 0;
  const fetcher: typeof fetch = vi.fn(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return Response.json(
      url.pathname.endsWith('/act_123')
        ? (changes.account ?? account)
        : url.pathname.endsWith('/insights')
          ? pages[index++]
          : (changes.ad ?? ad),
    );
  });
  const credential = vi.fn(async () => ({ token: 'synthetic-token' }));
  const adapter = createFacebookAdapter([connection], { credential, fetch: fetcher, now });
  const registry = createMarketingProviderRegistry([adapter]);
  return { calls, credential, adapter, registry };
}
describe('Facebook read adapter', () => {
  it('uses bound numeric IDs as strings and checks both account metadata and ad ownership', async () => {
    const f = fixture();
    const result = await f.registry.resolve(identity, signal());
    expect(result.identity.externalId).toBe(identity.externalId);
    expect(result.creativeIds).toEqual(['456']);
    expect(f.calls.map((c) => c.url.pathname)).toEqual([
      '/v25.0/act_123',
      '/v25.0/' + identity.externalId,
    ]);
    expect(f.calls.every((c) => c.init?.method === 'GET' && c.init.redirect === 'error')).toBe(
      true,
    );
    expect(f.registry.supports('facebook.ad_insights', 'other')).toBe(false);
    expect(f.calls.every((c) => !c.url.toString().includes('synthetic-token'))).toBe(true);
  });
  it.each([
    { account: { ...account, account_id: 'other' } },
    { account: { ...account, currency: 'USD' } },
    { account: { ...account, timezone_name: 'UTC' } },
    { ad: { ...ad, account_id: '999' } },
    { ad: { ...ad, id: '999' } },
  ])('rejects inconsistent source ownership or reporting metadata %j', async (change) => {
    await expect(fixture(undefined, change).registry.resolve(identity, signal())).rejects.toThrow();
  });
  it.each(['ARCHIVED', 'DELETED'])(
    'does not register a %s ad as an active new association',
    async (effective_status) => {
      await expect(
        fixture(undefined, { ad: { ...ad, effective_status } }).registry.resolve(
          identity,
          signal(),
        ),
      ).rejects.toMatchObject({ code: 'not-found' });
    },
  );
  it('allows archived history while still verifying identity and forbids deleted source reads', async () => {
    const f = fixture(undefined, { ad: { ...ad, effective_status: 'ARCHIVED' } });
    expect((await f.registry.resolve(identity, signal(), 'history')).creativeIds).toEqual(['456']);
    expect((await f.registry.report(identity, period, signal())).completeness).toBe('complete');
    for (const effective_status of ['DELETED']) {
      const d = fixture(undefined, { ad: { ...ad, effective_status } });
      await expect(d.registry.resolve(identity, signal(), 'history')).rejects.toMatchObject({
        code: 'not-found',
      });
      await expect(d.registry.report(identity, period, signal())).rejects.toMatchObject({
        code: 'not-found',
      });
      expect(d.calls.some((c) => c.url.pathname.endsWith('/insights'))).toBe(false);
    }
    await expect(
      fixture(undefined, {
        ad: { ...ad, effective_status: 'ARCHIVED', account_id: '999' },
      }).registry.resolve(identity, signal(), 'history'),
    ).rejects.toMatchObject({ code: 'access' });
  });
  it('rejects dynamic multi-asset association but preserves unknown creative as unknown', async () => {
    await expect(
      fixture(undefined, {
        ad: { ...ad, creative: { id: '456', asset_feed_spec: { videos: [{}, {}] } } },
      }).registry.resolve(identity, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    expect(
      (
        await fixture(undefined, { ad: { ...ad, creative: undefined } }).registry.resolve(
          identity,
          signal(),
        )
      ).creativeIds,
    ).toBeNull();
  });
  it('rejects an unconfigured connection or account before fetching credentials', async () => {
    const f = fixture();
    await expect(
      f.registry.resolve({ ...identity, accountId: '321' }, signal()),
    ).rejects.toMatchObject({ code: 'access' });
    expect(f.credential).not.toHaveBeenCalled();
  });
  it('preserves exact numbers, missing versus zero, source attribution and nonadditive reach', async () => {
    const f = fixture();
    const r = await f.registry.report(identity, period, signal());
    expect(r.completeness).toBe('complete');
    expect(r.dataThrough).toBeNull();
    const get = (key: string) => r.metrics.find((m) => m.key === key)!;
    expect(get('spend').value).toBe('9007199254740993.01');
    expect(get('platform_value').value).toBe('100.0001');
    expect(get('impressions').value).toBe('0');
    expect(get('link_clicks').value).toBeNull();
    expect(get('platform_orders').value).toBe('2');
    expect(get('reach').aggregation).toBe('non-additive');
    const url = f.calls.at(-1)!.url;
    expect(JSON.parse(url.searchParams.get('time_range')!)).toEqual({
      since: '2026-08-01',
      until: '2026-08-01',
    });
    expect(url.searchParams.get('action_attribution_windows')).toBe('["7d_click","1d_view"]');
    expect(url.searchParams.get('time_increment')).toBe('all_days');
  });
  it('exhausted empty report is complete acquisition with unknown values, not fabricated zero', async () => {
    const r = await fixture([{ data: [] }]).registry.report(identity, period, signal());
    expect(r.completeness).toBe('complete');
    expect(r.metrics.every((m) => m.value === null && m.unavailableReason)).toBe(true);
  });
  it('follows validated cursors without following or retaining token-bearing next URLs', async () => {
    const f = fixture([
      {
        data: [],
        paging: {
          next: `https://graph.facebook.com/v25.0/${identity.externalId}/insights?after=second&access_token=DO_NOT_FORWARD`,
        },
      },
      { data: [row] },
    ]);
    expect((await f.registry.report(identity, period, signal())).completeness).toBe('complete');
    expect(f.calls.at(-1)!.url.searchParams.get('after')).toBe('second');
    expect(f.calls.some((c) => c.url.toString().includes('DO_NOT_FORWARD'))).toBe(false);
  });
  it('page safety cap returns partial without publishing accumulated metrics', async () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({
      data: i === 0 ? [row] : [],
      paging: {
        next: `https://graph.facebook.com/v25.0/${identity.externalId}/insights?after=p${i}`,
      },
    }));
    const result = await fixture(pages).registry.report(identity, period, signal());
    expect(result).toMatchObject({
      completeness: 'partial',
      coveredPeriod: null,
      metrics: [],
      nextCursor: 'p19',
    });
  });
  it.each([
    [{ data: [row, row] }],
    [{ data: [{ ...row, account_currency: 'USD' }] }],
    [{ data: [{ ...row, date_start: '2026-07-31' }] }],
    [
      {
        data: [
          {
            ...row,
            actions: [
              { action_type: 'omni_purchase', value: '1' },
              { action_type: 'omni_purchase', value: '2' },
            ],
          },
        ],
      },
    ],
    [{ data: [{ ...row, spend: 1.01 }] }],
    [{ data: [{ ...row, actions: [{ action_type: 'omni_purchase', value: '1.5' }] }] }],
  ])('refuses overlapping/wrong-grain/invalid numeric report %j', async (page) => {
    await expect(fixture([page]).registry.report(identity, period, signal())).rejects.toThrow();
  });
  it('rejects repeated cursor instead of looping or marking complete', async () => {
    const page = {
      data: [],
      paging: {
        next: `https://graph.facebook.com/v25.0/${identity.externalId}/insights?after=repeat`,
      },
    };
    await expect(
      fixture([page, page]).registry.report(identity, period, signal()),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });
  it('translates midnight boundaries including a 23-hour DST day; rejects partial days and future starts', () => {
    expect(facebookDateRange(period, now())).toEqual({ since: '2026-08-01', until: '2026-08-01' });
    expect(
      facebookDateRange(
        {
          from: '2026-03-08T05:00:00Z',
          toExclusive: '2026-03-09T04:00:00Z',
          timezone: 'America/New_York',
        },
        now(),
      ),
    ).toEqual({ since: '2026-03-08', until: '2026-03-08' });
    expect(() => facebookDateRange({ ...period, from: '2026-07-31T18:00:00Z' }, now())).toThrow();
    expect(() => facebookDateRange(period, Date.parse('2026-07-01T00:00:00Z'))).toThrow();
  });
});
describe('Facebook read transport', () => {
  it.each([429, 401, 403, 404, 503])(
    'classifies HTTP %s even when the body is not JSON',
    async (status) => {
      const fetcher = vi.fn(
        async () => new Response('not-json', { status, headers: { 'retry-after': '120' } }),
      );
      const graph = createFacebookGraph({
        credential: async () => ({ token: 'synthetic' }),
        fetch: fetcher,
      });
      await expect(graph('fb', '123', {}, signal())).rejects.toMatchObject({
        code:
          status === 429
            ? 'throttled'
            : status === 404
              ? 'not-found'
              : status === 503
                ? 'temporary'
                : 'access',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('handles error-in-200 and usage-header quota without exposing raw messages', async () => {
    const graph = createFacebookGraph({
      credential: async () => ({ token: 'synthetic' }),
      fetch: async () =>
        Response.json({ error: { code: 190, message: 'DO_NOT_EXPOSE_PRIVATE_VALUE' } }),
    });
    await expect(graph('fb', '123', {}, signal())).rejects.toMatchObject({
      code: 'access',
      message: 'Source read: access',
    });
    const recordUsage = vi.fn();
    const quotaGraph = createFacebookGraph({
      credential: async () => ({ token: 'synthetic' }),
      recordUsage,
      fetch: async () =>
        Response.json(
          {},
          {
            headers: {
              'x-business-use-case-usage':
                '{"123":[{"call_count":90,"estimated_time_to_regain_access":10}]}',
            },
          },
        ),
    });
    await expect(quotaGraph('fb', '123', {}, signal())).rejects.toMatchObject({
      code: 'throttled',
      retryAfterMs: 600000,
    });
    expect(recordUsage).toHaveBeenCalledWith('fb', { percent: 90, retryAfterMs: 600000 });
  });
  it('keeps app usage when a later account usage header is malformed', async () => {
    const recordUsage = vi.fn();
    const graph = createFacebookGraph({
      credential: async () => ({ token: 'synthetic' }),
      recordUsage,
      fetch: async () =>
        Response.json(
          {},
          { headers: { 'x-app-usage': '{"call_count":91}', 'x-ad-account-usage': 'invalid' } },
        ),
    });
    await expect(graph('fb', '123', {}, signal())).rejects.toMatchObject({ code: 'throttled' });
    expect(recordUsage).toHaveBeenCalledWith('fb', {
      percent: 91,
      appPercent: 91,
      retryAfterMs: 0,
    });
  });
  it('caller abort ends a hung credential callback', async () => {
    const controller = new AbortController();
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const graph = createFacebookGraph({
      credential: () => {
        entered();
        return new Promise(() => {});
      },
      fetch: vi.fn(),
    });
    const promise = graph('fb', '123', {}, controller.signal);
    await started;
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects unexpected paging origins and path/query ambiguity', () => {
    for (const next of [
      'https://evil.test/123?after=a',
      'https://graph.facebook.com/v25.0/other?after=a',
      'https://graph.facebook.com/v25.0/123/insights?after=a&after=b',
    ])
      expect(() => nextFacebookCursor({ next }, '123/insights')).toThrow();
  });
  it('bounds response bodies and rejects malformed JSON', async () => {
    for (const body of ['not-json', 'x'.repeat(2_000_001)]) {
      const graph = createFacebookGraph({
        credential: async () => ({ token: 'synthetic' }),
        fetch: async () => new Response(body),
      });
      await expect(graph('fb', '123', {}, signal())).rejects.toMatchObject({
        code: 'invalid-source',
      });
    }
  });
});

describe('Facebook configuration boundary', () => {
  const profile = {
    ...connection,
    acquisitionOwner: 'portal-direct',
    tokenEnv: 'LABSD_FB_PRIMARY_TOKEN',
  };
  const controls = { beforeRequest: async () => {}, recordUsage: async () => {} };
  it('stays off with missing flag/credentials and rejects secret values in metadata', () => {
    expect(readFacebookProfiles({ LABSD_FACEBOOK_PROFILES: 'invalid' })).toEqual([]);
    const env = {
      LABSD_FACEBOOK_READ_ENABLED: '1',
      LABSD_FACEBOOK_PROFILES: JSON.stringify([profile]),
    };
    expect(configuredFacebookAdapter(env, controls)).toBeNull();
    expect(() =>
      readFacebookProfiles({
        ...env,
        LABSD_FACEBOOK_PROFILES: JSON.stringify([{ ...profile, token: 'private-value' }]),
      }),
    ).toThrow('Invalid Facebook profile');
    expect(() =>
      readFacebookProfiles({
        ...env,
        LABSD_FACEBOOK_PROFILES: JSON.stringify([
          { ...profile, acquisitionOwner: 'sale-dashboard' },
        ]),
      }),
    ).toThrow('Invalid Facebook profile');
  });
  it('requires unique canonical accounts and uses runtime secret references only', async () => {
    const env = {
      LABSD_FACEBOOK_READ_ENABLED: '1',
      LABSD_FACEBOOK_PROFILES: JSON.stringify([profile]),
      LABSD_FB_PRIMARY_TOKEN: 'synthetic-config-token',
    };
    expect(() =>
      readFacebookProfiles({
        ...env,
        LABSD_FACEBOOK_PROFILES: JSON.stringify([profile, { ...profile, id: 'other' }]),
      }),
    ).toThrow('Duplicate Facebook');
    const requests: RequestInit[] = [];
    const reader = configuredFacebookAdapter(env, {
      ...controls,
      fetch: async (input, init) => {
        requests.push(init!);
        return Response.json(String(input).includes('/act_') ? account : ad);
      },
    })!;
    await reader.resolve(identity, signal());
    expect(
      requests.every(
        (r) => new Headers(r.headers).get('authorization') === 'Bearer synthetic-config-token',
      ),
    ).toBe(true);
  });
});
