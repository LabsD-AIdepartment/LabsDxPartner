import { describe, expect, it } from 'vitest';
import {
  coverageForPeriod,
  PeriodCoverage,
  coverageMatchesPeriod,
  coverageSegmentForDay,
} from '@/contracts/coverage';
import { Overview } from '@/contracts/overview';
import { overviewFixture } from '../../dev/overview-transport';
import { defaultOverviewFilters as filters } from '@/features/overview/model';

const window = (from: string, toExclusive: string) => ({
  from,
  toExclusive,
  timezone: 'Asia/Bangkok' as const,
});
const requested = window('2026-07-01T00:00:00+07:00', '2026-09-01T00:00:00+07:00');
describe('published-period coverage', () => {
  it('clips, sorts and unions published windows without double-counting overlaps', () => {
    const july = window('2026-06-01T00:00:00+07:00', '2026-08-01T00:00:00+07:00');
    const august = window('2026-08-01T00:00:00+07:00', '2026-10-01T00:00:00+07:00');
    const result = coverageForPeriod(requested, [august, july, august]);
    expect(result).toEqual({ status: 'complete', periods: [requested] });
    expect(coverageMatchesPeriod(result, requested)).toBe(true);
  });
  it('distinguishes a gap from no publication, and treats the end as exclusive', () => {
    const result = coverageForPeriod(requested, [
      window(requested.from, '2026-07-15T00:00:00+07:00'),
      window('2026-08-01T00:00:00+07:00', requested.toExclusive),
    ]);
    expect(result.status).toBe('partial');
    expect(result.periods).toHaveLength(2);
    expect(
      coverageForPeriod(requested, [window(requested.toExclusive, '2026-10-01T00:00:00+07:00')]),
    ).toEqual({ status: 'unavailable', periods: [] });
    expect(coverageForPeriod(requested, [])).toEqual({ status: 'unavailable', periods: [] });
  });
  it('compares equivalent timezones but preserves sub-millisecond gaps', () => {
    const utc = window('2026-06-30T17:00:00Z', '2026-08-31T17:00:00Z');
    expect(coverageForPeriod(requested, [utc]).status).toBe('complete');
    const near = [
      window(requested.from, '2026-08-01T00:00:00.000001+07:00'),
      window('2026-08-01T00:00:00.000002+07:00', requested.toExclusive),
    ];
    expect(coverageForPeriod(requested, near).status).toBe('partial');
    expect(
      coverageMatchesPeriod(
        {
          status: 'complete',
          periods: [window('2026-07-01T00:00:00.000001+07:00', requested.toExclusive)],
        },
        requested,
      ),
    ).toBe(false);
    expect(
      coverageSegmentForDay(
        {
          status: 'partial',
          periods: [window(requested.from, '2026-08-01T00:00:00.000001+07:00')],
        },
        '2026-08-01',
      ),
    ).toBe(0);
  });
  it('rejects misleading status, unmerged ranges and out-of-window claims', () => {
    expect(PeriodCoverage.safeParse({ status: 'complete', periods: [] }).success).toBe(false);
    expect(PeriodCoverage.safeParse({ status: 'unavailable', periods: [requested] }).success).toBe(
      false,
    );
    expect(
      PeriodCoverage.safeParse({ status: 'partial', periods: [requested, requested] }).success,
    ).toBe(false);
    expect(coverageMatchesPeriod({ status: 'partial', periods: [requested] }, requested)).toBe(
      false,
    );
    expect(
      coverageMatchesPeriod(
        { status: 'partial', periods: [window('2026-01-01T00:00:00Z', requested.toExclusive)] },
        requested,
      ),
    ).toBe(false);
  });
});
describe('Overview availability contract', () => {
  it('keeps known zero distinct from unknown and permits a separately unknown estimate', () => {
    expect(overviewFixture(filters, 'empty').earnings.confirmed?.minor).toBe('0');
    const unknown = overviewFixture(filters, 'unavailable');
    expect(unknown.earnings.confirmed).toBeNull();
    expect(unknown.obligation.confirmedUnpaid).toBeNull();
    const confirmed = overviewFixture(filters, 'confirmed-only');
    expect(confirmed.earnings.confirmed?.minor).toBe('3736000');
    expect(confirmed.earnings.estimated).toBeNull();
    expect(Overview.safeParse({ ...unknown, obligation: confirmed.obligation }).success).toBe(true);
  });
  it('rejects invented zero/derived charts without coverage and unknown money with complete coverage', () => {
    const unknown = overviewFixture(filters, 'unavailable');
    const ready = overviewFixture(filters);
    expect(
      Overview.safeParse({
        ...unknown,
        earnings: { ...unknown.earnings, confirmed: { currency: 'THB', minor: '0' } },
      }).success,
    ).toBe(false);
    expect(
      Overview.safeParse({
        ...unknown,
        earnings: { ...unknown.earnings, trend: ready.earnings.trend },
      }).success,
    ).toBe(false);
    expect(
      Overview.safeParse({ ...ready, earnings: { ...ready.earnings, confirmed: null } }).success,
    ).toBe(false);
    expect(
      Overview.safeParse({
        ...unknown,
        obligation: { ...unknown.obligation, nextPayout: ready.obligation.nextPayout },
      }).success,
    ).toBe(false);
    const { coverage, ...legacy } = ready.earnings;
    expect(Overview.safeParse({ ...ready, earnings: legacy }).success).toBe(false);
  });
  it('subtotal includes only covered earning dates, while payout stays independent', () => {
    const partial = overviewFixture(filters, 'partial-period');
    expect(partial.earnings.coverage.status).toBe('partial');
    expect(partial.earnings.confirmed?.minor).toBe('2144000');
    expect(partial.earnings.trend.reduce((n, x) => n + BigInt(x.amount.minor), 0n)).toBe(2144000n);
    expect(partial.obligation).toEqual(overviewFixture(filters).obligation);
    const noIntersection = overviewFixture(
      { ...filters, from: '2026-07-01', toExclusive: '2026-07-15' },
      'partial-period',
    );
    expect(noIntersection.earnings.confirmed).toBeNull();
    expect(noIntersection.obligation.confirmedUnpaid?.minor).toBe('2552000');
  });
  it('rejects charts with a wrong total, duplicate days or dates in an unpublished gap', () => {
    const ready = overviewFixture(filters);
    const badTotal = structuredClone(ready);
    badTotal.earnings.trend[0].amount.minor = '1';
    expect(Overview.safeParse(badTotal).success).toBe(false);
    const duplicate = structuredClone(ready);
    duplicate.earnings.trend[1].date = duplicate.earnings.trend[0].date;
    expect(Overview.safeParse(duplicate).success).toBe(false);
    const gap = structuredClone(ready);
    gap.earnings.coverage = coverageForPeriod(requested, [
      window(requested.from, '2026-08-20T00:00:00+07:00'),
    ]);
    expect(Overview.safeParse(gap).success).toBe(false);
  });
  it('reports malformed chart money and dates as validation failures without throwing', () => {
    for (const mutation of [
      (data: ReturnType<typeof overviewFixture>) => {
        data.earnings.trend[0].amount.minor = '1.5';
      },
      (data: ReturnType<typeof overviewFixture>) => {
        data.earnings.confirmed!.minor = 'not-money';
      },
      (data: ReturnType<typeof overviewFixture>) => {
        data.earnings.trend[0].date = 'invalid-date';
      },
    ]) {
      const data = overviewFixture(filters);
      mutation(data);
      expect(Overview.safeParse(data).success).toBe(false);
    }
  });
});
