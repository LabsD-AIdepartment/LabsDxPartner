import { randomUUID } from 'node:crypto';
import { advanceRevisions } from '@/server/platform/db/revisions';
import { z } from 'zod';
import { Id, Instant } from '@/contracts/common';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash, priorCommand, recordCommand } from '@/server/modules/access/command-audit';
import { assertCorrectionHistoryCurrent } from '@/server/modules/earnings/corrections';
const Publish = z.strictObject({
  partnerId: Id,
  generationId: z.uuid(),
  approvalId: z.uuid(),
  scheduledAt: Instant,
  idempotencyKey: Id,
});
const PublishedReceipt = z.strictObject({ id: z.uuid(), version: z.uuid() });
export function createStatementPublisher(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const command = Publish.parse(input);
    return access.withStaffCapability(headers, 'publish_statements', true, async (tx, actor) => {
      const requestHash = commandHash('publish-statement', command);
      const prior = await priorCommand(tx, actor.userId, command.idempotencyKey, requestHash);
      if (prior) return { ...PublishedReceipt.parse(prior), replayed: true };
      await tx`select pg_advisory_xact_lock(hashtextextended(${command.partnerId},981709))`;
      const [partner] =
        await tx`select id from portal_access.partners where id=${command.partnerId} and status='active' for share`;
      if (!partner) throw new AccessFailure('forbidden');
      const [candidate] =
        await tx`select s.id as scope_id,s.period_from,s.period_to,s.closed_statement_ref,g.*
    from portal_imports.scopes s join portal_imports.generations g on g.id=s.current_generation
    join portal_imports.runs r on r.id=g.id and r.state='ready'
    join portal_imports.approvals a on a.id=${command.approvalId} and a.partner_id=s.partner_id
      and a.sequence=g.approval_sequence and a.context=g.approval_context and a.context->>'fileSha256'=g.file_sha256
    where s.partner_id=${command.partnerId} and g.id=${command.generationId}
      and not exists(select 1 from portal_imports.approval_revocations ar where ar.approval_id=a.id)
    for update of s`;
      if (!candidate || candidate.closed_statement_ref) throw new AccessFailure('conflict');
      if (Date.parse(command.scheduledAt) < new Date(candidate.period_to).getTime())
        throw new AccessFailure('invalid_input');
      await assertCorrectionHistoryCurrent(tx, command.partnerId, command.generationId);
      const [amounts] = await tx`select
        coalesce(sum(amount_minor) filter(where payload->'earning'->>'kind'='adjustment'),0)::text as adjustments,
        coalesce(sum(amount_minor) filter(where payload->'earning'->>'kind'<>'adjustment'),0)::text as earnings
        from portal_imports.earning_rows where generation_id=${command.generationId} and disposition='included'`;
      if (BigInt(amounts.earnings) + BigInt(amounts.adjustments) !== BigInt(candidate.amount_minor))
        throw new AccessFailure('conflict');
      // Rows and source approval are immutable. The issued statement pins that exact generation.
      const id = randomUUID();
      await tx`insert into portal_statements.statements(id,partner_id,scope_id,generation_id,approval_id,period_from,period_to,new_earnings_minor,adjustments_minor,excluded_count,scheduled_at,published_by)
    values(${id},${command.partnerId},${candidate.scope_id},${command.generationId},${command.approvalId},${candidate.period_from},${candidate.period_to},${amounts.earnings},${amounts.adjustments},${candidate.excluded_count},${command.scheduledAt},${actor.userId})`;
      await tx`update portal_imports.scopes set closed_statement_ref=${id} where id=${candidate.scope_id}`;
      await tx`insert into portal_statements.revisions(partner_id,statements) values(${command.partnerId},1)
    on conflict(partner_id) do update set statements=portal_statements.revisions.statements+1,updated_at=clock_timestamp()`;
      const result = { id, version: command.generationId };
      await advanceRevisions(tx, command.partnerId, ['earnings', 'settlements']);
      await recordCommand(
        tx,
        actor.userId,
        command.partnerId,
        'publish-statement',
        id,
        command.idempotencyKey,
        requestHash,
        result,
      );
      return { ...result, replayed: false };
    });
  };
}
