import { describe, it, expect } from 'vitest';
import { dailyReportWindows } from '@/server/modules/marketing-ads/sync-plan';
describe('account calendar scheduling', () => {
  it('plans today first in the account timezone with an exclusive next-day boundary', () => {
    const rows = dailyReportWindows('Asia/Bangkok', Date.parse('2026-09-09T20:00:00Z'), 9);
    expect(rows[0].period).toEqual({
      from: '2026-09-09T17:00:00.000Z',
      toExclusive: '2026-09-10T17:00:00.000Z',
      timezone: 'Asia/Bangkok',
    });
    expect(rows.slice(0, 7).every((r) => r.refreshSeconds === 900)).toBe(true);
    expect(rows[7].refreshSeconds).toBe(86400);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].period.toExclusive).toBe(rows[i - 1].period.from);
  });
  it.each([
    ['2026-03-08T15:00:00Z', 23],
    ['2026-11-01T16:00:00Z', 25],
  ])('honors DST for %s', (now, hours) => {
    const [{ period }] = dailyReportWindows('America/New_York', Date.parse(now), 1);
    expect((Date.parse(period.toExclusive) - Date.parse(period.from)) / 3600_000).toBe(hours);
  });
  it('rejects invalid horizons and zones rather than creating unbounded work', () => {
    for (const days of [0, 367, 1.5])
      expect(() => dailyReportWindows('Asia/Bangkok', Date.now(), days)).toThrow();
    expect(() => dailyReportWindows('unknown', Date.now())).toThrow();
  });
});
