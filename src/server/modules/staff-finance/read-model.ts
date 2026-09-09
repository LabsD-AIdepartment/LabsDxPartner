import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IntakeRow } from '@/server/adapters/approved-period/schema';
import { FinanceQuery, FinanceSnapshot } from '@/contracts/staff-finance';
import { Id, Instant } from '@/contracts/common';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
const Cursor = z.strictObject({ binding: Id, at: Instant, id: Id });
const money = (minor: unknown) =>
  minor === null || minor === undefined ? null : { currency: 'THB', minor: String(minor) };
export function createFinanceReader(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const parsed = FinanceQuery.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const q = parsed.data;
    return access.withStaffCapability(headers, 'publish_statements', false, async (tx, actor) => {
      if (actor.revision !== q.expectedRevision) throw new AccessFailure('forbidden');
      const binding = createHash('sha256')
        .update(JSON.stringify([actor.userId, actor.revision, q.partnerId ?? null, q.q]))
        .digest('hex');
      let cursor: z.infer<typeof Cursor> | null = null;
      if (q.cursor) {
        try {
          cursor = Cursor.parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')));
        } catch {
          throw new AccessFailure('invalid_input');
        }
        if (cursor.binding !== binding) throw new AccessFailure('conflict');
      }
      let line: z.infer<typeof Cursor> | null = null;
      const lineBinding = createHash('sha256')
        .update(JSON.stringify([binding, q.scopeId, q.generationId]))
        .digest('hex');
      if (q.lineCursor) {
        try {
          line = Cursor.parse(JSON.parse(Buffer.from(q.lineCursor, 'base64url').toString('utf8')));
        } catch {
          throw new AccessFailure('invalid_input');
        }
        if (line.binding !== lineBinding) throw new AccessFailure('conflict');
      }
      const [result] = await tx`with selected as (
        select s.*,p.name,p.status as partner_status
        from portal_imports.scopes s join portal_access.partners p on p.id=s.partner_id
        where (${q.partnerId ?? null}::text is null or s.partner_id=${q.partnerId ?? null})
          and position(lower(${q.q}) in lower(p.name))>0
          and (${q.scopeId ?? null}::text is null or s.id=${q.scopeId ?? null})
          and (${cursor?.at ?? null}::timestamptz is null or (s.period_from,s.id)<(${cursor?.at ?? null}::timestamptz,${cursor?.id ?? null}::text))
        order by s.period_from desc,s.id desc limit 21
      ), projected as (
        select s.id,s.partner_id,s.name,s.partner_status,s.period_from,s.period_to,
          to_char(s.period_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
          g.id as generation_id,a.id as approval_id,a.review_id,
          g.amount_minor::text as amount,g.eligible_base_minor::text as base,g.included_count,g.excluded_count,g.data_through,
          issued.id as statement_id,issued.scheduled_at,
          case when issued.id is not null then 'published'
            when s.partner_status='active' and r.state='ready' and a.id is not null and ar.approval_id is null and s.closed_statement_ref is null then 'ready'
            when g.id is null then 'waiting' else 'blocked' end as state,
          ar.approval_id is not null as approval_revoked,
          case when issued.id is null then null else balance.settled::text end as settled,
          case when issued.id is null then null else (issued.opening_minor+issued.new_earnings_minor+issued.adjustments_minor-balance.settled)::text end as closing
        from selected s left join portal_statements.statements issued on issued.scope_id=s.id and issued.partner_id=s.partner_id
        left join portal_imports.generations g on g.scope_id=s.id and g.id=coalesce(issued.generation_id,s.current_generation)
        left join portal_imports.runs r on r.id=g.id
        left join portal_imports.approvals a on a.partner_id=s.partner_id and a.sequence=g.approval_sequence and a.context=g.approval_context
        left join portal_imports.approval_revocations ar on ar.approval_id=a.id
        left join lateral (select coalesce(sum(cash_minor+withholding_minor+other_minor),0) as settled from portal_statements.allocations where partner_id=s.partner_id and statement_id=issued.id) balance on true
      ), lines as (
        select e.row_id as id,e.payload,to_char(e.earned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
        from projected p join portal_imports.earning_rows e on e.generation_id=p.generation_id
        where ${q.scopeId ?? null}::text is not null and (${line?.at ?? null}::timestamptz is null or (e.earned_at,e.row_id)>(${line?.at ?? null}::timestamptz,${line?.id ?? null}::uuid))
        order by e.earned_at,e.row_id limit 21
      ) select statement_timestamp() as as_of,coalesce((select jsonb_agg(to_jsonb(lines) order by cursor_at,id) from lines),'[]'::jsonb) as lines,coalesce((select jsonb_agg(to_jsonb(projected) order by period_from desc,id desc) from projected),'[]'::jsonb) as rows`;
      if (q.scopeId && !result.rows.length) throw new AccessFailure('forbidden');
      if (q.generationId && result.rows[0]?.generation_id !== q.generationId)
        throw new AccessFailure('conflict');
      const rows = result.rows.slice(0, 20);
      const lines = result.lines.slice(0, 20).map((r: { id: string; payload: unknown }) => {
        const e = IntakeRow.parse(r.payload);
        if (e.disposition === 'unresolved')
          throw new Error('Unresolved row in immutable generation');
        const earning = e.disposition === 'included' ? e.earning : null;
        return {
          id: r.id,
          reference: e.entitlement.reference,
          sourceId: e.sourceId,
          evidenceRef: e.evidenceRef,
          earnedAt: e.earnedAt,
          kind: earning?.kind ?? 'excluded',
          amount: money(earning?.amountMinor),
          base: money(earning?.kind === 'commission' ? earning.baseMinor : null),
          ratePpm: earning?.kind === 'commission' ? earning.ratePpm : null,
          agreementVersion: e.disposition === 'included' ? e.agreementVersion : null,
          contentId:
            e.disposition === 'included' && e.attribution.kind === 'content'
              ? e.attribution.contentId
              : null,
          reasonRef:
            e.disposition === 'excluded'
              ? e.reasonRef
              : earning?.kind === 'adjustment'
                ? earning.reasonRef
                : null,
        };
      });
      const nextLineBinding = createHash('sha256')
        .update(JSON.stringify([binding, q.scopeId, rows[0]?.generation_id]))
        .digest('hex');
      const items = rows.map((r: Record<string, any>) => ({
        id: r.id,
        partnerId: r.partner_id,
        partnerName: r.name,
        partnerActive: r.partner_status === 'active',
        period: { from: r.period_from, toExclusive: r.period_to, timezone: 'Asia/Bangkok' },
        generationId: r.generation_id,
        approvalId: r.approval_id,
        reviewId: r.review_id,
        state: r.state,
        amount: money(r.amount),
        eligibleBase: money(r.base),
        includedCount: r.included_count,
        excludedCount: r.excluded_count,
        issues: [
          ...(r.approval_revoked ? ['การอนุมัติข้อมูลต้นทางถูกยกเลิก'] : []),
          ...(r.partner_status !== 'active' ? ['พาร์ทเนอร์ถูกระงับใช้งาน'] : []),
          ...(r.state === 'waiting' ? ['ยังไม่มีข้อมูลที่กระทบยอดพร้อมเผยแพร่'] : []),
          ...(r.state === 'blocked' && !r.approval_revoked && r.partner_status === 'active'
            ? ['ยังไม่มีการอนุมัติที่ใช้ได้สำหรับข้อมูลชุดนี้']
            : []),
        ],
        dataThrough: r.data_through,
        statementId: r.statement_id,
        scheduledAt: r.scheduled_at,
        settled: money(r.settled),
        closing: money(r.closing),
      }));
      return FinanceSnapshot.parse({
        session: actor,
        q: q.q,
        partnerId: q.partnerId ?? null,
        scopeId: q.scopeId ?? null,
        lines: q.scopeId
          ? {
              items: lines,
              totalCount: rows[0]?.generation_id
                ? rows[0].included_count + rows[0].excluded_count
                : null,
              nextCursor:
                result.lines.length > 20
                  ? Buffer.from(
                      JSON.stringify({
                        binding: nextLineBinding,
                        at: result.lines[19].cursor_at,
                        id: result.lines[19].id,
                      }),
                    ).toString('base64url')
                  : null,
            }
          : null,
        asOf: new Date(result.as_of).toISOString(),
        periods: {
          items,
          totalCount: null,
          nextCursor:
            result.rows.length > 20
              ? Buffer.from(
                  JSON.stringify({ binding, at: rows.at(-1).cursor_at, id: rows.at(-1).id }),
                ).toString('base64url')
              : null,
        },
      });
    });
  };
}
