import { describe, it, expect } from 'vitest';
import {
  projectAdSnapshot,
  AdSnapshotScopeError,
} from '@/server/modules/marketing-ads/facebook/snapshot-projection';
import type { AdSnapshotBindingConfigValue } from '@/server/modules/marketing-ads/facebook/snapshot-config';

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
const money = (key: string, value: string | null, aggregation: 'sum-disjoint' | 'non-additive') => ({
  schemaVersion: 2,
  key,
  value,
  unit: 'money',
  currency: 'THB',
  definition: key,
  unavailableReason: value === null ? 'missing' : null,
  aggregation,
});
const ratio = (key: string, value: string | null) => ({
  schemaVersion: 2,
  key,
  value,
  unit: 'ratio',
  currency: null,
  definition: key,
  unavailableReason: value === null ? 'missing' : null,
  aggregation: 'non-additive',
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
    money('spend', '18260.17', 'sum-disjoint'),
    money('cpc', '2.35', 'non-additive'),
    money('cpm', '85.20', 'non-additive'),
    money('cost_per_purchase', '120.55', 'non-additive'),
    ratio('ctr', '1.53'),
    ratio('roas', '3.760042'),
  ],
};
const snapshot = (canViewSpend: boolean, over: Record<string, unknown> = {}) => ({
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
    canViewSpend,
  },
  requestedPeriod: period,
  report,
  fetchedAt: '2026-09-02T00:00:00Z',
  refreshedBy: 'operator',
  ...over,
});
const request = { identity: 'a', clipId: 'clip-3', from: '2026-07-01', toExclusive: '2026-09-01' };
// The CURRENT server-config binding the request-time projector validates against and takes permission
// from. `canViewSpend` here (not the snapshot's) decides whether spend is shown.
const current = (
  over: Partial<AdSnapshotBindingConfigValue> = {},
): AdSnapshotBindingConfigValue => ({
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
  ...over,
});

describe('ad snapshot projection', () => {
  it('projects exact Celeb-safe metrics; roas visible and spend hidden without permission', () => {
    const p = projectAdSnapshot(snapshot(false), request, current());
    expect(p.state).toBe('ready');
    expect(p.coverage.status).toBe('complete');
    const keys = p.metrics.map((m) => m.key).sort();
    expect(keys).toEqual(['cost_per_purchase', 'cpc', 'cpm', 'ctr', 'roas'].sort());
    expect(p.metrics.some((m) => m.key === 'spend')).toBe(false);
    const get = (k: string) => p.metrics.find((m) => m.key === k)!;
    expect(get('cpc').value).toBe('2.35');
    expect(get('ctr')).toMatchObject({ value: '1.53', unit: 'ratio', aggregation: 'non-additive' });
    expect(get('roas').value).toBe('3.760042');
    // Never leak a still-prohibited count in metrics, series, or reasons.
    for (const forbidden of ['impressions', 'video_views', 'reach']) {
      expect(p.metrics.some((m) => m.key === forbidden)).toBe(false);
      expect(p.series.every((s) => s.metrics.every((m) => m.key !== forbidden))).toBe(true);
    }
    expect(p.reasons.join(' ')).not.toMatch(/\d{3,}/);
  });

  it('includes spend only when the CURRENT config permission allows it (snapshot permission ignored)', () => {
    // Current permission grants spend even though the persisted snapshot said canViewSpend=false.
    const shown = projectAdSnapshot(snapshot(false), request, current({ canViewSpend: true }));
    expect(shown.metrics.find((m) => m.key === 'spend')?.value).toBe('18260.17');
    // A stale snapshot that WAS authorized is re-gated by the current (revoked) permission.
    const hidden = projectAdSnapshot(snapshot(true), request, current({ canViewSpend: false }));
    expect(hidden.metrics.some((m) => m.key === 'spend')).toBe(false);
  });

  it('rejects a snapshot whose binding no longer equals the current config binding', () => {
    for (const drift of [
      { adId: '52554922813367' },
      { accountId: '999' },
      { namespace: 'other' },
      { profileId: 'other-profile' },
      { currency: 'USD' },
      { expectedCreativeId: '9999999999' },
      { expectedVideoId: '9999999999' },
    ] as const) {
      expect(() => projectAdSnapshot(snapshot(false), request, current(drift))).toThrow(
        AdSnapshotScopeError,
      );
    }
    // Labels the source authoritatively as the bound Facebook ad (the UI never guesses).
    expect(projectAdSnapshot(snapshot(false), request, current()).source).toBe(
      'Facebook · Ad 52513673563767',
    );
  });

  it('keeps a missing (unknown) value null rather than zero', () => {
    const withUnknown = snapshot(false, {
      report: { ...report, metrics: [ratio('roas', null), money('cpc', '2.35', 'non-additive')] },
    });
    const p = projectAdSnapshot(withUnknown, request, current());
    expect(p.metrics.find((m) => m.key === 'roas')?.value).toBeNull();
    expect(p.metrics.find((m) => m.key === 'cpc')?.value).toBe('2.35');
  });

  it('rejects window/identity/clip scope mismatches without leaking data', () => {
    expect(() =>
      projectAdSnapshot(snapshot(false), { ...request, toExclusive: '2026-08-31' }, current()),
    ).toThrow(AdSnapshotScopeError);
    expect(() =>
      projectAdSnapshot(snapshot(false), { ...request, identity: 'b' }, current()),
    ).toThrow(AdSnapshotScopeError);
    expect(() =>
      projectAdSnapshot(snapshot(false), { ...request, clipId: 'clip-9' }, current()),
    ).toThrow(AdSnapshotScopeError);
  });

  it('refuses a snapshot that stores a prohibited count', () => {
    const poisoned = snapshot(false, {
      report: {
        ...report,
        metrics: [
          ...report.metrics,
          {
            schemaVersion: 2,
            key: 'reach',
            value: '1000',
            unit: 'count',
            currency: null,
            definition: 'reach',
            unavailableReason: null,
            aggregation: 'non-additive',
          },
        ],
      },
    });
    expect(() => projectAdSnapshot(poisoned, request, current())).toThrow();
  });
});
