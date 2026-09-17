import { describe, it, expect } from 'vitest';
import {
  adSnapshotAutoRefreshEnabled,
  adSnapshotWindowFileName,
  deriveRequestedWindowBinding,
  parseAdSnapshotBindings,
} from '@/server/modules/marketing-ads/facebook/snapshot-config';

// The store's SAFE_NAME allowlist (kept in sync here as a defensive assertion): leading lowercase-alnum,
// then `__`, then only `[A-Za-z0-9_-]`, ending `.json`. A window file name must satisfy it (no traversal).
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*__[A-Za-z0-9_-]+\.json$/;

const binding = parseAdSnapshotBindings(
  JSON.stringify([
    {
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
    },
  ]),
)[0];

describe('ad snapshot auto-refresh config helpers', () => {
  it('is opt-in and off by default, independent of the enable flag', () => {
    expect(adSnapshotAutoRefreshEnabled({})).toBe(false);
    expect(adSnapshotAutoRefreshEnabled({ LABSD_AD_SNAPSHOT_AUTO_REFRESH: '0' })).toBe(false);
    expect(adSnapshotAutoRefreshEnabled({ LABSD_AD_SNAPSHOT_ENABLED: '1' })).toBe(false);
    expect(adSnapshotAutoRefreshEnabled({ LABSD_AD_SNAPSHOT_AUTO_REFRESH: '1' })).toBe(true);
  });

  it('derives a path-safe, window-specific file name distinct from the legacy base file', () => {
    const name = adSnapshotWindowFileName(binding, '2026-07-01', '2026-09-01');
    expect(name).toBe('a__clip-3__2026-07-01__2026-09-01.json');
    expect(SAFE_NAME.test(name)).toBe(true);
    // A different window yields a different file (cache window separation) and never the base name.
    const other = adSnapshotWindowFileName(binding, '2026-06-01', '2026-07-01');
    expect(other).toBe('a__clip-3__2026-06-01__2026-07-01.json');
    expect(other).not.toBe('a__clip-3.json');
    expect(name).not.toBe(other);
  });

  it('derives a requested-window binding, keeping every verified dimension but the window', () => {
    const derived = deriveRequestedWindowBinding(binding, '2026-06-01', '2026-07-01');
    expect(derived.from).toBe('2026-06-01');
    expect(derived.toExclusive).toBe('2026-07-01');
    // Verified ad identity is unchanged.
    expect(derived.adId).toBe(binding.adId);
    expect(derived.accountId).toBe(binding.accountId);
    expect(derived.expectedCreativeId).toBe(binding.expectedCreativeId);
    expect(derived.expectedVideoId).toBe(binding.expectedVideoId);
    expect(derived.currency).toBe(binding.currency);
    expect(derived.canViewSpend).toBe(binding.canViewSpend);
  });

  it('rejects an invalid, out-of-range, zero, reversed, or leap-invalid requested window', () => {
    // 94-day span exceeds the 93-day bound.
    expect(() => deriveRequestedWindowBinding(binding, '2026-06-01', '2026-09-03')).toThrow();
    // Zero-day and reversed windows.
    expect(() => deriveRequestedWindowBinding(binding, '2026-07-01', '2026-07-01')).toThrow();
    expect(() => deriveRequestedWindowBinding(binding, '2026-09-01', '2026-07-01')).toThrow();
    // Non-existent calendar dates (never reach the provider).
    expect(() => deriveRequestedWindowBinding(binding, '2026-02-30', '2026-03-05')).toThrow();
    expect(() => deriveRequestedWindowBinding(binding, '2027-02-29', '2027-03-05')).toThrow();
    // A valid single-day window is accepted (1..93 inclusive lower bound).
    expect(deriveRequestedWindowBinding(binding, '2026-07-01', '2026-07-02').toExclusive).toBe(
      '2026-07-02',
    );
  });
});
