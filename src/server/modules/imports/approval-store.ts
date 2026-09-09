import { createHash, randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { Id } from '@/contracts/common';
import { EvidenceRef } from '@/contracts/access';
import { ApprovalContext, INTAKE_LIMITS } from '@/server/adapters/approved-period/schema';
import { parseApprovedPeriod } from '@/server/adapters/approved-period/parse';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash, priorCommand, recordCommand } from '../access/command-audit';
import { createApprovalRepository } from './approval-repository';
export interface SourceReviewRepository {
  load(id: string): Promise<{ raw: string; context: unknown }>;
}
export const reviewDigest = (raw: string, context: unknown) => {
  if (Buffer.byteLength(raw, 'utf8') > INTAKE_LIMITS.bytes)
    throw new AccessFailure('invalid_input');
  return createHash('sha256')
    .update(
      JSON.stringify([
        createHash('sha256').update(raw).digest('hex'),
        ApprovalContext.parse(context),
      ]),
    )
    .digest('hex');
};
const Approve = z.strictObject({
  reviewId: Id,
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: Id,
});
const Revoke = z.strictObject({ approvalId: z.uuid(), reasonRef: EvidenceRef, idempotencyKey: Id });
const ApprovalReceipt = z.strictObject({
  id: z.uuid(),
  sequence: z.string().regex(/^[1-9][0-9]*$/),
});
export function createApprovalStore(
  sql: Sql,
  access: ReturnType<typeof createPartnerAccess>,
  reviews: SourceReviewRepository,
) {
  const { repository } = createApprovalRepository(sql);
  return {
    repository,
    async approve(headers: Headers, input: unknown) {
      const command = Approve.parse(input);
      // Authorize before loading source evidence; repeat authorization in the commit transaction.
      await access.withStaffCapability(headers, 'review_imports', true, async () => {});
      const source = await reviews.load(command.reviewId);
      const context = ApprovalContext.parse(source.context);
      if (reviewDigest(source.raw, context) !== command.expectedDigest)
        throw new AccessFailure('conflict');
      if (!parseApprovedPeriod(source.raw, context).ok) throw new AccessFailure('invalid_input');
      return access.withStaffCapability(headers, 'review_imports', true, async (tx, actor) => {
        const requestHash = commandHash('approve-period', command);
        const prior = await priorCommand(tx, actor.userId, command.idempotencyKey, requestHash);
        if (prior) return { ...ApprovalReceipt.parse(prior), replayed: true };
        const [partner] =
          await tx`select id from portal_access.partners where id=${context.partnerId} and status='active' for share`;
        if (!partner) throw new AccessFailure('forbidden');
        const [row] =
          await tx`insert into portal_imports.approvals(id,partner_id,review_id,review_digest,context,approved_by)
        values(${randomUUID()},${context.partnerId},${command.reviewId},${command.expectedDigest},${JSON.stringify(context)}::text::jsonb,${actor.userId})
        on conflict(partner_id,review_id,review_digest) do nothing returning id,sequence::text`;
        const existing =
          row ??
          (
            await tx`select id,sequence::text from portal_imports.approvals where partner_id=${context.partnerId} and review_id=${command.reviewId} and review_digest=${command.expectedDigest}`
          )[0];
        const result = { id: String(existing.id), sequence: String(existing.sequence) };
        const [revoked] =
          await tx`select approval_id from portal_imports.approval_revocations where approval_id=${result.id}`;
        if (revoked) throw new AccessFailure('conflict');
        await recordCommand(
          tx,
          actor.userId,
          context.partnerId,
          'approve-period',
          result.id,
          command.idempotencyKey,
          requestHash,
          result,
        );
        return { ...result, replayed: !row };
      });
    },
    async revoke(headers: Headers, input: unknown) {
      const command = Revoke.parse(input);
      return access.withStaffCapability(headers, 'review_imports', true, async (tx, actor) => {
        const requestHash = commandHash('revoke-period-approval', command);
        const prior = await priorCommand(tx, actor.userId, command.idempotencyKey, requestHash);
        if (prior) return { ...z.strictObject({ id: z.uuid() }).parse(prior), replayed: true };
        const [approval] =
          await tx`select partner_id from portal_imports.approvals where id=${command.approvalId} for share`;
        if (!approval) throw new AccessFailure('forbidden');
        await tx`insert into portal_imports.approval_revocations(approval_id,reason_ref,revoked_by) values(${command.approvalId},${command.reasonRef},${actor.userId}) on conflict(approval_id) do nothing`;
        const result = { id: command.approvalId };
        await recordCommand(
          tx,
          actor.userId,
          approval.partner_id,
          'revoke-period-approval',
          result.id,
          command.idempotencyKey,
          requestHash,
          result,
        );
        return { ...result, replayed: false };
      });
    },
  };
}
