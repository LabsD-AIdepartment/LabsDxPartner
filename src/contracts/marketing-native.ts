import { z } from 'zod';
import { Id, Instant } from './common';
import { AdDraft, RegistrationScope } from './ad-registration';
import { ResolvedSourceV2 } from './platform-capabilities';
export const NativeAdLookup = RegistrationScope.extend({ draft: AdDraft });
export const NativeAdSave = NativeAdLookup.extend({
  receipt: z.uuid(),
  idempotencyKey: z.uuid(),
});
export const NativeAdReceipt = z.strictObject({
  schemaVersion: z.literal(2),
  receipt: z.uuid(),
  expiresAt: Instant,
  draft: AdDraft,
  source: ResolvedSourceV2,
});
export const NativeAdSaved = z.strictObject({
  schemaVersion: z.literal(2),
  associationId: z.uuid(),
  jobId: z.uuid(),
  partnerId: Id,
  clipId: Id,
  agreementId: Id,
  externalId: Id,
  replayed: z.boolean(),
});
export const NativeTargetCreate = RegistrationScope.extend({
  partnerId: Id,
  clipId: Id,
  agreementId: Id,
  agreementLabel: z.string().trim().min(1).max(160),
  evidenceRef: z.string().trim().min(1).max(500),
  idempotencyKey: z.uuid(),
});
export const NativeTargetSaved = z.strictObject({ targetId: Id, replayed: z.boolean() });
export const NativeTargetQuery = RegistrationScope.extend({
  q: z.string().trim().max(160).default(''),
});
export const NativeTargetOptions = NativeTargetQuery.extend({
  hasMore: z.boolean(),
  clips: z
    .array(
      z.strictObject({
        partnerId: Id,
        partnerName: Id,
        clipId: Id,
        title: z.string().min(1).max(500),
      }),
    )
    .max(500),
});
