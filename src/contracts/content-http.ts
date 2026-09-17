import { z } from 'zod';
import { Id, QueryFilters } from './common';
import { Revision } from './changes';
import {
  ContentListResponse,
  ContentDetailResponse,
  AdListResponse,
  AdDetailResponse,
} from './content';
import { EarningsResponse } from './earnings';

export const ContentQuery = z
  .strictObject({
    partnerId: Id,
    permissionRevision: Id,
    resource: z.enum(['list', 'detail', 'earnings', 'ads', 'ad']),
    from: z.iso.date(),
    toExclusive: z.iso.date(),
    brand: Id.optional(),
    q: z.string().max(160).default(''),
    generation: Id.optional(),
    cursor: z.string().min(1).max(1000).optional(),
    contentId: Id.optional(),
    adId: Id.optional(),
  })
  .refine(
    (q) =>
      QueryFilters.safeParse({
        ...{ from: q.from, toExclusive: q.toExclusive, brand: q.brand ?? null, q: q.q },
      }).success,
  )
  .refine((q) =>
    q.resource === 'list'
      ? !q.contentId && !q.adId
      : !!q.contentId && (q.resource === 'ad' ? !!q.adId : !q.adId),
  )
  .refine((q) => !q.cursor || ['list', 'earnings', 'ads'].includes(q.resource));

const scope = {
  partnerId: Id,
  permissionRevision: Id,
  brand: Id.nullable(),
  q: z.string().max(160),
  contentId: Id.nullable(),
  adId: Id.nullable(),
  earningsRevision: Revision,
  catalogueRevision: Revision,
};
export const ContentHttpResponse = z.discriminatedUnion('resource', [
  z.strictObject({ ...scope, resource: z.literal('list'), result: ContentListResponse }),
  z.strictObject({ ...scope, resource: z.literal('detail'), result: ContentDetailResponse }),
  z.strictObject({ ...scope, resource: z.literal('earnings'), result: EarningsResponse }),
  z.strictObject({ ...scope, resource: z.literal('ads'), result: AdListResponse }),
  z.strictObject({ ...scope, resource: z.literal('ad'), result: AdDetailResponse }),
]);
