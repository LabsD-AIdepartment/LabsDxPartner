import { createHash, randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { Id } from '@/contracts/common';
import { PermissionRevision } from '@/contracts/access';
import {
  ApprovalContext,
  entitlementKey,
  INTAKE_LIMITS,
} from '@/server/adapters/approved-period/schema';
import { parseApprovedPeriod } from '@/server/adapters/approved-period/parse';
import { resolveCorrections, persistCorrectionLinks } from '@/server/modules/earnings/corrections';

/** Must be constructed on the server from independently authorized records, never upload input. */
export interface ApprovalRepository {
  load(id: string): Promise<{ sequence: string; context: unknown }>;
}
export class ImportFailure extends Error {
  constructor(
    public readonly code:
      | 'busy'
      | 'conflict'
      | 'superseded'
      | 'closed_period'
      | 'overlapping_period'
      | 'inactive_partner'
      | 'input_too_large',
  ) {
    super(code);
  }
}
export type ImportResult = {
  runId: string;
  state: 'ready' | 'blocked' | 'failed' | 'superseded';
  replayed: boolean;
  issues: unknown[];
};
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const leaseSeconds = 300;

/** Offline worker only. Produces reconciled internal candidates, never issued statements. */
export function createImportRunner(sql: Sql, approvals: ApprovalRepository) {
  return async function run(
    raw: string,
    approvalId: string,
    idempotencyKey: string,
  ): Promise<ImportResult> {
    if (Buffer.byteLength(raw, 'utf8') > INTAKE_LIMITS.bytes)
      throw new ImportFailure('input_too_large');
    Id.parse(approvalId);
    Id.parse(idempotencyKey);
    const approved = await approvals.load(approvalId);
    const context = ApprovalContext.parse(approved.context);
    const sequence = PermissionRevision.parse(approved.sequence);
    const scopeId = hash(
      JSON.stringify([
        context.partnerId,
        Date.parse(context.period.from),
        Date.parse(context.period.toExclusive),
      ]),
    );
    const fileHash = hash(raw);
    const requestHash = hash(JSON.stringify([approvalId, sequence, context, fileHash]));
    const runId = randomUUID(),
      token = randomUUID();
    const claimed = await sql.begin(async (tx) => {
      await tx`set local lock_timeout='5s'`;
      await tx`set local statement_timeout='10s'`;
      // Serialize overlapping scope creation as well as claims for this partner.
      await tx`select pg_advisory_xact_lock(hashtextextended(${context.partnerId},981709))`;
      const [partner] =
        await tx`select status from portal_access.partners where id=${context.partnerId} for share`;
      if (!partner || partner.status !== 'active') throw new ImportFailure('inactive_partner');
      const overlaps =
        await tx`select id from portal_imports.scopes where partner_id=${context.partnerId}
        and period_from<${context.period.toExclusive}::timestamptz and period_to>${context.period.from}::timestamptz and id<>${scopeId}`;
      if (overlaps.length) throw new ImportFailure('overlapping_period');
      await tx`insert into portal_imports.scopes(id,partner_id,period_from,period_to)
        values(${scopeId},${context.partnerId},${context.period.from},${context.period.toExclusive}) on conflict(id) do nothing`;
      const [scope] =
        await tx`select *,lease_until>clock_timestamp() as busy from portal_imports.scopes where id=${scopeId} for update`;
      const [prior] =
        await tx`select id,state,issues,request_hash from portal_imports.runs where scope_id=${scopeId} and idempotency_key=${idempotencyKey}`;
      if (prior) {
        if (prior.request_hash !== requestHash) throw new ImportFailure('conflict');
        if (prior.state !== 'running')
          return {
            replay: {
              runId: String(prior.id),
              state: prior.state,
              issues: prior.issues,
              replayed: true,
            } as ImportResult,
          };
        if (scope.busy) throw new ImportFailure('busy');
        // A crashed run is terminal; retry uses a new command key and fencing token.
        await tx`update portal_imports.runs set state='superseded',finished_at=clock_timestamp() where id=${prior.id}`;
        return {
          replay: {
            runId: String(prior.id),
            state: 'superseded',
            issues: [],
            replayed: true,
          } as ImportResult,
        };
      }
      if (scope.closed_statement_ref) throw new ImportFailure('closed_period');
      if (BigInt(sequence) <= BigInt(scope.approval_sequence))
        throw new ImportFailure('superseded');
      if (scope.busy) throw new ImportFailure('busy');
      await tx`update portal_imports.runs set state='superseded',finished_at=clock_timestamp() where scope_id=${scopeId} and state='running'`;
      const [next] =
        await tx`update portal_imports.scopes set fence=fence+1,lease_token=${token},lease_until=clock_timestamp()+${leaseSeconds}*interval '1 second'
        where id=${scopeId} returning fence::text`;
      await tx`insert into portal_imports.runs(id,scope_id,idempotency_key,request_hash,approval_ref,approval_sequence,fence,state)
        values(${runId},${scopeId},${idempotencyKey},${requestHash},${context.approvalRef},${sequence},${next.fence},'running')`;
      return { fence: String(next.fence) };
    });
    if ('replay' in claimed) return claimed.replay!;
    // No upstream fetch/parse occurs while a database transaction is held.
    const parsed = parseApprovedPeriod(raw, context);
    let issues = parsed.ok ? parsed.blockers : parsed.issues;
    let state: ImportResult['state'] = !parsed.ok ? 'failed' : issues.length ? 'blocked' : 'ready';
    try {
      await sql.begin(async (tx) => {
        await tx`set local lock_timeout='5s'`;
        await tx`set local statement_timeout='15s'`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${context.partnerId},981709))`;
        const [scope] =
          await tx`select *,lease_until>clock_timestamp() as live from portal_imports.scopes where id=${scopeId} for update`;
        if (
          !scope ||
          scope.lease_token !== token ||
          String(scope.fence) !== claimed.fence ||
          !scope.live
        )
          throw new ImportFailure('superseded');
        if (scope.closed_statement_ref) throw new ImportFailure('closed_period');
        const [partner] =
          await tx`select status from portal_access.partners where id=${context.partnerId} for share`;
        if (!partner || partner.status !== 'active') throw new ImportFailure('inactive_partner');
        const links = parsed.ok
          ? await resolveCorrections(
              tx,
              context.partnerId,
              scopeId,
              context.period.from,
              parsed.data.rows.filter((row) => row.disposition === 'included'),
            )
          : [];
        if (parsed.ok) {
          issues = parsed.blockers.filter((issue) => {
            if (issue.code !== 'original_history_required') return true;
            const row = parsed.data.rows[issue.row];
            return (
              row.disposition !== 'included' ||
              row.earning.kind !== 'adjustment' ||
              !row.earning.correction
            );
          });
          state = issues.length ? 'blocked' : 'ready';
        }
        if (state === 'ready' && parsed.ok) {
          const controls = context.sources.map((source) => source.controls);
          const amount = controls.reduce((s, c) => s + BigInt(c.amountMinor), 0n).toString();
          const base = controls.reduce((s, c) => s + BigInt(c.eligibleBaseMinor), 0n).toString();
          const through = new Date(
            Math.min(...context.sources.map((s) => Date.parse(s.asOf))),
          ).toISOString();
          await tx`insert into portal_imports.generations(id,scope_id,approval_sequence,file_sha256,approval_context,included_count,excluded_count,eligible_base_minor,amount_minor,data_through)
            values(${runId},${scopeId},${sequence},${fileHash},${JSON.stringify(context)}::text::jsonb,${controls.reduce((s, c) => s + c.included, 0)},${controls.reduce((s, c) => s + c.excluded, 0)},${base},${amount},${through})`;
          for (let start = 0; start < parsed.data.rows.length; start += 500) {
            const rows = parsed.data.rows.slice(start, start + 500).map((row) => ({
              entitlement_key: entitlementKey(row.entitlement),
              source_revision: row.sourceRevision,
              earned_at: row.earnedAt,
              content_id:
                row.disposition === 'included' && row.attribution.kind === 'content'
                  ? row.attribution.contentId
                  : null,
              disposition: row.disposition,
              amount_minor: row.disposition === 'included' ? row.earning.amountMinor : null,
              eligible_base_minor:
                row.disposition === 'included' && row.earning.kind === 'commission'
                  ? row.earning.baseMinor
                  : null,
              payload: row,
            }));
            await tx`insert into portal_imports.earning_rows(generation_id,entitlement_key,source_revision,earned_at,content_id,disposition,amount_minor,eligible_base_minor,payload)
              select ${runId}::uuid,r.* from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb)
              as r(entitlement_key text,source_revision text,earned_at timestamptz,content_id text,disposition text,amount_minor numeric,eligible_base_minor numeric,payload jsonb)`;
          }
          await persistCorrectionLinks(tx, runId, links);
          const [duplicate] = await tx`select 1 from portal_imports.earning_rows incoming
            join portal_imports.earning_rows existing on existing.entitlement_key=incoming.entitlement_key
            join portal_imports.scopes other on other.current_generation=existing.generation_id
            where incoming.generation_id=${runId} and other.partner_id=${context.partnerId} and other.id<>${scopeId} limit 1`;
          if (duplicate) throw new ImportFailure('conflict');
          const advanced =
            await tx`update portal_imports.scopes set current_generation=${runId},approval_sequence=${sequence}
            where id=${scopeId} and lease_token=${token} and lease_until>clock_timestamp() returning id`;
          if (!advanced.length) throw new ImportFailure('superseded');
        }
        await tx`update portal_imports.runs set state=${state},issues=${JSON.stringify(issues)}::text::jsonb,finished_at=clock_timestamp() where id=${runId}`;
        await tx`update portal_imports.scopes set lease_token=null,lease_until=null where id=${scopeId}`;
      });
    } catch (error) {
      // Keep last good candidate intact; release only this run's lease, never a newer owner's.
      await sql.begin(async (tx) => {
        await tx`update portal_imports.runs set state='failed',issues='[{"code":"commit_failed"}]',finished_at=clock_timestamp() where id=${runId} and state='running'`;
        await tx`update portal_imports.scopes set lease_token=null,lease_until=null where id=${scopeId} and lease_token=${token}`;
      });
      throw error;
    }
    return { runId, state, issues, replayed: false };
  };
}
