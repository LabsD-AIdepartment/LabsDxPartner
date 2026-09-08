import { z } from 'zod';
import { Freshness, Id, Instant, Money, Period, Count } from './common';
import { ContentCard } from './content';
export const Obligation = z.strictObject({
  asOf: Instant,
  confirmedUnpaid: Money,
  nextPayout: z
    .strictObject({
      statementId: Id,
      scheduledAt: Instant,
      amount: Money,
      period: Period.nullable().default(null),
    })
    .nullable(),
});
export const Overview = Freshness.extend({
  earnings: z.strictObject({
    generation: Id,
    period: Period,
    estimated: Money,
    confirmed: Money,
    eligibleSales: Money,
    unassignedAmount: Money,
    excludedCount: Count,
    trend: z.array(z.strictObject({ date: z.iso.date(), amount: Money })).max(366),
    topContent: z.array(ContentCard).max(3),
  }),
  obligation: Obligation,
});
export type OverviewValue = z.infer<typeof Overview>;
