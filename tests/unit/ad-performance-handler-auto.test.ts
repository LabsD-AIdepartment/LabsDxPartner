import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleAdPerformanceRequest, type AutoRefreshFn } from '../../dev/ad-performance/handler';
import { MissingSnapshotError } from '../../dev/ad-performance/store';
import { adSnapshotWindowFileName } from '@/server/modules/marketing-ads/facebook/snapshot-config';

type AutoParams = Parameters<AutoRefreshFn>[0];

// AUTO-ON behavior for the dev handler. The provider/network is never touched: `autoRefresh` and the
// snapshot store are injected. The OFF-behavior tests live in ad-performance-handler.test.ts and stay
// unchanged (this file only adds the opt-in path).

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
const period = (fromDate: string, toDate: string) => ({
  from: fromDate + 'T00:00:00+07:00',
  toExclusive: toDate + 'T00:00:00+07:00',
  timezone: 'Asia/Bangkok' as const,
});
const metric = (key: string, value: string, unit: 'money' | 'ratio') => ({
  schemaVersion: 2,
  key,
  value,
  unit,
  currency: unit === 'money' ? 'THB' : null,
  definition: key,
  unavailableReason: null,
  aggregation: key === 'spend' ? 'sum-disjoint' : 'non-additive',
});
const snapshotFor = (fromDate: string, toDate: string, fetchedAt: string) => {
  const p = period(fromDate, toDate);
  return {
    schemaVersion: 1,
    binding: {
      identity: 'a',
      clipId: 'clip-3',
      namespace: 'meta',
      connectionId: 'fb',
      accountId: '123',
      adId: '52513673563767',
      expectedCreativeId: '1004085732033027',
      expectedVideoId: '2629443027486387',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
      canViewSpend: false,
    },
    requestedPeriod: p,
    report: {
      schemaVersion: 2,
      identity,
      grain: 'ad-period',
      apiVersion: 'v25.0',
      reportDefinition: 'facebook.ad-snapshot.v1',
      attribution: '7d_click+1d_view',
      actionReportTime: 'impression',
      period: p,
      coveredPeriod: p,
      fetchedAt,
      dataThrough: null,
      completeness: 'complete',
      nextCursor: null,
      reason: null,
      metrics: [
        metric('spend', '18260.17', 'money'),
        metric('cpc', '2.35', 'money'),
        metric('ctr', '1.53', 'ratio'),
        metric('roas', '3.760042', 'ratio'),
      ],
    },
    fetchedAt,
    refreshedBy: 'operator',
  };
};

