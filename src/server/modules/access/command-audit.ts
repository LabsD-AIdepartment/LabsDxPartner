import { createHash, randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { AccessFailure } from '../partners/access';
export const commandHash = (action: string, input: unknown) =>
  createHash('sha256')
    .update(JSON.stringify([action, input]))
    .digest('hex');
export async function priorCommand(
  tx: TransactionSql,
  actorId: string,
  key: string,
  hash: string,
): Promise<unknown> {
  const [row] =
    await tx`select request_hash,result from portal_access.audit where actor_id=${actorId} and idempotency_key=${key}`;
  if (row && row.request_hash !== hash) throw new AccessFailure('conflict');
  return row?.result;
}
export async function recordCommand(
  tx: TransactionSql,
  actorId: string,
  partnerId: string,
  action: string,
  targetId: string,
  key: string,
  hash: string,
  result: unknown,
  details: Record<string, unknown> = {},
) {
  await tx`insert into portal_access.audit(id,actor_id,action,partner_id,target_id,idempotency_key,request_hash,result,details)
 values(${randomUUID()},${actorId},${action},${partnerId},${targetId},${key},${hash},${JSON.stringify(result)}::text::jsonb,${JSON.stringify(details)}::text::jsonb)`;
}
