import { z } from 'zod';
import { Freshness, Id, Instant, Money, Period, Count } from './common';
import { ContentCard } from './content';
import { Rate } from './earnings';
import { PeriodCoverage, coverageMatchesPeriod, coverageSegmentForDay } from './coverage';
export const Obligation = z
  .strictObject({
    asOf: Instant,
    confirmedUnpaid: Money.nullable(),
    nextPayout: z
      .strictObject({
        statementId: Id,
        scheduledAt: Instant,
        amount: Money,
        period: Period.nullable().default(null),
      })
      .nullable(),
  })
  .refine(
    (value) => value.confirmedUnpaid !== null || value.nextPayout === null,
    'Unknown obligation cannot establish a next payout',
  );
export const Overview = Freshness.extend({
  earnings: z
    .strictObject({
      generation: Id,
      period: Period,
      coverage: PeriodCoverage,
      estimated: Money.nullable(),
      confirmed: Money.nullable(),
      eligibleSales: Money.nullable(),
      unassignedAmount: Money.nullable(),
      excludedCount: Count.nullable(),
      salesByBrand: z
        .array(z.strictObject({ label: z.string(), value: Money }))
        .max(100)
        .nullable()
        .default(null),
      channelBreakdown: z
        .strictObject({
          organic: Money,
          brandAds: Money,
          other: Money,
          organicRatePpm: Rate.nullable().default(null),
          brandAdsRatePpm: Rate.nullable().default(null),
        })
        .nullable()
        .default(null),
      contentCount: Count.nullable().default(null),
      trend: z.array(z.strictObject({ date: z.iso.date(), amount: Money })).max(366),
      topContent: z.array(ContentCard).max(3),
    })
    .superRefine((value, ctx) => {
      // Zod can still run refinements after a regex/date refinement fails.
      // Reject malformed wire data as validation errors, never BigInt/Date exceptions.
      if (
        !Period.safeParse(value.period).success ||
        !PeriodCoverage.safeParse(value.coverage).success
      )
        return;
      if (
        (value.confirmed !== null && !Money.safeParse(value.confirmed).success) ||
        value.trend.some(
          (p) => !Money.safeParse(p.amount).success || !z.iso.date().safeParse(p.date).success,
        )
      )
        return;
      if (!coverageMatchesPeriod(value.coverage, value.period))
        ctx.addIssue({
          code: 'custom',
          path: ['coverage'],
          message: 'Coverage must match the requested period',
        });
      const unknown = value.coverage.status === 'unavailable';
      for (const key of [
        'confirmed',
        'eligibleSales',
        'unassignedAmount',
        'excludedCount',
      ] as const)
        if ((value[key] === null) !== unknown)
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Confirmed projection must match published coverage',
          });
      if (
        unknown &&
        (value.trend.length ||
          value.topContent.length ||
          value.salesByBrand !== null ||
          value.channelBreakdown !== null ||
          value.contentCount !== null)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Unavailable confirmed earnings cannot include derived projections',
        });
      if (
        value.confirmed &&
        value.trend.reduce((sum, point) => sum + BigInt(point.amount.minor), 0n) !==
          BigInt(value.confirmed.minor)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['trend'],
          message: 'Daily earnings must reconcile to confirmed total',
        });
      for (let i = 0; i < value.trend.length; i++) {
        const point = value.trend[i];
        if (
          coverageSegmentForDay(value.coverage, point.date) < 0 ||
          (i > 0 && value.trend[i - 1].date >= point.date)
        )
          ctx.addIssue({
            code: 'custom',
            path: ['trend', i],
            message: 'Daily earnings must be ordered, unique and within published coverage',
          });
      }
    }),
  obligation: Obligation,
});
export type OverviewValue = z.infer<typeof Overview>;
