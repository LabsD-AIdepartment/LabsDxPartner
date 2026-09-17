import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { ConnectionCommand, ConnectionResult } from '@/contracts/marketing-connections';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash } from '@/server/modules/access/command-audit';
import { advanceRevisions } from '@/server/platform/db/revisions';
import { VerifiedShopVideo, type createShopVideoVerifier } from './video-verifier';

type Verifier = ReturnType<typeof createShopVideoVerifier>;
/** Native staff commands; source I/O is outside SQL. Host must provide the verified owner adapter.
 * No route is enabled merely by constructing this service. Pause still works with no adapter. */
export function createShopVideoLifecycle(
  access: ReturnType<typeof createPartnerAccess>,
  verifier: Verifier | null,
) {
  return async (headers: Headers, input: unknown, signal: AbortSignal) => {
    const parsed = ConnectionCommand.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const cmd = parsed.data;
    const hash = commandHash('shop-video-connection:' + cmd.action, cmd);
    async function state(
      tx: TransactionSql,
      actor: { userId: string; revision: string },
      write: boolean,
    ) {
      if (actor.userId !== cmd.actorId || actor.revision !== cmd.permissionRevision)
        throw new AccessFailure('forbidden');
      // Connection update lock only in final short transaction, never across a network call.
      const rows = write
        ? await tx`select c.*,c.revision::text as version from portal_marketing.connections c
          join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actor.userId}
          where c.id=${cmd.connectionId} and c.platform='tiktok' and c.capability='tiktok.shop_video' for update of c for share of g`
        : await tx`select c.*,c.revision::text as version from portal_marketing.connections c
          join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actor.userId}
          where c.id=${cmd.connectionId} and c.platform='tiktok' and c.capability='tiktok.shop_video' for share of c,g`;
      const c = rows[0];
      if (!c) throw new AccessFailure('forbidden');
      const [prior] =
        await tx`select request_hash,result from portal_marketing.connection_commands where actor_id=${actor.userId} and id=${cmd.idempotencyKey}`;
      if (prior) {
        if (prior.request_hash !== hash) throw new AccessFailure('conflict');
        return { c, prior: ConnectionResult.parse({ ...prior.result, replayed: true }) };
      }
      if (c.version !== cmd.revision) throw new AccessFailure('conflict');
      return { c, prior: null };
    }
    const prepared = await access.withStaffCapability(
      headers,
      'manage_partners',
      true,
      async (tx, actor) => {
        const value = await state(tx, actor, false);
        let configurationDigest: string | null = null;
        if (!value.prior && cmd.action === 'verify') {
          const p = verifier?.configured(cmd.connectionId);
          if (!p || p.namespace !== value.c.namespace || p.shopId !== value.c.account_id)
            throw new AccessFailure('forbidden');
          configurationDigest = createHash('sha256').update(JSON.stringify(p)).digest('hex');
        }
        return { ...value, configurationDigest };
      },
    );
    if (prepared.prior) return prepared.prior;
    const proof =
      cmd.action === 'verify'
        ? VerifiedShopVideo.parse(await verifier!.verify(cmd.connectionId, signal))
        : null;
    signal.throwIfAborted();
    return access.withStaffCapability(headers, 'manage_partners', true, async (tx, actor) => {
      const { c, prior } = await state(tx, actor, true);
      if (prior) return prior;
      signal.throwIfAborted();
      if (proof) {
        const p = verifier?.configured(c.id);
        if (
          !p ||
          proof.configurationDigest !== prepared.configurationDigest ||
          proof.connectionId !== c.id ||
          proof.namespace !== c.namespace ||
          proof.accountId !== c.account_id ||
          proof.configurationDigest !== createHash('sha256').update(JSON.stringify(p)).digest('hex')
        )
          throw new AccessFailure('conflict');
        const [fresh] =
          await tx`select ${proof.checkedAt}::timestamptz between clock_timestamp()-interval '2 minutes' and clock_timestamp() as valid`;
        if (!fresh.valid) throw new AccessFailure('conflict');
        await tx`update portal_marketing.connections set enabled=true,verified_at=${proof.checkedAt}::timestamptz,verification=${JSON.stringify(proof)}::jsonb where id=${c.id}`;
      } else if (cmd.action === 'pause') {
        await tx`update portal_marketing.connections set enabled=false where id=${c.id}`;
      } else {
        if (!c.enabled || !c.verified_at) throw new AccessFailure('conflict');
        // Retry a repaired report; account access/schema holds require Verify, never this shortcut.
        await tx`update portal_marketing.video_windows w set state='queued',issue=null,attempt_count=0,retry_paused=false,next_attempt_at=clock_timestamp()
          from portal_marketing.video_schedules s where s.connection_id=w.connection_id and w.connection_id=${c.id}
          and w.connection_revision=${c.version} and s.connection_revision=${c.version} and w.timezone=s.timezone
          and w.period_from>=s.period_from and w.period_to<=s.period_to
          and w.period_to-w.period_from=1
          and w.state='needs-attention' and w.lease_token is null and w.issue not in ('access','invalid-source')`;
      }
      const [current] =
        await tx`select enabled,revision::text from portal_marketing.connections where id=${c.id}`;
      const partners =
        await tx`select distinct t.partner_id from portal_marketing.video_mappings m join portal_marketing.targets t on t.id=m.target_id where m.connection_id=${c.id} order by t.partner_id`;
      for (const p of partners) await advanceRevisions(tx, p.partner_id, ['metrics']);
      const result = ConnectionResult.parse({
        connectionId: c.id,
        revision: current.revision,
        enabled: current.enabled,
        replayed: false,
      });
      await tx`insert into portal_marketing.connection_commands(id,actor_id,connection_id,action,request_hash,result)
        values(${cmd.idempotencyKey},${actor.userId},${c.id},${cmd.action},${hash},${JSON.stringify(result)}::jsonb)`;
      return result;
    });
  };
}
