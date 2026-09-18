import { z } from 'zod';
import { Id } from './common';

// Self-entered contact metadata only. Never a verified identity or recovery destination.
export const ContactEmail = z.string().trim().pipe(z.email().max(200));
export const ContactPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,40}$/)
  .transform((value) => value.replace(/[ ()-]/g, ''))
  .refine((value) => /^\+?[0-9]{8,15}$/.test(value), 'Invalid phone number');
export const AccountContact = z.strictObject({
  email: ContactEmail.nullable(),
  phone: ContactPhone.nullable(),
});
export const ContactQuery = z.strictObject({ partnerId: Id, permissionRevision: Id });
const Revision = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
export const ContactSave = ContactQuery.extend({
  expectedUserId: Id,
  expectedRevision: Revision,
  contact: AccountContact,
});
export const ContactSnapshot = ContactQuery.extend({
  userId: Id,
  revision: Revision,
  contact: AccountContact,
  verification: z.literal('unverified'),
});
export type ContactSnapshotValue = z.infer<typeof ContactSnapshot>;
export type AccountContactValue = z.infer<typeof AccountContact>;
