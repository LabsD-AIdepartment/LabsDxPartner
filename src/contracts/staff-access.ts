import { z } from 'zod';
import { Id, Instant, page } from './common';
import { EvidenceRef, MemberCapabilities, PermissionRevision, MembershipSummary } from './access';
import { InviteToken } from './invitations';
export const StaffAccessSession = z.strictObject({
  userId: Id,
  displayName: z.string().min(1),
  revision: PermissionRevision,
});
export const StaffAccessQuery = z.strictObject({
  expectedRevision: PermissionRevision,
  partnerId: Id.optional(),
  partnerCursor: Id.nullish(),
  memberCursor: Id.nullish(),
  inviteCursor: Id.nullish(),
});
const Partner = z.strictObject({
  id: Id,
  name: z.string().min(1),
  status: z.enum(['active', 'suspended']),
});
export const AccessMember = MembershipSummary.extend({
  username: z.string().nullable(),
  resetAllowed: z.boolean(),
});
export const AccessInvitation = z.strictObject({
  id: Id,
  recipientName: z.string().nullable(),
  verifiedContactRef: EvidenceRef.nullable(),
  capabilities: MemberCapabilities.nullable(),
  expiresAt: Instant,
  status: z.enum(['pending', 'expired', 'revoked', 'claimed']),
});
export const StaffAccessSnapshot = z.strictObject({
  session: StaffAccessSession,
  partners: page(Partner),
  selected: z
    .strictObject({
      partner: Partner,
      members: page(AccessMember),
      invitations: page(AccessInvitation),
    })
    .nullable(),
});
export const IssuedInvitation = z.strictObject({
  id: Id,
  partnerId: Id,
  token: InviteToken.nullable(),
  replayed: z.boolean(),
});
export const RevokedInvitation = z.strictObject({ id: Id, partnerId: Id, replayed: z.boolean() });
export const IssuedReset = z.strictObject({
  id: Id,
  expiresAt: Instant,
  token: InviteToken.nullable(),
});
export type StaffAccessSessionValue = z.infer<typeof StaffAccessSession>;
export type StaffAccessSnapshotValue = z.infer<typeof StaffAccessSnapshot>;

export const ChangedMembership = z.strictObject({
  membershipId: Id,
  revision: PermissionRevision,
  replayed: z.boolean(),
});
