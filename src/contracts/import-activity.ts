import { z } from 'zod';
import { Id, Instant } from './common';
import { RegistrationScope } from './ad-registration';
export const ImportActivityQuery = RegistrationScope.extend({
  platform: z.enum(['facebook', 'tiktok']),
});
const Count = z.number().int().nonnegative();
export const ImportActivitySnapshot = ImportActivityQuery.extend({
  evaluatedAt: Instant,
  connections: z
    .array(
      z
        .strictObject({
          connectionId: Id,
          revision: Id,
          paused: z.boolean(),
          reports: Count,
          running: Count,
          waiting: Count,
          scheduled: Count,
          attention: Count,
          oldestWaitingAt: Instant.nullable(),
          nextAttemptAt: Instant.nullable(),
          freshness: z
            .object({
              imported: Count,
              missing: Count,
              refreshDue: Count,
              oldestSuccessAt: Instant.nullable(),
              latestSuccessAt: Instant.nullable(),
              oldestRefreshDueAt: Instant.nullable(),
            })
            .optional(),
        })
        .refine(
          (c) => c.reports === c.running + c.waiting + c.scheduled + c.attention,
          'Queue counts must reconcile',
        )
        .refine(
          (c) =>
            !c.freshness ||
            (c.freshness.imported + c.freshness.missing === c.reports &&
              c.freshness.refreshDue <= c.freshness.imported &&
              c.freshness.imported > 0 === (c.freshness.oldestSuccessAt !== null) &&
              c.freshness.imported > 0 === (c.freshness.latestSuccessAt !== null) &&
              c.freshness.refreshDue > 0 === (c.freshness.oldestRefreshDueAt !== null)),
          'Report coverage must reconcile',
        ),
    )
    .max(100),
});
