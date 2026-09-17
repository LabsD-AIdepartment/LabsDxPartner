import type { OverviewValue } from '@/contracts/overview';
import type { MoneyValue } from '@/contracts/common';
import { coverageForPeriod } from '@/contracts/coverage';
import { addDays, dateNumber } from '@/shared/ui/date-range';

export function bangkokDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}

/** Calendar navigation is independent of the Overview report filter. */
export function earningsWeekRange(today: string, weeksBack: number) {
  const end = addDays(today, 1);
  const floor = '0001-01-01';
  const days = (dateNumber(end)! - dateNumber(floor)!) / 86400000;
  const lastPage = Math.max(0, Math.ceil(days / 7) - 1);
  const page = Math.max(0, Math.min(lastPage, Math.floor(weeksBack)));
  const toExclusive = addDays(end, -page * 7);
  const from = [floor, addDays(toExclusive, -7)].sort().at(-1)!;
  return { from, toExclusive, page, hasPrevious: page < lastPage, hasNext: page > 0 };
}

export function weeklyEarningsPoints(
  earnings: Pick<OverviewValue['earnings'], 'trend' | 'coverage'>,
  range: { from: string; toExclusive: string },
) {
  const known = new Map(earnings.trend.map((point) => [point.date, point.amount]));
  const points: { date: string; amount: MoneyValue | null }[] = [];
  for (let date = range.from; date < range.toExclusive; date = addDays(date, 1)) {
    const fullDay =
      coverageForPeriod(
        {
          from: `${date}T00:00:00+07:00`,
          toExclusive: `${addDays(date, 1)}T00:00:00+07:00`,
          timezone: 'Asia/Bangkok',
        },
        earnings.coverage.periods,
      ).status === 'complete';
    // Sparse source buckets imply zero only inside a fully published day. A supplied
    // partial-day amount remains known; missing/partially covered days remain gaps.
    points.push({
      date,
      amount: known.get(date) ?? (fullDay ? { currency: 'THB', minor: '0' } : null),
    });
  }
  return points;
}
