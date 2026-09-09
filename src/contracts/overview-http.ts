import { z } from 'zod';
import { Id, QueryFilters } from './common';
import { Revision } from './changes';
import { Overview } from './overview';

export const OverviewQuery = z.strictObject({
  partnerId: Id,
  permissionRevision: Id,
  from: z.iso.date(),
  toExclusive: z.iso.date(),
  brand: Id.optional(),
  generation: Id.optional(),
}).refine((q) => QueryFilters.safeParse({ from: q.from, toExclusive: q.toExclusive, brand: q.brand ?? null }).success,
  'Select between 1 and 366 days');

export const OverviewResponse = z.strictObject({
  partnerId: Id,
  permissionRevision: Id,
  brand: Id.nullable(),
  earningsRevision: Revision,
  settlementsRevision: Revision,
  catalogueRevision: Revision,
  data: Overview,
});
