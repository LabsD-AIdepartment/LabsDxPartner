import { z } from 'zod';
import { Freshness, Id, Instant, Money, Period, Count } from './common';
import { ContentCard } from './content';
import { Rate } from './earnings';
import { PeriodCoverage, coverageMatchesPeriod, coverageSegmentForDay } from './coverage';
import { ProfilePresentation } from './catalogue';
// Named sales sources a confirmed daily sale can be attributed to. 'unattributed' is the honest
// fallback when the upstream payload carries no authoritative platform for a sale.
export const SalesPlatform = z.enum([
  'facebook',
  'tiktok',
  'shopee',
  'lazada',
  'web',
  'unattributed',
]);
export type SalesPlatformName = z.infer<typeof SalesPlatform>;
// A daily trend point. `date`/`amount` (confirmed commission) are the original, always-present
// fields. `sales` (the daily eligible-sales base) and `salesByPlatform` are additive and OPTIONAL,
// so hand-authored fixtures written before this field existed still parse. Both are also nullable:
// an explicit null means "unknown" (never zero); a present breakdown must sum exactly to `sales`.
const TrendPoint = z.strictObject({
  date: z.iso.date(),
  amount: Money,
  sales: Money.nullable().optional(),
  salesByPlatform: z
    .array(z.strictObject({ platform: SalesPlatform, sales: Money }))
    .max(6)
    .nullable()
    .optional(),
});
export const Obligation = z
  .strictObject({
    asOf: Instant,
    confirmedUnpaid: Money.nullable(),
    nextPayoutReason: z.string().min(1).max(300).nullable().default(null),
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
  profile: ProfilePresentation.nullable().optional(),
  brands: z.array(Id).max(100).optional(),
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
      trend: z.array(TrendPoint).max(366),
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
      for (const key of ['confirmed', 'eligibleSales', 'unassignedAmount'] as const)
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
          value.contentCount !== null || value.excludedCount !== null)
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
        // Optional daily sales detail. Deliberately NOT reconciled against earnings.eligibleSales:
        // that window total can include estimated current-period sales while the trend is
        // confirmed-only, so a cross-total check would produce false mismatches.
        const breakdown = point.salesByPlatform;
        if (breakdown == null) continue;
        if (point.sales == null) {
          // Unknown daily sales is null, never zero; a platform breakdown cannot stand alone.
          ctx.addIssue({
            code: 'custom',
            path: ['trend', i, 'salesByPlatform'],
            message: 'Platform breakdown requires a known daily sales figure',
          });
          continue;
        }
        const platforms = breakdown.map((entry) => entry.platform);
        if (new Set(platforms).size !== platforms.length)
          ctx.addIssue({
            code: 'custom',
            path: ['trend', i, 'salesByPlatform'],
            message: 'Platform breakdown must list each platform at most once',
          });
        // Guard every BigInt against a regex-invalid Money so malformed detail surfaces as its own
        // field error rather than a thrown exception here.
        if (
          Money.safeParse(point.sales).success &&
          breakdown.every((entry) => Money.safeParse(entry.sales).success) &&
          breakdown.reduce((sum, entry) => sum + BigInt(entry.sales.minor), 0n) !==
            BigInt(point.sales.minor)
        )
          ctx.addIssue({
            code: 'custom',
            path: ['trend', i, 'salesByPlatform'],
            message: 'Platform breakdown must sum exactly to the daily sales',
          });
      }
    }),
  obligation: Obligation,
});
export type OverviewValue = z.infer<typeof Overview>;
