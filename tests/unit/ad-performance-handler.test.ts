import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleAdPerformanceRequest,
  AD_PERFORMANCE_MARKER,
} from '../../dev/ad-performance/handler';
import { handleAdPerformanceRequest as unavailableHandler } from '../../dev/ad-performance/handler.unavailable';
import { MissingSnapshotError } from '../../dev/ad-performance/store';

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
const period = {
  from: '2026-07-01T00:00:00+07:00',
  toExclusive: '2026-09-01T00:00:00+07:00',
  timezone: 'Asia/Bangkok' as const,
};
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
const report = {
  schemaVersion: 2,
  identity,
  grain: 'ad-period',
  apiVersion: 'v25.0',
  reportDefinition: 'facebook.ad-snapshot.v1',
  attribution: '7d_click+1d_view',
  actionReportTime: 'impression',
  period,
  coveredPeriod: period,
  fetchedAt: '2026-09-02T00:00:00Z',
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
};
const snapshot = (over: Record<string, unknown> = {}) => ({
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
  requestedPeriod: period,
  report,
  fetchedAt: '2026-09-02T00:00:00Z',
  refreshedBy: 'operator',
  ...over,
});
const env = {
  LABSD_AD_SNAPSHOT_ENABLED: '1',
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
const req = (params: Record<string, string>, host = 'localhost') =>
  new Request(`http://${host}/api/dev/ad-performance?${new URLSearchParams(params)}`);
const ok = { identity: 'a', clip: 'clip-3', from: '2026-07-01', to: '2026-09-01' };

beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));
afterEach(() => vi.unstubAllEnvs());

