import { z } from 'zod';
import { Id } from './common';
export const InvitationContext = z.strictObject({
  partnerName: z.string().min(1),
  recipientName: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export const ActivatedAccount = z.strictObject({
  userId: Id,
  partnerId: Id,
  membershipId: Id,
  status: z.literal('active'),
});
export const PasswordResetContext = z.strictObject({
  username: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export const PasswordChanged = z.strictObject({ status: z.literal('requires-login') });
