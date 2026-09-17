import { z } from 'zod';
import { Account } from './account';
import { Id } from './common';
import { Revision } from './changes';
import { ReviewReference } from './review-reference';
export const AccountProfile = z
  .strictObject({
    partnerId: Id,
    sourceRevision: Id,
    evidenceRef: Id,
    agreement: Account.shape.agreement,
    termsSummary: z.string().trim().min(1).max(4000).nullable(),
    supportUrl: Account.shape.supportUrl,
  })
  .superRefine((v, ctx) => {
    if (v.agreement && v.agreement.partnerId !== v.partnerId)
      ctx.addIssue({ code: 'custom', message: 'Agreement belongs to another partner' });
    if (!v.agreement && v.termsSummary !== null)
      ctx.addIssue({ code: 'custom', message: 'Terms summary requires an agreement' });
  });
export const ProfileReviewQuery = z.strictObject({
  partnerId: Id,
  reviewId: ReviewReference,
});
export const ProfilePublishCommand = ProfileReviewQuery.extend({
  expectedRevision: Revision,
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: Id,
});
export const ProfilePublishReceipt = z.strictObject({ partnerId: Id, revision: Revision });
export const ProfileReview = z.strictObject({
  partnerId: Id,
  reviewId: ProfileReviewQuery.shape.reviewId,
  expectedRevision: Revision,
  expectedDigest: ProfilePublishCommand.shape.expectedDigest,
  profile: AccountProfile,
});
