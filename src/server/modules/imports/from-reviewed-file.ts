import { z } from 'zod';
import type { Sql } from 'postgres';
import { Id } from '@/contracts/common';
import { AccessFailure } from '@/server/modules/partners/access';
import { createApprovalRepository } from './approval-repository';
import { reviewDigest, type SourceReviewRepository } from './approval-store';
import { createImportRunner } from './run';
export const ReviewedImportCommand = z.strictObject({ approvalId: z.uuid(), idempotencyKey: Id });
/** Offline only; input identifiers resolve to an authenticated immutable source review. */
export function createReviewedFileImporter(sql: Sql, source: SourceReviewRepository) {
  const approvals = createApprovalRepository(sql),
    run = createImportRunner(sql, approvals.repository);
  return async (input: unknown) => {
    const parsed = ReviewedImportCommand.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const command = parsed.data,
      approved = await approvals.review(command.approvalId);
    const acquired = await source.load(approved.reviewId);
    if (reviewDigest(acquired.raw, acquired.context) !== approved.reviewDigest)
      throw new AccessFailure('conflict');
    // Runner loads the stored approval again after file I/O, including current revocation state.
    const result = await run(acquired.raw, command.approvalId, command.idempotencyKey);
    return {
      ...result,
      partnerId: approved.context.partnerId,
      approvalId: command.approvalId,
      sourceMode: 'reviewed-file' as const,
    };
  };
}
