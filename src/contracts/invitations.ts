import { z } from 'zod';
import { Id, Instant } from './common';
import { EvidenceRef, MemberCapabilities } from './access';
import { NewPassword, Username } from './credentials';

export const InviteToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const ActivationInviteRequest = z.strictObject({
  partnerId: Id,
  recipientName: z.string().trim().min(1).max(200),
  verifiedContactRef: EvidenceRef,
  capabilities: MemberCapabilities.refine((value) => value.length > 0),
  expiresAt: Instant,
  idempotencyKey: Id,
});
export const ActivateAccount = z
  .strictObject({
    token: InviteToken,
    username: Username,
    password: NewPassword,
    passwordConfirmation: NewPassword,
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'ยืนยันรหัสผ่านให้ตรงกับรหัสผ่านที่ตั้งไว้',
  });
export const AcceptInvitation = z.strictObject({ token: InviteToken });
