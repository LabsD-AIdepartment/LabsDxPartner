import { describe, expect, it } from 'vitest';
import { Overview } from '@/contracts/overview';
import { loadOverview } from '@/features/overview/model';
import { earningsWeekRange } from '@/features/overview/weekly-earnings';
import { overviewFixture } from '../../dev/overview-transport';
import {
  createWeeklyEarningsSampleTransport,
  generateWeeklyEarningsSample,
  sampleDayBrand,
  sampleDayIndex,
} from '../../dev/weekly-earnings-sample';

const scope = { userId: 'sample-user', partnerId: 'sample-partner', permissionRevision: '1' };
const window7 = (from: string, brand: string | null = null) => {
  const { from: start } = earningsWeekRange(from, 0);
  // earningsWeekRange gives an inclusive 7-day window ending on `from`.
  return { from: start, toExclusive: earningsWeekRange(from, 0).toExclusive, brand };
};
const sum = (values: string[]) => values.reduce((total, minor) => total + BigInt(minor), 0n);

describe('weekly earnings sample generator', () => {
  it('returns a schema-valid, self-consistent seven-day sample with one zero day', () => {
    const filters = window7('2026-09-16');
    const sample = generateWeeklyEarningsSample(filters);
    // Guaranteed to satisfy every Overview invariant.
    expect(() => Overview.parse(sample)).not.toThrow();
    const trend = sample.earnings.trend;
    expect(trend.map((point) => point.date)).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ]);
    // Every latest-7 day covered; six positive samples plus exactly one deliberate zero.
    const amounts = trend.map((point) => point.amount.minor);
    expect(amounts.filter((minor) => minor === '0')).toHaveLength(1);
    expect(amounts.filter((minor) => BigInt(minor) > 0n)).toHaveLength(6);
    // Own coherent totals derived purely from the returned trend.
    expect(sample.earnings.confirmed!.minor).toBe(sum(amounts).toString());
    expect(sample.earnings.eligibleSales!.minor).toBe(
      sum(trend.map((point) => point.sales!.minor)).toString(),
    );
    expect(sample.earnings.period.from).toBe('2026-09-10T00:00:00+07:00');
    expect(sample.earnings.period.toExclusive).toBe('2026-09-17T00:00:00+07:00');
    expect(sample.earnings.coverage.status).toBe('complete');
  });

  it('supplies schema-valid platform splits that sum exactly to each day sales, and omits them on zero days', () => {
    const sample = generateWeeklyEarningsSample(window7('2026-09-16'));
    for (const point of sample.earnings.trend) {
      if (point.sales!.minor === '0') {
        expect(point.salesByPlatform ?? null).toBeNull();
      } else {
        const parts = point.salesByPlatform!;
        expect(new Set(parts.map((p) => p.platform)).size).toBe(parts.length);
        expect(sum(parts.map((p) => p.sales.minor)).toString()).toBe(point.sales!.minor);
      }
    }
  });

  it('shows no fake authored clips or attribution', () => {
    const sample = generateWeeklyEarningsSample(window7('2026-09-16'));
    expect(sample.earnings.topContent).toEqual([]);
    expect(sample.earnings.contentCount).toBeNull();
    expect(sample.earnings.salesByBrand).toBeNull();
  });

  it('respects brand filters: keeps all seven buckets, zeroes other-brand days, and reconciles to the all-brand trend', () => {
    const all = generateWeeklyEarningsSample(window7('2026-09-16', null));
    const axtion = generateWeeklyEarningsSample(window7('2026-09-16', 'Axtion'));
    const tendrix = generateWeeklyEarningsSample(window7('2026-09-16', 'Tendrix'));
    const dates = all.earnings.trend.map((point) => point.date);
    // The same seven date buckets survive under any brand — other-brand days are zeroed, not dropped.
    expect(axtion.earnings.trend.map((point) => point.date)).toEqual(dates);
    expect(tendrix.earnings.trend.map((point) => point.date)).toEqual(dates);
    // A day carries its amount only under its own sample brand; it is exactly zero otherwise.
    for (const point of axtion.earnings.trend)
      if (sampleDayBrand(point.date) !== 'Axtion') expect(point.amount.minor).toBe('0');
    for (const point of tendrix.earnings.trend)
      if (sampleDayBrand(point.date) !== 'Tendrix') expect(point.amount.minor).toBe('0');
    // The two brand trends reconcile to the all-brand trend, day by day and in total.
    all.earnings.trend.forEach((point, i) => {
      const combined =
        BigInt(axtion.earnings.trend[i].amount.minor) + BigInt(tendrix.earnings.trend[i].amount.minor);
      expect(combined.toString()).toBe(point.amount.minor);
    });
    expect(
      (
        BigInt(axtion.earnings.confirmed!.minor) + BigInt(tendrix.earnings.confirmed!.minor)
      ).toString(),
    ).toBe(all.earnings.confirmed!.minor);
  });

  it('produces an all-zero sample for an unknown brand and never invents one', () => {
    const unknown = generateWeeklyEarningsSample(window7('2026-09-16', 'Rusiren'));
    expect(unknown.earnings.trend.map((point) => point.date)).toHaveLength(7);
    expect(unknown.earnings.trend.every((point) => point.amount.minor === '0')).toBe(true);
    expect(unknown.earnings.confirmed!.minor).toBe('0');
    expect(unknown.earnings.eligibleSales!.minor).toBe('0');
  });

  it('keeps each calendar date amount stable irrespective of the requested range', () => {
    const wide = generateWeeklyEarningsSample({
      from: '2026-09-08',
      toExclusive: '2026-09-15',
      brand: null,
    });
    const narrow = generateWeeklyEarningsSample(window7('2026-09-16', null));
    const amountOn = (sample: typeof wide, date: string) =>
      sample.earnings.trend.find((point) => point.date === date)?.amount.minor;
    for (const date of ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'])
      expect(amountOn(wide, date)).toBe(amountOn(narrow, date));
  });

  it('carries its own sample identity, a current watermark, and a deliberately empty obligation', () => {
    const clock = new Date('2026-09-16T12:00:00Z');
    const sample = generateWeeklyEarningsSample(window7('2026-09-16'), clock);
    // Explicit, unmistakable sample identity — never a fixture/template generation id.
    expect(sample.earnings.generation).toBe('weekly-sample-v1');
    // Its own current watermark from the injected clock, not the August template values.
    expect(sample.generatedAt).toBe('2026-09-16T12:00:00Z');
    expect(sample.dataThrough).toBe('2026-09-16T12:00:00Z');
    // No withdrawal truth: an unknown obligation with no next payout and no template money.
    expect(sample.obligation).toEqual({
      asOf: '2026-09-16T12:00:00Z',
      confirmedUnpaid: null,
      nextPayout: null,
      nextPayoutReason: null,
    });
  });

  it('never carries the fixture template generation, watermark or withdrawal values', () => {
    const template = overviewFixture(window7('2026-09-16'), 'empty');
    const sample = generateWeeklyEarningsSample(window7('2026-09-16'), new Date('2026-09-16T12:00:00Z'));
    expect(sample.earnings.generation).not.toBe(template.earnings.generation);
    expect(sample.generatedAt).not.toBe(template.generatedAt);
    expect(sample.dataThrough).not.toBe(template.dataThrough);
    expect(sample.obligation.confirmedUnpaid).toBeNull();
    expect(sample.obligation.nextPayout).toBeNull();
  });

  it('keeps a given calendar date identical across overlapping and previous-week windows', () => {
    const thisWeek = generateWeeklyEarningsSample(window7('2026-09-16'));
    const prevWeek = generateWeeklyEarningsSample(
      (() => {
        const r = earningsWeekRange('2026-09-16', 1);
        return { from: r.from, toExclusive: r.toExclusive, brand: null };
      })(),
    );
    // Overlap the two windows on 2026-09-10 (present in both a shifted window).
    const shifted = generateWeeklyEarningsSample({
      from: '2026-09-08',
      toExclusive: '2026-09-15',
      brand: null,
    });
    const amountOn = (sample: typeof thisWeek, date: string) =>
      sample.earnings.trend.find((p) => p.date === date)?.amount.minor;
    expect(amountOn(thisWeek, '2026-09-10')).toBe(amountOn(shifted, '2026-09-10'));
    expect(amountOn(prevWeek, '2026-09-09')).toBe(amountOn(shifted, '2026-09-09'));
    // The anchored pattern index is a pure function of the calendar date.
    expect(sampleDayIndex('2026-09-10')).toBe(sampleDayIndex('2026-09-17'));
    expect(sampleDayIndex('0001-01-01')).toBe(((Math.round(Date.parse('0001-01-01T00:00:00Z') / 86_400_000) % 7) + 7) % 7);
  });

  it('produces a fresh, isolated response per call', () => {
    const a = generateWeeklyEarningsSample(window7('2026-09-16'));
    const b = generateWeeklyEarningsSample(window7('2026-09-16'));
    expect(a).not.toBe(b);
    expect(a.earnings.trend).not.toBe(b.earnings.trend);
    a.earnings.trend[0] = { ...a.earnings.trend[0], amount: { currency: 'THB', minor: '999' } };
    expect(b.earnings.trend[0].amount.minor).not.toBe('999');
  });

  it('is served through loadOverview with matching period and honoured abort', async () => {
    const transport = createWeeklyEarningsSampleTransport();
    const filters = window7('2026-09-16');
    const value = await loadOverview(transport, {
      scope,
      filters,
      signal: new AbortController().signal,
    });
    expect(value.earnings.period.from).toBe('2026-09-10T00:00:00+07:00');

    const aborter = new AbortController();
    aborter.abort();
    await expect(
      loadOverview(transport, { scope, filters, signal: aborter.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
