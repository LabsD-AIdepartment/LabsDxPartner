import { z } from 'zod';
import { Id, Instant } from './common';
import { Revision } from './changes';

// Application-hosted assets only; no arbitrary fetches, path traversal or query credentials.
export const MediaPath = z
  .string()
  .max(250)
  .regex(/^\/media\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:png|jpe?g|webp|avif)$/);
export const CoverPosition = z.string().regex(/^(?:100|[1-9]?\d)% (?:100|[1-9]?\d)%$/);
export const ProfilePresentation = z.strictObject({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(100),
  portrait: MediaPath.nullable(),
  avatar: MediaPath.nullable(),
});
export const CatalogueClip = z.strictObject({
  id: Id,
  title: z.string().trim().min(1).max(500),
  brand: Id,
  publishedAt: Instant,
  cover: MediaPath.nullable(),
  coverPosition: CoverPosition,
  removed: z.boolean(),
  sourceUrl: z
    .url()
    .max(2000)
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    })
    .nullable(),
});
export const CatalogueSnapshot = z
  .strictObject({
    schema: z.literal('partner-catalogue/1'),
    mode: z.literal('complete-snapshot'),
    partnerId: Id,
    sourceRevision: Id,
    evidenceRef: Id,
    profile: ProfilePresentation,
    clips: z.array(CatalogueClip).max(5000),
  })
  .superRefine((value, context) => {
    if (new Set(value.clips.map((clip) => clip.id)).size !== value.clips.length)
      context.addIssue({ code: 'custom', message: 'Duplicate content IDs' });
    if (new Set(value.clips.map((clip) => clip.brand)).size > 100)
      context.addIssue({ code: 'custom', message: 'At most 100 brands per catalogue' });
  });
export type CatalogueSnapshotValue = z.infer<typeof CatalogueSnapshot>;
export const PresentationResponse = z.strictObject({
  partnerId: Id,
  permissionRevision: Id,
  revision: Revision,
  publishedAt: Instant.nullable(),
  profile: ProfilePresentation.nullable(),
});
