import { describe, expect, it } from 'vitest';
import {
  videoDailySchedule,
  videoFailurePolicy,
} from '@/server/modules/marketing-ads/tiktok-shop/video-schedule';

describe('TikTok shop daily scheduling', () => {
  it('uses shop dates and excludes the current day across UTC and DST boundaries', () => {
    const now = Date.parse('2026-03-09T00:30:00Z');
    expect(
      videoDailySchedule('Asia/Bangkok', now, { historyDays: 2 }).windows.map((w) => w.period),
    ).toEqual([
      { from: '2026-03-08', toExclusive: '2026-03-09' },
      { from: '2026-03-07', toExclusive: '2026-03-08' },
    ]);
    expect(
      videoDailySchedule('America/New_York', now, { historyDays: 1 }).windows[0].period,
    ).toEqual({ from: '2026-03-07', toExclusive: '2026-03-08' });
  });
  it('keeps leap-day coverage disjoint and uses separate recent and historical cadences', () => {
    const plan = videoDailySchedule('UTC', Date.parse('2028-03-01T01:00:00Z'), {
      historyDays: 3,
      recentDays: 1,
    });
    expect(plan.from).toBe('2028-02-27');
    expect(plan.windows.map((w) => [w.period.from, w.refreshSeconds])).toEqual([
      ['2028-02-29', 3600],
      ['2028-02-28', 86400],
      ['2028-02-27', 86400],
    ]);
  });
  it('rejects unbounded policies, invalid dates and timezones before planning', () => {
    for (const policy of [
      { historyDays: 367 },
      { historyDays: 0 },
      { recentSeconds: 0 },
      { unknown: true },
    ])
      expect(() => videoDailySchedule('UTC', Date.now(), policy)).toThrow();
    expect(() => videoDailySchedule('Unknown/Zone', Date.now())).toThrow();
    expect(() => videoDailySchedule('UTC', NaN)).toThrow();
  });
  it('backs off temporary failures without shortening provider minimums or retrying permanent failures', () => {
    expect(videoFailurePolicy('temporary', 1, 0)).toEqual({ paused: false, delayMs: 60000 });
    expect(videoFailurePolicy('temporary', 2, 0).delayMs).toBe(120000);
    expect(videoFailurePolicy('temporary', 30, 0).delayMs).toBe(3600000);
    expect(videoFailurePolicy('throttled', 1, 10 * 86400000).delayMs).toBe(10 * 86400000);
    for (const reason of ['access', 'invalid-source', 'page-limit'])
      expect(videoFailurePolicy(reason, 1, 0).paused).toBe(true);
  });
});
