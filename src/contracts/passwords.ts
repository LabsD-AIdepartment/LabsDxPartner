import { z } from 'zod';
import { Id } from './common';
import { EvidenceRef, PermissionRevision } from './access';
import { NewPassword } from './credentials';
import { InviteToken } from './invitations';
export const IssuePasswordReset = z.strictObject({
  partnerId: Id,
  userId: Id,
  expectedRevision: PermissionRevision,
  verifiedContactRef: EvidenceRef,
  verificationEvidenceRef: EvidenceRef,
  idempotencyKey: Id,
});
export const ResetPassword = z
  .strictObject({ token: InviteToken, password: NewPassword, passwordConfirmation: NewPassword })
  .refine((v) => v.password === v.passwordConfirmation);
export const ChangePassword = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    password: NewPassword,
    passwordConfirmation: NewPassword,
    idempotencyKey: Id,
  })
  .refine((v) => v.password === v.passwordConfirmation);
