import { z } from 'zod';
import { Period } from './common';

type Window = z.infer<typeof Period>;

/** Compare ISO instants without discarding the source's fractional-second precision. */
function compare(a: string, b: string) {
  const parts = (value: string) => {
    const fraction = value.match(/\.(\d+)(?=Z|[+-])/);
    return {
      second: Date.parse(value.replace(/\.\d+(?=Z|[+-])/, '')),
      fraction: fraction?.[1] ?? '',
    };
  };
  const left = parts(a),
    right = parts(b);
  if (left.second !== right.second) return left.second < right.second ? -1 : 1;
  const length = Math.max(left.fraction.length, right.fraction.length);
  const l = left.fraction.padEnd(length, '0'),
    r = right.fraction.padEnd(length, '0');
  return l === r ? 0 : l < r ? -1 : 1;
}

export const PeriodCoverage = z
  .strictObject({
    status: z.enum(['complete', 'partial', 'unavailable']),
    periods: z.array(Period).max(1000),
  })
  .superRefine((value, ctx) => {
    if ((value.status === 'unavailable') !== (value.periods.length === 0))
      ctx.addIssue({ code: 'custom', message: 'Unavailable coverage must have no periods' });
    for (let i = 1; i < value.periods.length; i++) {
      if (compare(value.periods[i - 1].toExclusive, value.periods[i].from) >= 0)
        ctx.addIssue({
          code: 'custom',
          message: 'Coverage periods must be sorted, disjoint and merged',
        });
    }
  });
export type PeriodCoverageValue = z.infer<typeof PeriodCoverage>;

/** First published window overlapping this validated ISO date in Bangkok. */
export function coverageSegmentForDay(coverage: PeriodCoverageValue, date: string) {
  const from = date + 'T00:00:00+07:00';
  const nextDate = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const to = nextDate + 'T00:00:00+07:00';
  return coverage.periods.findIndex(
    (p) => compare(from, p.toExclusive) < 0 && compare(to, p.from) > 0,
  );
}

export function coverageMatchesPeriod(coverage: PeriodCoverageValue, period: Window) {
  if (
    coverage.periods.some(
      (p) => compare(p.from, period.from) < 0 || compare(p.toExclusive, period.toExclusive) > 0,
    )
  )
    return false;
  const complete =
    coverage.periods.length === 1 &&
    compare(coverage.periods[0].from, period.from) === 0 &&
    compare(coverage.periods[0].toExclusive, period.toExclusive) === 0;
  return (coverage.status === 'complete') === complete;
}

/** Only pass authoritative published windows, never event dates or candidate import periods. */
export function coverageForPeriod(
  requested: Window,
  published: readonly Window[],
): PeriodCoverageValue {
  const period = Period.parse(requested);
  const clipped = published
    .map((raw) => {
      const p = Period.parse(raw);
      return {
        from: compare(p.from, period.from) < 0 ? period.from : p.from,
        toExclusive:
          compare(p.toExclusive, period.toExclusive) > 0 ? period.toExclusive : p.toExclusive,
        timezone: period.timezone,
      };
    })
    .filter((p) => compare(p.from, p.toExclusive) < 0)
    .sort((a, b) => compare(a.from, b.from));
  const periods: Window[] = [];
  for (const p of clipped) {
    const last = periods.at(-1);
    if (last && compare(p.from, last.toExclusive) <= 0) {
      if (compare(p.toExclusive, last.toExclusive) > 0) last.toExclusive = p.toExclusive;
    } else periods.push({ ...p });
  }
  const complete =
    periods.length === 1 &&
    compare(periods[0].from, period.from) === 0 &&
    compare(periods[0].toExclusive, period.toExclusive) === 0;
  return PeriodCoverage.parse({
    status: complete ? 'complete' : periods.length ? 'partial' : 'unavailable',
    periods,
  });
}
