import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Id } from '@/contracts/common';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash, priorCommand, recordCommand } from '@/server/modules/access/command-audit';
import { SourceSettlement, type SourceSettlementRepository } from './settlement-source';
const Command = z.strictObject({
  sourceRecordId: Id,
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: Id,
});
const Receipt = z.strictObject({ id: z.uuid() });
export const settlementDigest = (record: unknown) =>
  commandHash('source-settlement-v1', SourceSettlement.parse(record));
export function createSettlementImporter(
  access: ReturnType<typeof createPartnerAccess>,
  source: SourceSettlementRepository,
) {
  return async (headers: Headers, input: unknown) => {
    const command = Command.parse(input);
    await access.withStaffCapability(headers, 'record_payments', true, async () => {});
    const record = SourceSettlement.parse(await source.load(command.sourceRecordId));
    const digest = settlementDigest(record);
    if (digest !== command.expectedDigest) throw new AccessFailure('conflict');
    return access.withStaffCapability(headers, 'record_payments', true, async (tx, actor) => {
      const hash = commandHash('import-settlement', command);
      const prior = await priorCommand(tx, actor.userId, command.idempotencyKey, hash);
      if (prior) return { ...Receipt.parse(prior), replayed: true };
      await tx`select pg_advisory_xact_lock(hashtextextended(${record.partnerId},981709))`;
      const [partner] =
        await tx`select id from portal_access.partners where id=${record.partnerId} and status='active' for share`;
      if (!partner) throw new AccessFailure('forbidden');
      const [existing] =
        await tx`select id,partner_id,record_digest from portal_statements.settlements
        where authority=${record.source.authority} and account=${record.source.account} and reference=${record.source.reference}`;
      if (
        existing &&
        (existing.record_digest !== digest || existing.partner_id !== record.partnerId)
      )
        throw new AccessFailure('conflict');
      let id = existing?.id as string | undefined;
      if (!id) {
        const [clock] =
          await tx`select ${record.occurredAt}::timestamptz <= clock_timestamp() as valid`;
        if (!clock.valid) throw new AccessFailure('invalid_input');
        id = randomUUID();
        let originalId: string | null = null;
        let allocations: Array<{
          statementId: string;
          cashMinor: string;
          withholdingMinor: string;
          otherMinor: string;
          otherReasonRef: string | null;
        }>;
        if (record.kind === 'payment') allocations = record.allocations;
        else {
          const [original] =
            await tx`select id,occurred_at from portal_statements.settlements where partner_id=${record.partnerId}
            and authority=${record.original.authority} and account=${record.original.account} and reference=${record.original.reference} and kind='payment' for share`;
          if (!original || Date.parse(record.occurredAt) < new Date(original.occurred_at).getTime())
            throw new AccessFailure('invalid_input');
          originalId = original.id;
          if (
            (await tx`select id from portal_statements.settlements where original_id=${originalId}`)
              .length
          )
            throw new AccessFailure('conflict');
          allocations = (
            await tx`select statement_id,cash_minor::text,withholding_minor::text,other_minor::text,other_reason_ref
            from portal_statements.allocations where settlement_id=${originalId} and partner_id=${record.partnerId}`
          ).map((a) => ({
            statementId: a.statement_id,
            cashMinor: String(-BigInt(a.cash_minor)),
            withholdingMinor: String(-BigInt(a.withholding_minor)),
            otherMinor: String(-BigInt(a.other_minor)),
            otherReasonRef: a.other_reason_ref,
          }));
        }
        for (const allocation of allocations) {
          const [statement] =
            await tx`select opening_minor+new_earnings_minor+adjustments_minor as obligation
            from portal_statements.statements where id=${allocation.statementId} and partner_id=${record.partnerId} for share`;
          if (!statement) throw new AccessFailure('forbidden');
          const [balance] =
            await tx`select coalesce(sum(cash_minor+withholding_minor+other_minor),0)::text as settled
            from portal_statements.allocations where partner_id=${record.partnerId} and statement_id=${allocation.statementId}`;
          const amount =
            BigInt(allocation.cashMinor) +
            BigInt(allocation.withholdingMinor) +
            BigInt(allocation.otherMinor);
          if (
            record.kind === 'payment' &&
            amount > BigInt(statement.obligation) - BigInt(balance.settled)
          )
            throw new AccessFailure('conflict');
        }
        if (record.kind === 'payment') {
          // Negative correction periods remain credits; do not ignore them by summing only positive statements.
          const [balance] = await tx`select
            (select coalesce(sum(opening_minor+new_earnings_minor+adjustments_minor),0) from portal_statements.statements where partner_id=${record.partnerId})
            -(select coalesce(sum(cash_minor+withholding_minor+other_minor),0) from portal_statements.allocations where partner_id=${record.partnerId}) as outstanding`;
          const total =
            BigInt(record.cashMinor) + BigInt(record.withholdingMinor) + BigInt(record.otherMinor);
          if (total > BigInt(balance.outstanding)) throw new AccessFailure('conflict');
        }
        await tx`insert into portal_statements.settlements(id,partner_id,authority,account,reference,record_digest,kind,original_id,evidence_ref,reason_ref,occurred_at,recorded_by)
          values(${id},${record.partnerId},${record.source.authority},${record.source.account},${record.source.reference},${digest},${record.kind},${originalId},${record.evidenceRef},${record.kind === 'reversal' ? record.reasonRef : null},${record.occurredAt},${actor.userId})`;
        for (const a of allocations)
          await tx`insert into portal_statements.allocations(partner_id,settlement_id,statement_id,cash_minor,withholding_minor,other_minor,other_reason_ref)
          values(${record.partnerId},${id},${a.statementId},${a.cashMinor},${a.withholdingMinor},${a.otherMinor},${a.otherReasonRef})`;
        await tx`update portal_statements.revisions set settlements=settlements+1,updated_at=clock_timestamp() where partner_id=${record.partnerId}`;
      }
      const result = { id };
      await recordCommand(
        tx,
        actor.userId,
        record.partnerId,
        'import-settlement',
        id,
        command.idempotencyKey,
        hash,
        result,
      );
      return { ...result, replayed: Boolean(existing) };
    });
  };
}
