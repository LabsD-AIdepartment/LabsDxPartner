import { z } from 'zod';
import { Id, Instant, Count, page } from './common';
export const Notice = z.strictObject({
  id: Id,
  statementId: Id,
  title: z.string().min(1),
  kind: z.enum(['statement-published', 'payment-recorded']),
  createdAt: Instant,
  seen: z.boolean(),
});
export const Notifications = page(Notice).extend({ unseenCount: Count });
export const MarkSeenRequest = z.strictObject({ throughNoticeId: Id });
