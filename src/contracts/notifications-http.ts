import { z } from 'zod';
import { Id } from './common';
import { Notifications } from './notifications';
export const NoticePosition = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const NoticeQuery = z.strictObject({
  partnerId: Id,
  permissionRevision: Id,
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});
export const SeenCommand = z.strictObject({
  partnerId: Id,
  permissionRevision: Id,
  throughNoticeId: NoticePosition,
});
export const NotificationResponse = z.strictObject({
  partnerId: Id,
  userId: Id,
  permissionRevision: Id,
  data: Notifications,
});
export const SeenResponse = z.strictObject({
  partnerId: Id,
  userId: Id,
  permissionRevision: Id,
  throughNoticeId: NoticePosition,
});