const env = {
  LABSD_AD_SNAPSHOT_ENABLED: '1',
  LABSD_AD_SNAPSHOT_AUTO_REFRESH: '1',
  LABSD_AD_SNAPSHOT_BINDINGS: JSON.stringify([
    {
      identity: 'a',
      clipId: 'clip-3',
      profileId: 'fb',
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
};

const NOW = Date.parse('2026-09-17T00:00:00Z');
const now = () => NOW;
const fresh = new Date(NOW).toISOString();
const stale = new Date(NOW - 10 * 60_000).toISOString(); // 10 min old > 300s policy

const req = (params: Record<string, string>, host = 'localhost') =>
  new Request(`http://${host}/api/dev/ad-performance?${new URLSearchParams(params)}`);

const CONFIGURED = { identity: 'a', clip: 'clip-3', from: '2026-07-01', to: '2026-09-01' };
const NEW_WINDOW = { identity: 'a', clip: 'clip-3', from: '2026-06-01', to: '2026-07-01' };
const windowFileFor = (from: string, to: string) =>
  adSnapshotWindowFileName({ identity: 'a', clipId: 'clip-3' }, from, to);

function makeStore(initial: Record<string, unknown> = {}) {
  const files = new Map<string, unknown>(Object.entries(initial));
  const read = (_dir: string, fileName: string) => {
    if (!files.has(fileName)) throw new MissingSnapshotError(fileName);
    return files.get(fileName);
  };
  return { files, read };
}

beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));
afterEach(() => vi.unstubAllEnvs());

describe('dev ad-performance handler — auto-refresh ON', () => {
  it('refreshes every visit even with a fresh cache, and marks failed refresh as stale', async () => {
    const store = makeStore({ 'a__clip-3.json': snapshotFor('2026-07-01', '2026-09-01', fresh) });
    let clock = NOW + 1;
    const autoRefresh = vi.fn(async () => {});
    const deps = { env: { ...env, LABSD_AD_SNAPSHOT_REFRESH_ON_VISIT: '1' }, dir: '/tmp',
      now: () => clock, readSnapshot: store.read, autoRefresh };
    for (let visit = 0; visit < 2; visit++) {
      const response = await handleAdPerformanceRequest(req(CONFIGURED), deps);
      const body = await response.json();
      expect(body.performance.state).toBe('stale');
      expect(body.performance.fetchedAt).toBe(fresh);
      clock += 100;
    }
    expect(autoRefresh).toHaveBeenCalledTimes(2);
  });

  it('batch reads only identity-owned bindings and returns no credential metadata', async () => {
    const store = makeStore({ 'a__clip-3.json': snapshotFor('2026-07-01', '2026-09-01', fresh) });
    const response = await handleAdPerformanceRequest(req({ ...CONFIGURED, clip: 'all' }), {
      env: { ...env, LABSD_AD_COMMISSION_RATES_PPM: '{"a:clip-3":30000}' }, dir: '/tmp', now, readSnapshot: store.read,
    });
    const body = await response.json();
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).toMatchObject({ clipId: 'clip-3', ratePpm: 30000 });
    expect(JSON.stringify(body)).not.toMatch(/tokenEnv|accountId|namespace|profileId/);
    const invalid = await handleAdPerformanceRequest(req({ ...CONFIGURED, clip: 'all', to: '2026-06-01' }), { env });
    expect(invalid.status).toBe(404);
  });

  it('acquires and returns the EXACT requested (non-configured) window', async () => {
    const store = makeStore();
    const autoRefresh = vi.fn(async ({ fileName, binding }: AutoParams) => {
      store.files.set(fileName, snapshotFor(binding.from, binding.toExclusive, fresh));
    });
    const res = await handleAdPerformanceRequest(req(NEW_WINDOW), {
      env,
      dir: '/tmp',
      now,
      readSnapshot: store.read,
      autoRefresh,
    });
    expect(res.status).toBe(200);
    expect(autoRefresh).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { performance: { period: { from: string; toExclusive: string }; automaticRefreshFrom?: string } };
    // The served period equals the requested window — never a silently-swapped configured period.
    expect(body.performance.period.from).toBe('2026-06-01T00:00:00+07:00');
    expect(body.performance.period.toExclusive).toBe('2026-07-01T00:00:00+07:00');
    expect(typeof body.performance.automaticRefreshFrom).toBe('string');
    expect(store.files.has(windowFileFor('2026-06-01', '2026-07-01'))).toBe(true);
    // The configured-window base file is NEVER written by auto-refresh.
    expect(store.files.has('a__clip-3.json')).toBe(false);
  });

  it('serves a FRESH window cache without any provider call', async () => {
    const store = makeStore({
      [windowFileFor('2026-06-01', '2026-07-01')]: snapshotFor('2026-06-01', '2026-07-01', fresh),
    });
    const autoRefresh = vi.fn(async () => {});
    const res = await handleAdPerformanceRequest(req(NEW_WINDOW), {
      env,
      dir: '/tmp',
      now,
      readSnapshot: store.read,
      autoRefresh,
    });
    expect(res.status).toBe(200);
    expect(autoRefresh).not.toHaveBeenCalled();
  });

  it('refreshes a STALE window cache before serving', async () => {
    const store = makeStore({
      [windowFileFor('2026-06-01', '2026-07-01')]: snapshotFor('2026-06-01', '2026-07-01', stale),
    });
    const autoRefresh = vi.fn(async ({ fileName, binding }: AutoParams) => {
      store.files.set(fileName, snapshotFor(binding.from, binding.toExclusive, fresh));
    });
    const res = await handleAdPerformanceRequest(req(NEW_WINDOW), {
      env,
      dir: '/tmp',
      now,
      readSnapshot: store.read,
      autoRefresh,
    });
    expect(res.status).toBe(200);
    expect(autoRefresh).toHaveBeenCalledTimes(1);
  });

  it('serves a STALE window cache when the bounded refresh fails to populate the cache', async () => {
    const store = makeStore({
      [windowFileFor('2026-06-01', '2026-07-01')]: snapshotFor('2026-06-01', '2026-07-01', stale),
    });
    const autoRefresh = vi.fn(async () => {}); // acquisition unavailable: writes nothing
    const res = await handleAdPerformanceRequest(req(NEW_WINDOW), {
      env,
      dir: '/tmp',
      now,
      readSnapshot: store.read,
      autoRefresh,
    });
    expect(res.status).toBe(200); // last-known stale report is still served
    expect(autoRefresh).toHaveBeenCalledTimes(1);
  });

  it('404s (client degrades to null) when the cache is empty and refresh yields nothing — no leak', async () => {
    const store = makeStore();
    const autoRefresh = vi.fn(async () => {});
    const res = await handleAdPerformanceRequest(req(NEW_WINDOW), {
      env,
      dir: '/tmp',
      now,
      readSnapshot: store.read,
      autoRefresh,
    });
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('52513673563767');
    expect(text).not.toContain('LABSD_FB');
  });

  it('serves a FRESH legacy base file for the configured window without refreshing', async () => {
    const store = makeStore({ 'a__clip-3.json': snapshotFor('2026-07-01', '2026-09-01', fresh) });
    const autoRefresh = vi.fn(async () => {});
    const res = await handleAdPerformanceRequest(req(CONFIGURED), {
      env,
      dir: '/tmp',
      now,
      readSnapshot: store.read,
      autoRefresh,
    });
    expect(res.status).toBe(200);
    expect(autoRefresh).not.toHaveBeenCalled();
    const body = (await res.json()) as { performance: { period: { from: string } } };
    expect(body.performance.period.from).toBe('2026-07-01T00:00:00+07:00');
  });

  it('NEVER serves the legacy base file for a DIFFERENT requested window (cache separation)', async () => {
    // Only a configured-window base file exists; a different window must not borrow it.
    const store = makeStore({ 'a__clip-3.json': snapshotFor('2026-07-01', '2026-09-01', fresh) });
    const autoRefresh = vi.fn(async () => {}); // no acquisition
    const res = await handleAdPerformanceRequest(req(NEW_WINDOW), {
      env,
      dir: '/tmp',
      now,
      readSnapshot: store.read,
      autoRefresh,
    });
    expect(res.status).toBe(404);
    expect(autoRefresh).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid / out-of-range requested windows BEFORE any provider work', async () => {
    const autoRefresh = vi.fn(async () => {});
    const store = makeStore();
    for (const bad of [
      { ...NEW_WINDOW, from: '2026-02-30', to: '2026-03-05' }, // non-existent date
      { ...NEW_WINDOW, from: '2027-02-29', to: '2027-03-05' }, // leap-invalid
      { identity: 'a', clip: 'clip-3', from: '2026-01-01', to: '2026-06-01' }, // > 93 days
      { ...NEW_WINDOW, from: '2026-07-01', to: '2026-07-01' }, // zero-day
    ]) {
      const res = await handleAdPerformanceRequest(req(bad), {
        env,
        dir: '/tmp',
        now,
        readSnapshot: store.read,
        autoRefresh,
      });
      expect(res.status).toBe(404);
    }
    expect(autoRefresh).not.toHaveBeenCalled();
  });

  it('never calls the provider for an unknown binding, cross-identity, non-loopback, or bad query', async () => {
    const autoRefresh = vi.fn(async () => {});
    const store = makeStore();
    const deps = { env, dir: '/tmp', now, readSnapshot: store.read, autoRefresh };
    expect((await handleAdPerformanceRequest(req({ ...NEW_WINDOW, clip: 'clip-9' }), deps)).status).toBe(404);
    expect((await handleAdPerformanceRequest(req({ ...NEW_WINDOW, identity: 'b' }), deps)).status).toBe(404);
    expect((await handleAdPerformanceRequest(req(NEW_WINDOW, 'evil.example'), deps)).status).toBe(404);
    const dup = new Request('http://localhost/api/dev/ad-performance?identity=a&clip=clip-3&from=2026-06-01&to=2026-07-01&x=1');
    expect((await handleAdPerformanceRequest(dup, deps)).status).toBe(404);
    expect(autoRefresh).not.toHaveBeenCalled();
  });

  it('serves only Celeb-safe metrics (spend hidden, no prohibited counts) on the auto path', async () => {
    const store = makeStore({
      [windowFileFor('2026-06-01', '2026-07-01')]: snapshotFor('2026-06-01', '2026-07-01', fresh),
    });
    const res = await handleAdPerformanceRequest(req(NEW_WINDOW), {
      env,
      dir: '/tmp',
      now,
      readSnapshot: store.read,
      autoRefresh: vi.fn(async () => {}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { performance: { metrics: { key: string }[] } };
    const keys = body.performance.metrics.map((m) => m.key);
    expect(keys).not.toContain('spend'); // canViewSpend=false
    for (const forbidden of ['impressions', 'video_views', 'reach'])
      expect(keys).not.toContain(forbidden);
    expect(keys).toContain('roas');
  });
});
