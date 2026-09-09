import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Id, Instant } from '@/contracts/common';
import { StatementListResponse, StatementDetailResponse } from '@/contracts/statements';
import { EarningsLine } from '@/contracts/earnings';
import { IntakeRow } from '@/server/adapters/approved-period/schema';
import { earningLineRef } from '@/server/modules/earnings/corrections';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
export class StatementDataUnavailable extends Error {}
const Query = z.strictObject({
  partnerId: Id,
  permissionRevision: Id,
  status: z.enum(['all', 'pending', 'part-paid', 'paid', 'credit']).default('all'),
  statementId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(1000).optional(),
  lineCursor: z.string().max(1000).optional(),
  settlementCursor: z.string().max(1000).optional(),
  version: z.uuid().optional(),
  revision: Id.optional(),
});
const Cursor = z.strictObject({ bound: z.string(), revision: Id, at: Instant, id: z.uuid() });
const bound = (partner: string, resource: string) =>
  createHash('sha256')
    .update(JSON.stringify([partner, resource]))
    .digest('hex');
function cursor(raw: string | undefined, binding: string) {
  if (!raw) return null;
  try {
    const c = Cursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (c.bound !== binding) throw new Error();
    return c;
  } catch {
    throw new AccessFailure('invalid_input');
  }
}
const token = (binding: string, revision: string, at: string, id: string) =>
  Buffer.from(JSON.stringify({ bound: binding, revision, at, id })).toString('base64url');
const money = (minor: string) => ({ currency: 'THB' as const, minor });
const iso = (value: string) => new Date(value).toISOString();
const dateSql = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const projected = `s.id,s.generation_id,s.period_from,s.period_to,s.published_at,s.scheduled_at,
  to_char(s.period_from at time zone 'UTC',${dateSql}) as cursor_at,
  s.opening_minor::text as opening,s.new_earnings_minor::text as earnings,s.adjustments_minor::text as adjustments,
  s.settled::text as settled,(s.opening_minor+s.new_earnings_minor+s.adjustments_minor-s.settled)::text as closing`;
