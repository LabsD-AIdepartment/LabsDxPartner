import type { Sql } from 'postgres';
import { z } from 'zod';
import { ApprovalContext } from '@/server/adapters/approved-period/schema';
import { AccessFailure } from '@/server/modules/partners/access';
import type { ApprovalRepository } from './run';

/** Database approval, not the acquired file, authorizes the offline worker. */
export function createApprovalRepository(sql: Sql) {
  async function review(id: string) {
    if (!z.uuid().safeParse(id).success) throw new AccessFailure('invalid_input');
    const [row] =
      await sql`select a.sequence::text,a.context,a.review_id,a.review_digest from portal_imports.approvals a
      where a.id=${id} and not exists(select 1 from portal_imports.approval_revocations r where r.approval_id=a.id)`;
    if (!row) throw new AccessFailure('forbidden');
    return {
      sequence: String(row.sequence),
      context: ApprovalContext.parse(row.context),
      reviewId: String(row.review_id),
      reviewDigest: String(row.review_digest),
    };
  }
  const repository: ApprovalRepository = {
    load: async (id) => {
      const record = await review(id);
      return { sequence: record.sequence, context: record.context };
    },
  };
  return { review, repository };
}
