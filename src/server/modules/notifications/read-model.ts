import { createHash } from 'node:crypto';
import { z } from 'zod';
import { advanceRevisions } from '@/server/platform/db/revisions';
import {
  NoticeQuery,
  NoticePosition,
  NotificationResponse,
  SeenCommand,
  SeenResponse,
} from '@/contracts/notifications-http';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
const Cursor = z.strictObject({ binding: z.string(), position: NoticePosition });
const fingerprint = (parts: string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const value = schema.safeParse(input);
  if (!value.success) throw new AccessFailure('invalid_input');
  return value.data;
};
export function createNotifications(access: ReturnType<typeof createPartnerAccess>) {
  return {
    async read(headers: Headers, input: unknown) {
      const q = parse(NoticeQuery, input);
      return access.withPartner(headers, q.partnerId, 'view_statements', async (tx, scope) => {
        if (q.permissionRevision !== scope.permissionRevision) throw new AccessFailure('forbidden');
        const binding = fingerprint([scope.userId, scope.partnerId, scope.permissionRevision]);
        let before: string | null = null;
        if (q.cursor) {
          let value: unknown;
          try {
            value = JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8'));
          } catch {
            throw new AccessFailure('invalid_input');
          }
          const cursor = parse(Cursor, value);
          if (cursor.binding !== binding) throw new AccessFailure('conflict');
          before = cursor.position;
        }
        // One SQL snapshot: page, count and marker agree even while another tab marks seen.
        const [row] = await tx`with marker as (
          select coalesce((select through_position from portal_access.notice_seen
            where partner_id=${scope.partnerId} and user_id=${scope.userId}),0) as through_position
        ), page as (
          select n.position,n.statement_id,n.settlement_id,s.published_at,p.recorded_at,p.kind,
            n.position <= m.through_position as seen
          from portal_statements.notice_sources n
          join portal_statements.statements s on s.partner_id=n.partner_id and s.id=n.statement_id
          left join portal_statements.settlements p on p.partner_id=n.partner_id and p.id=n.settlement_id
          cross join marker m
          where n.partner_id=${scope.partnerId} and (${before}::bigint is null or n.position<${before}::bigint)
          order by n.position desc limit ${q.limit + 1}
        ) select
          (select count(*)::text from portal_statements.notice_sources where partner_id=${scope.partnerId}) as total,
          (select count(*)::text from portal_statements.notice_sources n cross join marker m
            where n.partner_id=${scope.partnerId} and n.position>m.through_position) as unseen,
          coalesce((select jsonb_agg(jsonb_build_object('position',position::text,'statementId',statement_id,
            'kind',case when settlement_id is null then 'statement-published' when kind='reversal' then 'payment-reversed' else 'payment-recorded' end,
            'createdAt',coalesce(recorded_at,published_at),'seen',seen) order by position desc) from page),'[]'::jsonb) as items`;
        const items = row.items
          .slice(0, q.limit)
          .map(
            (item: {
              position: string;
              statementId: string;
              kind: 'statement-published' | 'payment-recorded' | 'payment-reversed';
              createdAt: string;
              seen: boolean;
            }) => ({
              id: item.position,
              statementId: item.statementId,
              kind: item.kind,
              createdAt: item.createdAt,
              seen: item.seen,
              title:
                item.kind === 'statement-published'
                  ? 'มีใบสรุปรายได้รอบใหม่'
                  : item.kind === 'payment-reversed'
                    ? 'มีการยกเลิกรายการจ่าย ตรวจสอบใบสรุป'
                    : 'มีการบันทึกการจ่ายในใบสรุป',
            }),
          );
        return NotificationResponse.parse({
          partnerId: scope.partnerId,
          userId: scope.userId,
          permissionRevision: scope.permissionRevision,
          data: {
            items,
            totalCount: Number(row.total),
            unseenCount: Number(row.unseen),
            nextCursor:
              row.items.length > q.limit
                ? Buffer.from(JSON.stringify({ binding, position: items.at(-1)!.id })).toString(
                    'base64url',
                  )
                : null,
          },
        });
      });
    },
    async seen(headers: Headers, input: unknown) {
      const q = parse(SeenCommand, input);
      return access.withPartner(headers, q.partnerId, 'view_statements', async (tx, scope) => {
        if (q.permissionRevision !== scope.permissionRevision) throw new AccessFailure('forbidden');
        // Target must exist in this partner. Monotonic position, not clock time or browser count.
        const [target] = await tx`select position from portal_statements.notice_sources
          where partner_id=${scope.partnerId} and position=${q.throughNoticeId}::bigint`;
        if (!target) throw new AccessFailure('forbidden');
        const [changed] =
          await tx`insert into portal_access.notice_seen(partner_id,user_id,through_position)
          values(${scope.partnerId},${scope.userId},${q.throughNoticeId}::bigint)
          on conflict(partner_id,user_id) do update set through_position=excluded.through_position
          where portal_access.notice_seen.through_position<excluded.through_position
          returning through_position::text`;
        if (changed) await advanceRevisions(tx, scope.partnerId, ['notices']);
        const marker =
          changed ??
          (
            await tx`select through_position::text from portal_access.notice_seen where partner_id=${scope.partnerId} and user_id=${scope.userId}`
          )[0];
        return SeenResponse.parse({
          partnerId: scope.partnerId,
          userId: scope.userId,
          permissionRevision: scope.permissionRevision,
          throughNoticeId: marker.through_position,
        });
      });
    },
  };
}
