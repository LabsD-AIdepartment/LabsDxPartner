import { z } from 'zod';
import { Id } from './common';

export const PartnerCapability = z.enum([
  'view_earnings',
  'view_content',
  'view_statements',
  'view_ad_spend',
]);
export const EvidenceRef = Id.regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const PermissionRevision = z
  .string()
  .regex(/^[1-9]\d*$/)
  .max(19)
  .refine((v) => /^[1-9]\d*$/.test(v) && v.length <= 19 && BigInt(v) <= 9223372036854775807n);
export const MemberCapabilities = z
  .array(PartnerCapability)
  .max(4)
  .refine((v) => new Set(v).size === v.length)
  .transform((v) => v.sort());
export const MembershipChange = z
  .strictObject({
    partnerId: Id,
    userId: Id,
    expectedRevision: PermissionRevision,
    status: z.enum(['active', 'suspended']),
    verifiedContactRef: EvidenceRef,
    capabilities: MemberCapabilities,
    idempotencyKey: Id,
  })
  .refine((v) => v.status !== 'active' || v.capabilities.length > 0);
