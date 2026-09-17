import { z } from 'zod';
import { Id, Instant } from './common';
import {
  AdPlatform,
  CapabilityAvailability,
  SourceMode,
  capabilityRegistry,
} from './platform-capabilities';

export { AdPlatform } from './platform-capabilities';
export const RegistrationScope = z.strictObject({ actorId: Id, permissionRevision: Id });
export const AdTarget = z.strictObject({
  id: Id,
  available: z.boolean().default(true),
  partnerId: Id,
  partnerName: Id,
  clipId: Id,
  clipTitle: z.string().min(1).max(500),
  agreementId: Id,
  agreementLabel: Id,
  cover: z.string().nullable(),
});
export const AdConnection = z
  .strictObject({
    id: Id,
    platform: AdPlatform,
    accountId: Id,
    label: Id,
    state: z.enum(['ready', 'reconnect', 'unsupported']),
    availability: CapabilityAvailability,
  })
  .refine(
    (v) => capabilityRegistry[v.availability.capability].platform === v.platform,
    'Capability belongs to a different platform',
  );
export const AdDraft = z.strictObject({
  targetId: Id,
  connectionId: Id,
  platform: AdPlatform,
  externalId: z
    .string()
    .trim()
    .min(1, 'กรอก Ad ID')
    .max(160)
    .refine((value) => !/[\s\u0000-\u001f\u007f]/u.test(value), 'กรอกเฉพาะ Ad ID โดยไม่มีช่องว่าง'),
});
export const ResolvedAd = z.strictObject({
  receipt: Id,
  expiresAt: Instant,
  draft: AdDraft,
  accountId: Id,
  objectType: z.literal('ad'),
  name: z.string().min(1).max(500),
  delivery: z.enum(['active', 'paused', 'removed', 'unknown']),
  creativeId: Id,
  cover: z.string().nullable(),
});
export const AdAssociation = z.strictObject({
  id: Id,
  target: AdTarget,
  connection: AdConnection,
  externalId: Id,
  objectType: z.literal('ad'),
  name: z.string().min(1).max(500),
  creativeId: Id,
  delivery: ResolvedAd.shape.delivery,
  sync: z.enum(['queued', 'syncing', 'ready', 'needs-attention']),
  createdAt: Instant,
  lastSuccessAt: Instant.nullable(),
  dataThrough: Instant.nullable(),
  issue: z.string().max(500).nullable(),
});
export const AdRegistrationSnapshot = RegistrationScope.extend({
  schemaVersion: z.literal(2),
  sourceMode: SourceMode,
  canManage: z.boolean(),
  targets: z.array(AdTarget).max(500),
  connections: z.array(AdConnection).max(100),
  associations: z.array(AdAssociation).max(500),
});
export const AdRegistrationResult = z.strictObject({
  association: AdAssociation,
  replayed: z.boolean(),
});
export type AdPlatformValue = z.infer<typeof AdPlatform>;
export type AdDraftValue = z.infer<typeof AdDraft>;
export type AdTargetValue = z.infer<typeof AdTarget>;
export type AdConnectionValue = z.infer<typeof AdConnection>;
export type ResolvedAdValue = z.infer<typeof ResolvedAd>;
export type AdAssociationValue = z.infer<typeof AdAssociation>;
export type AdRegistrationValue = z.infer<typeof AdRegistrationSnapshot>;
export type RegistrationScopeValue = z.infer<typeof RegistrationScope>;

/** Legacy single-ad preview payloads stay isolated from the V2 native source adapter. */
export function registrationIssue(
  connection: AdConnectionValue,
  mode: z.infer<typeof SourceMode>,
): string | null {
  if (connection.state === 'reconnect') return 'บัญชีนี้ต้องเชื่อมต่อใหม่ ติดต่อผู้ดูแลบัญชีโฆษณา';
  if (connection.state !== 'ready') return 'บัญชีนี้ยังไม่รองรับรายงานระดับแอด';
  if (connection.availability.phase !== 'enabled' || connection.availability.verifiedAt === null)
    return connection.availability.reason ?? 'การเชื่อมต่อนี้ยังไม่พร้อมใช้งาน';
  if (mode === 'native' && !capabilityRegistry[connection.availability.capability].adIdentity)
    return 'ยังไม่ยืนยันข้อมูลระดับแอดสำหรับการเชื่อมต่อนี้';
  return null;
}
