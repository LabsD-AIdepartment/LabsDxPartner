import { StaffAccessQuery, StaffAccessSnapshot } from '@/contracts/staff-access';
import { AccessFailure, type createPartnerAccess } from './access';
const page = <T extends { id: string }>(rows: T[]) => ({
  items: rows.slice(0, 50),
  nextCursor: rows.length > 50 ? rows[49].id : null,
  totalCount: null,
});

/** Staff access metadata only. Explicit projections never select password, bearer or token hash. */
export function createStaffAccessReader(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const query = StaffAccessQuery.parse(input);
    return access.withStaff(headers, async (tx, session) => {
      if (query.expectedRevision !== session.revision) throw new AccessFailure('conflict');
      const partners = await tx`select id,name,status from portal_access.partners
        where id > ${query.partnerCursor ?? ''} order by id limit 51`;
      let selected = null;
      if (query.partnerId) {
        const [partner] =
          await tx`select id,name,status from portal_access.partners where id=${query.partnerId} for share`;
        if (!partner) throw new AccessFailure('forbidden');
        const members =
          await tx`select m.id,m.user_id as "userId",u.name as "displayName",u.username,
          m.status,m.permission_revision::text as revision,m.verified_contact_ref as "verifiedContactRef",m.capabilities,
          (m.status='active' AND ${partner.status}='active' AND m.verified_contact_ref IS NOT NULL
           AND NOT EXISTS(select 1 from portal_access.staff_grants g where g.user_id=m.user_id)
           AND EXISTS(select 1 from portal_identity.accounts a where a.user_id=m.user_id AND a.account_id=m.user_id AND a.provider_id='credential' AND a.password IS NOT NULL)) as "resetAllowed"
          from portal_access.memberships m join portal_identity.users u on u.id=m.user_id
          where m.partner_id=${query.partnerId} AND m.id>${query.memberCursor ?? ''} order by m.id limit 51`;
        const invitations =
          await tx`select id,recipient_name as "recipientName",verified_contact_ref as "verifiedContactRef",capabilities,
          expires_at as "expiresAt", CASE WHEN claimed_at IS NOT NULL THEN 'claimed' WHEN revoked_at IS NOT NULL THEN 'revoked'
            WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'pending' END as status
          from portal_access.invites where partner_id=${query.partnerId} AND id>${query.inviteCursor ?? ''} order by id limit 51`;
        selected = {
          partner,
          members: page(members.map((row) => ({ ...row, id: String(row.id) }))),
          invitations: page(
            invitations.map((row) => ({
              ...row,
              id: String(row.id),
              expiresAt: new Date(row.expiresAt).toISOString(),
            })),
          ),
        };
      }
      return StaffAccessSnapshot.parse({
        session,
        partners: page(partners.map((row) => ({ ...row, id: String(row.id) }))),
        selected,
      });
    });
  };
}
