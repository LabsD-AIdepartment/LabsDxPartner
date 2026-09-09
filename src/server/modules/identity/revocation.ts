import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';

export const subjectDigest = (provider: string, subject: string) =>
  createHash('sha256')
    .update(JSON.stringify([provider, subject]))
    .digest('hex');

/** Caller holds the A02 writer lock BEFORE actor/target row locks. */
export async function revokeIdentitySessions(
  tx: TransactionSql,
  userId: string,
  removedSubject?: { provider: string; subject: string },
) {
  const [clock] = await tx`update portal_identity.mutation_clock set revision = revision + 1
    where id = 'current' returning revision::text`;
  if (!clock) throw new Error('Identity mutation clock unavailable');
  await tx`insert into portal_identity.user_fences(user_id,revision) values (${userId},${clock.revision})
    on conflict(user_id) do update set revision = excluded.revision`;
  if (removedSubject) {
    const digest = subjectDigest(removedSubject.provider, removedSubject.subject);
    await tx`insert into portal_identity.subject_fences(subject_digest,revision) values (${digest},${clock.revision})
      on conflict(subject_digest) do update set revision = excluded.revision`;
  }
  return tx`delete from portal_identity.sessions where user_id = ${userId} returning id`;
}