describe('dev ad-performance handler', () => {
  it('returns 404 outside development and from the production stub', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await handleAdPerformanceRequest(req(ok), { env })).status).toBe(404);
    const stub = await unavailableHandler(req(ok));
    expect(stub.status).toBe(404);
    expect(stub.headers.get('x-ad-performance')).toBeNull();
  });

  it('404s when disabled, unknown binding, window mismatch, or non-loopback host', async () => {
    expect((await handleAdPerformanceRequest(req(ok), { env: {} })).status).toBe(404);
    expect(
      (await handleAdPerformanceRequest(req({ ...ok, clip: 'clip-9' }), { env })).status,
    ).toBe(404);
    expect(
      (await handleAdPerformanceRequest(req({ ...ok, to: '2026-08-31' }), { env })).status,
    ).toBe(404);
    expect((await handleAdPerformanceRequest(req(ok, 'evil.example'), { env })).status).toBe(404);
  });

  it('404s on unknown or duplicated query parameters', async () => {
    const url = (qs: string) => new Request(`http://localhost/api/dev/ad-performance?${qs}`);
    expect(
      (await handleAdPerformanceRequest(url('identity=a&clip=clip-3&from=2026-07-01&to=2026-09-01&x=1'), { env }))
        .status,
    ).toBe(404);
    expect(
      (await handleAdPerformanceRequest(
        url('identity=a&identity=b&clip=clip-3&from=2026-07-01&to=2026-09-01'),
        { env },
      )).status,
    ).toBe(404);
    // A cross-site Sec-Fetch-Site header is rejected even from a loopback host.
    const crossSite = req(ok);
    crossSite.headers.set('sec-fetch-site', 'cross-site');
    expect((await handleAdPerformanceRequest(crossSite, { env })).status).toBe(404);
  });

  it('enforces exact same-origin: rejects a cross-scheme or credential/path-bearing Origin, allows a valid one', async () => {
    const withOrigin = (origin: string, host = '127.0.0.1:4187') => {
      const r = new Request(`http://${host}/api/dev/ad-performance?${new URLSearchParams(ok)}`);
      r.headers.set('origin', origin);
      return r;
    };
    // Cross-scheme: an `https://` Origin against an `http://` request is NOT same-origin even though
    // the loopback authority (127.0.0.1:4187) matches exactly — it must 404.
    expect(
      (
        await handleAdPerformanceRequest(withOrigin('https://127.0.0.1:4187'), {
          env,
          readSnapshot: () => snapshot(),
        })
      ).status,
    ).toBe(404);
    // A real Origin is scheme://host[:port] only: userinfo, a path or a query make it malformed → 404.
    for (const bad of [
      'http://user:pass@127.0.0.1:4187',
      'http://127.0.0.1:4187/evil',
      'http://127.0.0.1:4187?x=1',
    ])
      expect(
        (await handleAdPerformanceRequest(withOrigin(bad), { env, readSnapshot: () => snapshot() }))
          .status,
      ).toBe(404);
    // A well-formed EXACT same-origin loopback Origin passes end-to-end (200).
    const good = await handleAdPerformanceRequest(withOrigin('http://127.0.0.1:4187'), {
      env,
      readSnapshot: () => snapshot(),
    });
    expect(good.status).toBe(200);
  });

  it('accepts the framework loopback normalization (URL localhost vs Host 127.0.0.1) but nothing broader', async () => {
    // The installed Next `NextURL` rewrites a loopback hostname to `localhost` on request.url while the
    // wire Host header keeps the real `127.0.0.1` alias. A VALID same-origin loopback request must be
    // accepted despite that mismatch — compared against the ACTUAL Host + the request URL scheme.
    const normalized = (
      origin: string | null,
      { urlHost = 'localhost:4187', hostHeader = '127.0.0.1:4187' } = {},
    ) => {
      const r = new Request(`http://${urlHost}/api/dev/ad-performance?${new URLSearchParams(ok)}`);
      r.headers.set('host', hostHeader);
      if (origin) r.headers.set('origin', origin);
      return r;
    };
    // URL localhost:4187 + Host 127.0.0.1:4187 + Origin http://127.0.0.1:4187 → accepted (200).
    expect(
      (
        await handleAdPerformanceRequest(normalized('http://127.0.0.1:4187'), {
          env,
          readSnapshot: () => snapshot(),
        })
      ).status,
    ).toBe(200);
    // Same normalization with NO Origin (loopback curl) is still accepted.
    expect(
      (await handleAdPerformanceRequest(normalized(null), { env, readSnapshot: () => snapshot() }))
        .status,
    ).toBe(200);
    // An Origin on `localhost` must STILL fail against the actual Host 127.0.0.1 → 404.
    expect(
      (
        await handleAdPerformanceRequest(normalized('http://localhost:4187'), {
          env,
          readSnapshot: () => snapshot(),
        })
      ).status,
    ).toBe(404);
    // Other port and cross-scheme Origins remain denied.
    for (const bad of ['http://127.0.0.1:4188', 'https://127.0.0.1:4187'])
      expect(
        (await handleAdPerformanceRequest(normalized(bad), { env, readSnapshot: () => snapshot() }))
          .status,
      ).toBe(404);
    // URL localhost:4188 vs Host 127.0.0.1:4187 is a genuine port mismatch, not framework
    // normalization → 404 (this is NOT any-loopback/any-port acceptance).
    expect(
      (
        await handleAdPerformanceRequest(normalized(null, { urlHost: 'localhost:4188' }), {
          env,
          readSnapshot: () => snapshot(),
        })
      ).status,
    ).toBe(404);
  });

  it('404s when the persisted binding no longer equals the current config binding', async () => {
    // Config now points the same clip/window at a DIFFERENT ad; the old snapshot must not be served.
    const drifted = {
      ...env,
      LABSD_AD_SNAPSHOT_BINDINGS: JSON.stringify([
        {
          identity: 'a',
          clipId: 'clip-3',
          profileId: 'fb',
          namespace: 'meta',
          accountId: '123',
          adId: '52554922813367',
          expectedCreativeId: '1054509270657222',
          currency: 'THB',
          timezone: 'Asia/Bangkok',
          from: '2026-07-01',
          toExclusive: '2026-09-01',
          canViewSpend: false,
        },
      ]),
    };
    const response = await handleAdPerformanceRequest(req(ok), {
      env: drifted,
      readSnapshot: () => snapshot(),
    });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('52513673563767');
  });

  it('404s for a missing snapshot and a cross-identity snapshot without leaking data', async () => {
    const missing = await handleAdPerformanceRequest(req(ok), {
      env,
      readSnapshot: () => {
        throw new MissingSnapshotError('a__clip-3.json');
      },
    });
    expect(missing.status).toBe(404);
    const foreign = await handleAdPerformanceRequest(req(ok), {
      env,
      readSnapshot: () => snapshot({ binding: { ...snapshot().binding, identity: 'b' } }),
    });
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain('52513673563767');
  });

  it('503s when the persisted snapshot fails validation', async () => {
    const response = await handleAdPerformanceRequest(req(ok), { env, readSnapshot: () => ({}) });
    expect(response.status).toBe(503);
  });

  it('serves only Celeb-safe metrics with no-store + marker for a valid snapshot', async () => {
    const response = await handleAdPerformanceRequest(req(ok), { env, readSnapshot: () => snapshot() });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-ad-performance')).toBe(AD_PERFORMANCE_MARKER);
    const body = (await response.json()) as { performance: { metrics: { key: string }[] } };
    const keys = body.performance.metrics.map((m) => m.key).sort();
    expect(keys).toEqual(['cpc', 'ctr', 'roas'].sort());
    // spend hidden (canViewSpend=false); roas visible; no still-prohibited count anywhere.
    expect(keys).not.toContain('spend');
    for (const forbidden of ['impressions', 'video_views', 'reach'])
      expect(keys).not.toContain(forbidden);
  });
});
