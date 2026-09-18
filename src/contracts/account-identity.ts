import { z } from 'zod';
import { Id } from './common';
import { Username, passwordPolicy } from './credentials';
export const ChangeAccountIdentity = z.strictObject({
  expectedUserId: Id,
  partnerId: Id,
  permissionRevision: Id,
  expectedName: z.string().min(1).max(200),
  expectedUsername: Username,
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\x00-\x1f\x7f]+$/),
  username: Username,
  currentPassword: z.string().min(1).max(passwordPolicy.maxLength),
  idempotencyKey: Id,
});
export const AccountIdentityChanged = z.strictObject({ status: z.literal('requires-login') });
