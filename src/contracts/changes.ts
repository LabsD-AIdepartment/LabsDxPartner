import { z } from 'zod';
import { Id, Instant } from './common';
export const Revision = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(40);
export const ChangeGroups = ['earnings', 'settlements', 'metrics', 'notices'] as const;
export type ChangeGroup = (typeof ChangeGroups)[number];
export const Changes = z.strictObject({
  partnerId: Id,
  permissionRevision: Id,
  earningsRevision: Revision,
  settlementsRevision: Revision,
  metricsRevision: Revision,
  noticesRevision: Revision,
  publishedAt: Instant,
  sources: z.array(
    z.strictObject({
      source: Id,
      dataThrough: Instant.nullable(),
      publishedAt: Instant.nullable(),
    }),
  ),
});
export type ChangesValue = z.infer<typeof Changes>;
