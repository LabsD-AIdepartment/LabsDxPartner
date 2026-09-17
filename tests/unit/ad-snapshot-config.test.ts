import { describe, it, expect } from 'vitest';
import {
  adSnapshotEnabled,
  parseAdSnapshotBindings,
  readAdSnapshotBindings,
  findAdSnapshotBinding,
  adSnapshotDir,
  adSnapshotFileName,
} from '@/server/modules/marketing-ads/facebook/snapshot-config';

const binding = {
  identity: 'a',
  clipId: 'clip-3',
  profileId: 'fb-primary',
  namespace: 'meta',
  accountId: '1234567890',
  adId: '52513673563767',
  expectedCreativeId: '1004085732033027',
  expectedVideoId: '2629443027486387',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
  from: '2026-07-01',
  toExclusive: '2026-09-01',
  canViewSpend: false,
};
const bindings = JSON.stringify([binding]);

describe('ad snapshot config', () => {
  it('stays disabled and empty by default', () => {
    expect(adSnapshotEnabled({})).toBe(false);
    expect(readAdSnapshotBindings({ LABSD_AD_SNAPSHOT_BINDINGS: bindings })).toEqual([]);
    expect(
      readAdSnapshotBindings({ LABSD_AD_SNAPSHOT_ENABLED: '1', LABSD_AD_SNAPSHOT_BINDINGS: bindings }),
    ).toHaveLength(1);
  });

  it('rejects invalid, out-of-range, and duplicate bindings', () => {
    expect(() => parseAdSnapshotBindings(undefined)).toThrow();
    expect(() => parseAdSnapshotBindings('not json')).toThrow();
    expect(() =>
      parseAdSnapshotBindings(JSON.stringify([{ ...binding, adId: 'not-numeric' }])),
    ).toThrow();
    // 94-day window exceeds the 93-day bound.
    expect(() =>
      parseAdSnapshotBindings(JSON.stringify([{ ...binding, toExclusive: '2026-10-03' }])),
    ).toThrow();
    expect(() => parseAdSnapshotBindings(JSON.stringify([binding, binding]))).toThrow('Duplicate');
    // expectedCreativeId is required; a non-numeric creative/video id is rejected.
    const { expectedCreativeId: _omit, ...noCreative } = binding;
    void _omit;
    expect(() => parseAdSnapshotBindings(JSON.stringify([noCreative]))).toThrow();
    expect(() =>
      parseAdSnapshotBindings(JSON.stringify([{ ...binding, expectedVideoId: 'nope' }])),
    ).toThrow();
  });

  it('defaults an omitted expectedVideoId to null but keeps expectedCreativeId', () => {
    const { expectedVideoId: _v, ...noVideo } = binding;
    void _v;
    const [parsed] = parseAdSnapshotBindings(JSON.stringify([noVideo]));
    expect(parsed.expectedCreativeId).toBe('1004085732033027');
    expect(parsed.expectedVideoId).toBeNull();
  });

  it('finds a binding only by exact identity + clip', () => {
    const parsed = parseAdSnapshotBindings(bindings);
    expect(findAdSnapshotBinding(parsed, 'a', 'clip-3')?.adId).toBe('52513673563767');
    expect(findAdSnapshotBinding(parsed, 'b', 'clip-3')).toBeNull();
    expect(findAdSnapshotBinding(parsed, 'a', 'clip-sep-2')).toBeNull();
  });

  it('derives a path-safe deterministic file name and rejects escaping dirs', () => {
    expect(adSnapshotFileName(binding)).toBe('a__clip-3.json');
    expect(() => adSnapshotDir({ LABSD_AD_SNAPSHOT_DIR: '/etc' })).toThrow();
    expect(adSnapshotDir({ LABSD_AD_SNAPSHOT_DIR: 'snapshots/x' })).toContain('snapshots/x');
    expect(adSnapshotDir({})).toContain('20260917-ad-performance/snapshots');
  });
});