function statement(s: Record<string, string>, asOf: string) {
  const closing = BigInt(s.closing),
    settled = BigInt(s.settled);
  return {
    id: s.id,
    version: s.generation_id,
    period: { from: iso(s.period_from), toExclusive: iso(s.period_to), timezone: 'Asia/Bangkok' },
    publishedAt: iso(s.published_at),
    scheduledAt: iso(s.scheduled_at),
    settlementAsOf: asOf,
    status:
      closing < 0n ? 'credit' : closing === 0n ? 'paid' : settled > 0n ? 'part-paid' : 'pending',
    opening: money(s.opening),
    newEarnings: money(s.earnings),
    adjustments: money(s.adjustments),
    settled: money(s.settled),
    closing: money(s.closing),
  };
}
export function createStatementReader(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const parsed = Query.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const q = parsed.data;
    if (
      q.statementId
        ? q.cursor !== undefined || q.status !== 'all'
        : q.lineCursor !== undefined || q.settlementCursor !== undefined || q.version !== undefined
    )
      throw new AccessFailure('invalid_input');
    return access.withPartner(headers, q.partnerId, 'view_statements', async (tx, scope) => {
      if (scope.permissionRevision !== q.permissionRevision) throw new AccessFailure('conflict');
      const listBinding = bound(q.partnerId, 'list:' + q.status),
        lineBinding = bound(q.partnerId, 'lines:' + q.statementId),
        payBinding = bound(q.partnerId, 'payments:' + q.statementId);
      const c = cursor(q.cursor, listBinding),
        l = cursor(q.lineCursor, lineBinding),
        p = cursor(q.settlementCursor, payBinding);
      let h;
      if (!q.statementId) {
        [h] = await tx.unsafe(
          `with balances as (
          select s.*,coalesce((select sum(a.cash_minor+a.withholding_minor+a.other_minor) from portal_statements.allocations a
            where a.partner_id=$1 and a.statement_id=s.id),0) as settled
          from portal_statements.statements s where s.partner_id=$1
        ), filtered as (select * from balances s where $2='all' or
          case when opening_minor+new_earnings_minor+adjustments_minor-settled<0 then 'credit'
            when opening_minor+new_earnings_minor+adjustments_minor-settled=0 then 'paid'
            when settled>0 then 'part-paid' else 'pending' end=$2),
        picked as (select ${projected} from filtered s where $3::timestamptz is null or (s.period_from,s.id)<($3::timestamptz,$4::uuid)
          order by s.period_from desc,s.id desc limit $5)
        select statement_timestamp() as as_of,r.statements::text||':'||r.settlements::text as revision,
          (select max(g.data_through) from portal_statements.statements s join portal_imports.generations g on g.id=s.generation_id where s.partner_id=$1) as through,
          (select coalesce(sum(opening_minor+new_earnings_minor+adjustments_minor-settled),0)::text from balances) as outstanding,
          (select count(*)::int from filtered) as total,
          coalesce((select jsonb_agg(to_jsonb(picked) order by period_from desc,id desc) from picked),'[]') as rows
        from portal_statements.revisions r where r.partner_id=$1`,
          [q.partnerId, q.status, c?.at ?? null, c?.id ?? null, q.limit + 1],
        );
      } else {
        [h] = await tx.unsafe(
          `with balances as (
          select s.*,coalesce((select sum(a.cash_minor+a.withholding_minor+a.other_minor) from portal_statements.allocations a where a.partner_id=$1 and a.statement_id=s.id),0) as settled
          from portal_statements.statements s where s.partner_id=$1 and s.id=$2
        ), head as (select ${projected} from balances s),
        lines as (select e.row_id as id,to_char(e.earned_at at time zone 'UTC',${dateSql}) as cursor_at,e.payload
          from portal_imports.earning_rows e join head h on h.generation_id=e.generation_id
          where e.disposition='included' and ($3::timestamptz is null or (e.earned_at,e.row_id)>($3::timestamptz,$4::uuid))
          order by e.earned_at,e.row_id limit $7),
        payments as (select s.id,s.reference,s.kind,s.original_id,s.reason_ref,s.evidence_ref,s.recorded_at,s.occurred_at,
          to_char(s.recorded_at at time zone 'UTC',${dateSql}) as cursor_at,a.cash_minor::text as cash,a.withholding_minor::text as withholding,a.other_minor::text as other,a.other_reason_ref
          from portal_statements.settlements s join portal_statements.allocations a on a.settlement_id=s.id and a.partner_id=s.partner_id
          where s.partner_id=$1 and a.statement_id=$2 and ($5::timestamptz is null or (s.recorded_at,s.id)<($5::timestamptz,$6::uuid))
          order by s.recorded_at desc,s.id desc limit $7)
        select to_jsonb(head) as statement,statement_timestamp() as as_of,r.statements::text||':'||r.settlements::text as revision,g.data_through as through,
          g.included_count as line_count,(select count(*)::int from portal_statements.allocations where partner_id=$1 and statement_id=$2) as payment_count,
          coalesce((select jsonb_agg(to_jsonb(lines) order by cursor_at,id) from lines),'[]') as lines,
          coalesce((select jsonb_agg(to_jsonb(payments) order by recorded_at desc,id desc) from payments),'[]') as payments
        from head join portal_statements.revisions r on r.partner_id=$1 join portal_imports.generations g on g.id=head.generation_id`,
          [
            q.partnerId,
            q.statementId,
            l?.at ?? null,
            l?.id ?? null,
            p?.at ?? null,
            p?.id ?? null,
            q.limit + 1,
          ],
        );
      }
      if (!h) {
        if (q.statementId) throw new AccessFailure('forbidden');
        throw new StatementDataUnavailable();
      }
      if ([q.revision, c?.revision, l?.revision, p?.revision].some((v) => v && v !== h.revision))
        throw new AccessFailure('conflict');
      const asOf = new Date(h.as_of).toISOString();
      const common = {
        dataState: 'ready',
        generatedAt: asOf,
        dataThrough: h.through ? new Date(h.through).toISOString() : null,
        reasons: [],
        requestId: randomUUID(),
        settlementsRevision: h.revision,
      };
      if (!q.statementId) {
        const rows = h.rows.slice(0, q.limit),
          last = rows.at(-1);
        return StatementListResponse.parse({
          ...common,
          asOf,
          confirmedUnpaid: money(String(BigInt(h.outstanding) > 0n ? BigInt(h.outstanding) : 0n)),
          data: {
            items: rows.map((r: Record<string, string>) => statement(r, asOf)),
            totalCount: h.total,
            nextCursor:
              h.rows.length > q.limit
                ? token(listBinding, h.revision, last.cursor_at, last.id)
                : null,
          },
        });
      }
      if (q.version && q.version !== h.statement.generation_id) throw new AccessFailure('conflict');
      const lines = h.lines.slice(0, q.limit),
        payments = h.payments.slice(0, q.limit);
      return StatementDetailResponse.parse({
        ...common,
        data: {
          statement: statement(h.statement, asOf),
          lines: {
            items: lines.map((entry: { payload: unknown }) => {
              const row = IntakeRow.parse(entry.payload);
              if (row.disposition !== 'included') throw new Error('Invalid issued line');
              const e = row.earning;
              return EarningsLine.parse({
                id: earningLineRef(h.statement.generation_id, row.entitlement),
                sourceRef: earningLineRef(h.statement.generation_id, row.entitlement),
                sourceRevision: row.sourceRevision,
                agreementVersion: row.agreementVersion,
                earnedAt: row.earnedAt,
                contentId: row.attribution.kind === 'content' ? row.attribution.contentId : null,
                kind: e.kind,
                eligibleBase: e.kind === 'commission' ? money(e.baseMinor) : null,
                ratePpm: e.kind === 'commission' ? e.ratePpm : null,
                amount: money(e.amountMinor),
                status: e.kind === 'adjustment' ? 'adjustment' : 'confirmed',
                reason: e.kind === 'adjustment' ? e.reasonRef : null,
                evidenceRef: row.evidenceRef,
                originalLineId: e.kind === 'adjustment' ? e.originalLineRef : null,
                attribution: row.attribution.kind,
              });
            }),
            totalCount: h.line_count,
            nextCursor:
              h.lines.length > q.limit
                ? token(lineBinding, h.revision, lines.at(-1).cursor_at, lines.at(-1).id)
                : null,
          },
          settlements: {
            items: payments.map((r: Record<string, string>) => ({
              id: r.id,
              reference: r.reference,
              kind: r.kind,
              originalSettlementId: r.original_id,
              reasonRef: r.reason_ref,
              otherReasonRef: r.other_reason_ref,
              recordedAt: iso(r.recorded_at),
              paidAt: iso(r.occurred_at),
              cash: money(r.cash),
              withholding: money(r.withholding),
              other: money(r.other),
              obligationSettled: money(
                String(BigInt(r.cash) + BigInt(r.withholding) + BigInt(r.other)),
              ),
              evidenceRef: r.evidence_ref,
            })),
            totalCount: h.payment_count,
            nextCursor:
              h.payments.length > q.limit
                ? token(payBinding, h.revision, payments.at(-1).cursor_at, payments.at(-1).id)
                : null,
          },
          documents: [
            {
              id: 'csv:' + q.statementId,
              statementId: q.statementId,
              name: 'ใบสรุปรายได้ CSV',
              kind: 'statement',
            },
          ],
        },
      });
    });
  };
}
