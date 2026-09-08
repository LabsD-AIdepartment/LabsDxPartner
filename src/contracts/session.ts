import { z } from 'zod';
import { Id } from './common';
export const Provider = z.enum(['google', 'line', 'apple']);
export const Capability = z.enum([
  'view_earnings',
  'view_content',
  'view_statements',
  'view_ad_spend',
  'manage_partners',
  'publish_statements',
  'record_payments',
]);
export const Membership = z.strictObject({
  partnerId: Id,
  partnerName: z.string().min(1),
  permissionRevision: Id,
  capabilities: z.array(Capability),
});
export const Session = z
  .strictObject({
    userId: Id,
    displayName: z.string().min(1),
    activePartnerId: Id.nullable(),
    memberships: z.array(Membership),
    access: z.enum(['active', 'pending', 'suspended']),
  })
  .refine(
    (s) => s.access !== 'active' || s.memberships.some((m) => m.partnerId === s.activePartnerId),
    'Active partner requires membership',
  );
export type SessionValue = z.infer<typeof Session>;
