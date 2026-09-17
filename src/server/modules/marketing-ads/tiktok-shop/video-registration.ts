import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TransactionSql } from 'postgres';
import {
  ShopVideoLookup,
  ShopVideoSave,
  ShopVideoSaved,
  ShopVideoOptions,
  ShopVideoOptionsQuery,
} from '@/contracts/shop-video';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash, priorCommand, recordCommand } from '@/server/modules/access/command-audit';
import { advanceRevisions } from '@/server/platform/db/revisions';
import { VideoObservationSchema } from './video-contract';

const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AccessFailure('invalid_input');
  return parsed.data;
};
type Actor = { userId: string; revision: string };
type Lookup = z.infer<typeof ShopVideoLookup>;
async function binding(tx: TransactionSql, actor: Actor, command: Lookup) {
  if (actor.userId !== command.actorId || actor.revision !== command.permissionRevision)
    throw new AccessFailure('forbidden');
  const [target] = await tx`select t.*,t.revision::text as version from portal_marketing.targets t
    join portal_access.partners p on p.id=t.partner_id
    join portal_content.clips c on c.partner_id=t.partner_id and c.id=t.clip_id
    where t.id=${command.targetId} and t.active and p.status='active' and not c.removed for share of t,p,c`;
  const [connection] =
    await tx`select c.*,c.revision::text as version from portal_marketing.connections c
    join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actor.userId}
    where c.id=${command.connectionId} and c.platform='tiktok' and c.capability='tiktok.shop_video'
    and c.enabled and c.verified_at is not null for share of c,g`;
  if (!target || !connection) throw new AccessFailure('forbidden');
  return { target, connection };
}
async function observation(tx: TransactionSql, command: Lookup, revision: string) {
  // Check the latest complete collection, not any historical row where the ID happened to exist.
  const [row] =
    await tx`select g.id as generation_id,o.creator_id,o.observation from portal_marketing.video_windows w
    join portal_marketing.video_generations g on g.window_id=w.id and g.id=w.current_generation
    left join portal_marketing.video_observations o on o.generation_id=g.id and o.video_id=${command.videoId}
    where w.connection_id=${command.connectionId} and w.connection_revision=${revision}
    and g.connection_revision=${revision} and w.state='ready'
    order by g.created_at desc,g.id desc limit 1 for share of w`;
  if (!row?.observation) throw new AccessFailure('conflict');
  const video = VideoObservationSchema.parse(row.observation);
  if (video.videoId !== command.videoId || video.creator.openId !== row.creator_id)
    throw new AccessFailure('conflict');
  return { generationId: row.generation_id as string, video };
}
/** Indexed source evidence replaces per-video full-shop HTTP calls; authority remains staff+grant. */
export function createShopVideoRegistration(access: ReturnType<typeof createPartnerAccess>) {
  return {
    async options(headers: Headers, input: unknown) {
      const scope = parse(ShopVideoOptionsQuery, input);
      return access.withStaffCapability(headers, 'manage_partners', false, async (tx, actor) => {
        if (scope.actorId !== actor.userId || scope.permissionRevision !== actor.revision)
          throw new AccessFailure('forbidden');
        const connections =
          await tx`select c.id,c.label,(c.enabled and c.verified_at is not null and exists(
          select 1 from portal_marketing.video_windows w where w.connection_id=c.id
          and w.connection_revision=c.revision and w.state='ready' and w.current_generation is not null)) as available
          from portal_marketing.connections c join portal_marketing.connection_grants g
          on g.connection_id=c.id and g.user_id=${actor.userId}
          where c.platform='tiktok' and c.capability='tiktok.shop_video' order by c.label,c.id limit 101`;
        const targets = connections.length
          ? await tx`select t.id,t.partner_id,t.clip_id,p.name,c.title,t.agreement_label
          from portal_marketing.targets t join portal_access.partners p on p.id=t.partner_id
          join portal_content.clips c on c.partner_id=t.partner_id and c.id=t.clip_id
          where t.active and p.status='active' and not c.removed
          and (${scope.q}='' or position(lower(${scope.q}) in lower(p.name||' '||c.title||' '||t.agreement_label))>0)
          order by p.name,c.title,t.id limit 101`
          : [];
        return ShopVideoOptions.parse({
          ...scope,
          connections,
          hasMore: targets.length > 100,
          targets: targets
            .slice(0, 100)
            .map((t) => ({
              id: t.id,
              partnerId: t.partner_id,
              clipId: t.clip_id,
              label: `${t.name} · ${t.title} · ${t.agreement_label}`,
            })),
        });
      });
    },
    async lookup(headers: Headers, input: unknown) {
      const command = parse(ShopVideoLookup, input);
      return access.withStaffCapability(headers, 'manage_partners', false, async (tx, actor) => {
        const { target, connection } = await binding(tx, actor, command);
        const source = await observation(tx, command, connection.version);
        return {
          ...command,
          generationId: source.generationId,
          targetRevision: target.version as string,
          connectionRevision: connection.version as string,
          creatorId: source.video.creator.openId,
          title: source.video.title,
          creatorName: source.video.creator.nickname,
        };
      });
    },
    async save(headers: Headers, input: unknown) {
      const command = parse(ShopVideoSave, input);
      return access.withStaffCapability(headers, 'manage_partners', true, async (tx, actor) => {
        const { target, connection } = await binding(tx, actor, command);
        const hash = commandHash('register-shop-video', command);
        const prior = await priorCommand(tx, actor.userId, command.idempotencyKey, hash);
        if (prior) return { ...ShopVideoSaved.parse(prior), replayed: true };
        if (
          target.version !== command.targetRevision ||
          connection.version !== command.connectionRevision
        )
          throw new AccessFailure('conflict');
        const source = await observation(tx, command, connection.version);
        if (
          source.generationId !== command.generationId ||
          source.video.creator.openId !== command.creatorId
        )
          throw new AccessFailure('conflict');
        const key = JSON.stringify([connection.namespace, connection.account_id, command.videoId]);
        await tx`select pg_advisory_xact_lock(hashtextextended(${key},0))`;
        const [existing] =
          await tx`select * from portal_marketing.video_mappings where namespace=${connection.namespace} and shop_id=${connection.account_id} and video_id=${command.videoId}`;
        if (
          existing &&
          (existing.target_id !== target.id ||
            existing.creator_id !== command.creatorId ||
            existing.connection_id !== connection.id)
        )
          throw new AccessFailure('conflict');
        const mappingId = existing?.id ?? randomUUID();
        if (!existing) {
          await tx`insert into portal_marketing.video_mappings(id,target_id,connection_id,namespace,shop_id,video_id,creator_id,proof_generation,created_by)
            values(${mappingId},${target.id},${connection.id},${connection.namespace},${connection.account_id},${command.videoId},${command.creatorId},${command.generationId},${actor.userId})`;
          await advanceRevisions(tx, target.partner_id, ['metrics']);
        }
        const result = {
          mappingId,
          partnerId: target.partner_id as string,
          clipId: target.clip_id as string,
          videoId: command.videoId,
          replayed: !!existing,
        };
        await recordCommand(
          tx,
          actor.userId,
          target.partner_id,
          'register-shop-video',
          mappingId,
          command.idempotencyKey,
          hash,
          result,
          {
            generationId: command.generationId,
            targetRevision: command.targetRevision,
            connectionRevision: command.connectionRevision,
            creatorId: command.creatorId,
          },
        );
        return result;
      });
    },
  };
}
