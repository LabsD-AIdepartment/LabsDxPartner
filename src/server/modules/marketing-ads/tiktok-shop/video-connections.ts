import { ConnectionsSnapshot } from '@/contracts/marketing-connections';
import { RegistrationScope } from '@/contracts/ad-registration';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { createShopVideoLifecycle } from './video-lifecycle';

type Verifier = Parameters<typeof createShopVideoLifecycle>[1];
/** Native status reads only. Grant-filtered SQL owns state; GET never fetches source reports. */
export function createShopVideoConnections(
  access: ReturnType<typeof createPartnerAccess>,
  verifier: Verifier,
) {
  return {
    command: createShopVideoLifecycle(access, verifier),
    async read(headers: Headers, input: unknown) {
      const parsed = RegistrationScope.safeParse(input);
      if (!parsed.success) throw new AccessFailure('invalid_input');
      const scope = parsed.data;
      return access.withStaffCapability(headers, 'manage_partners', false, async (tx, actor) => {
        if (actor.userId !== scope.actorId || actor.revision !== scope.permissionRevision)
          throw new AccessFailure('forbidden');
        const rows =
          await tx`select c.*,c.revision::text as version,r.jobs,r.attention,r.retryable,r.last_success_at
          from portal_marketing.connections c
          join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actor.userId}
          left join lateral (
            select count(*)::int as jobs,
              count(*) filter(where w.state='needs-attention' or w.retry_paused)::int as attention,
              count(*) filter(where w.state='needs-attention' and w.lease_token is null
                and w.issue not in ('access','invalid-source'))::int as retryable,
              max(w.last_success_at) as last_success_at
            from portal_marketing.video_windows w
            join portal_marketing.video_schedules s on s.connection_id=w.connection_id
            where w.connection_id=c.id and w.connection_revision=c.revision
              and s.connection_revision=c.revision and w.timezone=s.timezone
              and w.period_from>=s.period_from and w.period_to<=s.period_to
              and w.period_to-w.period_from=1
          ) r on true
          where c.platform='tiktok' and c.capability='tiktok.shop_video'
          order by c.label,c.id limit 101`;
        if (rows.length > 100) throw new AccessFailure('conflict');
        return ConnectionsSnapshot.parse({
          ...scope,
          connections: rows.map((c) => {
            const profile = verifier?.configured(c.id);
            return {
              id: c.id,
              label: c.label,
              platform: 'tiktok',
              accountId: c.account_id,
              revision: c.version,
              enabled: c.enabled,
              configured:
                !!profile && profile.namespace === c.namespace && profile.shopId === c.account_id,
              verifiedAt: c.verified_at ? new Date(c.verified_at).toISOString() : null,
              jobs: c.jobs,
              attention: c.attention,
              retryable: c.retryable,
              lastSuccessAt: c.last_success_at ? new Date(c.last_success_at).toISOString() : null,
            };
          }),
        });
      });
    },
  };
}
