import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { advanceRevisions } from '@/server/platform/db/revisions';
import type { TransactionSql } from 'postgres';
import {
  AdDraft,
  AdRegistrationSnapshot,
  RegistrationScope,
  type RegistrationScopeValue,
} from '@/contracts/ad-registration';
import {
  NativeAdLookup,
  NativeAdSave,
  NativeAdReceipt,
  NativeAdSaved,
  NativeTargetCreate,
  NativeTargetSaved,
  NativeTargetOptions,
  NativeTargetQuery,
} from '@/contracts/marketing-native';
import { SourceIdentityV2 } from '@/contracts/platform-capabilities';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash, priorCommand, recordCommand } from '@/server/modules/access/command-audit';
import { createMarketingProviderRegistry } from './provider';

type Access = ReturnType<typeof createPartnerAccess>;
type Draft = z.infer<typeof AdDraft>;
const instant = (value: string | Date) => new Date(value).toISOString();
const nullableInstant = (value: string | Date | null) => (value === null ? null : instant(value));
type Actor = { userId: string; revision: string };
const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
  const result = schema.safeParse(value);
  if (!result.success) throw new AccessFailure('invalid_input');
  return result.data;
};
const assertActor = (actor: Actor, scope: RegistrationScopeValue) => {
  if (actor.userId !== scope.actorId || actor.revision !== scope.permissionRevision)
    throw new AccessFailure('forbidden');
};
async function context(tx: TransactionSql, actor: Actor, draft: Draft) {
  const [target] = await tx`select t.*,t.revision::text as version from portal_marketing.targets t
    join portal_access.partners p on p.id=t.partner_id
    join portal_content.clips c on c.partner_id=t.partner_id and c.id=t.clip_id
    where t.id=${draft.targetId} and t.active and p.status='active' and not c.removed
    for share of t,p,c`;
  const [connection] =
    await tx`select c.*,c.revision::text as version from portal_marketing.connections c
    join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actor.userId}
    where c.id=${draft.connectionId} and c.platform=${draft.platform} and c.capability='facebook.ad_insights' and c.enabled and c.verified_at is not null
    for share of c,g`;
  if (!target || !connection) throw new AccessFailure('forbidden');
  return {
    target,
    connection,
    identity: SourceIdentityV2.parse({
      schemaVersion: 2,
      platform: connection.platform,
      capability: connection.capability,
      namespace: connection.namespace,
      accountId: connection.account_id,
      connectionId: connection.id,
      objectType: 'ad',
      externalId: draft.externalId,
    }),
  };
}
/** Current staff and source grants are checked on both sides of provider I/O. */
export function createMarketingRegistration(
  access: Access,
  providers = createMarketingProviderRegistry(),
) {
  return {
    async targetOptions(headers: Headers, input: unknown) {
      const scope = parse(NativeTargetQuery, input);
      return access.withStaffCapability(headers, 'manage_partners', false, async (tx, actor) => {
        assertActor(actor, scope);
        const rows = await tx`select c.partner_id,p.name,c.id,c.title from portal_content.clips c
          join portal_access.partners p on p.id=c.partner_id
          where p.status='active' and not c.removed
          and (${scope.q}='' or position(lower(${scope.q}) in lower(p.name))>0 or position(lower(${scope.q}) in lower(c.title))>0)
          order by p.name,c.partner_id,c.id limit 101`;
        return NativeTargetOptions.parse({
          ...scope,
          hasMore: rows.length > 100,
          clips: rows.slice(0, 100).map((r) => ({
            partnerId: r.partner_id,
            partnerName: r.name,
            clipId: r.id,
            title: r.title,
          })),
        });
      });
    },
    async createTarget(headers: Headers, input: unknown) {
      const command = parse(NativeTargetCreate, input);
      return access.withStaffCapability(headers, 'manage_partners', true, async (tx, actor) => {
        assertActor(actor, command);
        const [clip] = await tx`select c.id from portal_content.clips c
          join portal_access.partners p on p.id=c.partner_id
          where c.partner_id=${command.partnerId} and c.id=${command.clipId}
          and p.status='active' and not c.removed for share of c,p`;
        if (!clip) throw new AccessFailure('forbidden');
        const hash = commandHash('create-ad-target', command);
        const prior = await priorCommand(tx, actor.userId, command.idempotencyKey, hash);
        if (prior) return { ...parse(NativeTargetSaved, prior), replayed: true };
        const [existing] = await tx`select * from portal_marketing.targets
          where partner_id=${command.partnerId} and clip_id=${command.clipId} and agreement_id=${command.agreementId}`;
        if (
          existing &&
          (!existing.active ||
            existing.evidence_ref !== command.evidenceRef ||
            existing.agreement_label !== command.agreementLabel)
        )
          throw new AccessFailure('conflict');
        const targetId = existing?.id ?? randomUUID();
        if (!existing)
          await tx`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref)
          values(${targetId},${command.partnerId},${command.clipId},${command.agreementId},${command.agreementLabel},${command.evidenceRef})`;
        const result = NativeTargetSaved.parse({ targetId, replayed: !!existing });
        await recordCommand(
          tx,
          actor.userId,
          command.partnerId,
          'create-ad-target',
          targetId,
          command.idempotencyKey,
          hash,
          result,
          {
            clipId: command.clipId,
            agreementId: command.agreementId,
            evidenceRef: command.evidenceRef,
          },
        );
        return result;
      });
    },
    async read(headers: Headers, input: unknown) {
      const scope = parse(RegistrationScope, input);
      return access.withStaffCapability(headers, 'manage_partners', false, async (tx, actor) => {
        assertActor(actor, scope);
        const targets =
          await tx`select t.*,p.name as partner_name,c.title,c.cover,(t.active and p.status='active' and not c.removed) as available from portal_marketing.targets t
          join portal_access.partners p on p.id=t.partner_id
          join portal_content.clips c on c.partner_id=t.partner_id and c.id=t.clip_id
          where (t.active and p.status='active' and not c.removed) or exists (
            select 1 from portal_marketing.associations a
            join portal_marketing.connection_grants g on g.connection_id=a.connection_id
            where a.target_id=t.id and g.user_id=${actor.userId}) order by t.id limit 501`;
        const connections = await tx`select c.* from portal_marketing.connections c
          join portal_marketing.connection_grants g on g.connection_id=c.id and g.user_id=${actor.userId}
          where c.capability='facebook.ad_insights' order by c.id limit 101`;
        const associations = await tx`select a.*,j.state,j.last_success_at,j.data_through,j.issue
          from portal_marketing.associations a
          join portal_marketing.connection_grants g on g.connection_id=a.connection_id and g.user_id=${actor.userId}
          join portal_marketing.sync_jobs j on j.association_id=a.id and j.mapping_revision=a.mapping_revision
          order by a.created_at desc,a.id limit 501`;
        if (targets.length > 500 || connections.length > 100 || associations.length > 500)
          throw new Error('Registration list requires pagination');
        const mappedTargets = targets.map((t) => ({
          id: t.id,
          available: t.available,
          partnerId: t.partner_id,
          partnerName: t.partner_name,
          clipId: t.clip_id,
          clipTitle: t.title,
          agreementId: t.agreement_id,
          agreementLabel: t.agreement_label,
          cover: t.cover,
        }));
        const mappedConnections = connections.map((c) => {
          const enabled = c.enabled && providers.supports(c.capability, c.id);
          return {
            id: c.id,
            platform: c.platform,
            accountId: c.account_id,
            label: c.label,
            state: 'ready',
            availability: {
              capability: c.capability,
              phase: enabled ? 'enabled' : 'disabled',
              verifiedAt: nullableInstant(c.verified_at),
              reason: enabled ? null : 'การเชื่อมต่อนี้ยังไม่เปิดใช้งาน',
            },
          };
        });
        return AdRegistrationSnapshot.parse({
          schemaVersion: 2,
          sourceMode: 'native',
          ...scope,
          canManage: true,
          targets: mappedTargets,
          connections: mappedConnections,
          associations: associations.map((a) => ({
            id: a.id,
            target: mappedTargets.find((t) => t.id === a.target_id),
            connection: mappedConnections.find((c) => c.id === a.connection_id),
            externalId: a.external_id,
            objectType: a.object_type,
            name: a.name,
            creativeId: a.creative_ids[0],
            delivery: 'unknown',
            sync: a.state === 'running' ? 'syncing' : a.state,
            createdAt: instant(a.created_at),
            lastSuccessAt: nullableInstant(a.last_success_at),
            dataThrough: nullableInstant(a.data_through),
            issue: a.issue ?? null,
          })),
        });
      });
    },
    async resolve(headers: Headers, input: unknown, signal: AbortSignal) {
      const command = parse(NativeAdLookup, input);
      const before = await access.withStaffCapability(
        headers,
        'manage_partners',
        false,
        async (tx, actor) => {
          assertActor(actor, command);
          return context(tx, actor, command.draft);
        },
      );
      // No network call occurs while a database transaction/authorization lock is held.
      const source = await providers.resolve(before.identity, signal);
      // A multi/unknown creative can be viewed later, but cannot silently become this single clip.
      if (source.creativeIds?.length !== 1) throw new AccessFailure('conflict');
      signal.throwIfAborted();
      return access.withStaffCapability(headers, 'manage_partners', false, async (tx, actor) => {
        assertActor(actor, command);
        const current = await context(tx, actor, command.draft);
        if (
          current.target.version !== before.target.version ||
          current.connection.version !== before.connection.version ||
          JSON.stringify(current.identity) !== JSON.stringify(before.identity) ||
          current.target.partner_id !== before.target.partner_id ||
          current.target.clip_id !== before.target.clip_id ||
          current.target.agreement_id !== before.target.agreement_id
        )
          throw new AccessFailure('conflict');
        const id = randomUUID();
        const [receipt] = await tx`insert into portal_marketing.lookup_receipts
          (id,actor_id,staff_revision,target_id,target_revision,connection_id,connection_revision,draft,resolved,expires_at)
          values(${id},${actor.userId},${actor.revision},${current.target.id},${current.target.version},
          ${current.connection.id},${current.connection.version},${JSON.stringify(command.draft)}::text::jsonb,
          ${JSON.stringify(source)}::text::jsonb,clock_timestamp()+interval '2 minutes') returning expires_at`;
        return NativeAdReceipt.parse({
          schemaVersion: 2,
          receipt: id,
          expiresAt: instant(receipt.expires_at),
          draft: command.draft,
          source,
        });
      });
    },
    async save(headers: Headers, input: unknown) {
      const command = parse(NativeAdSave, input);
      return access.withStaffCapability(headers, 'manage_partners', true, async (tx, actor) => {
        assertActor(actor, command);
        const current = await context(tx, actor, command.draft);
        const hash = commandHash('register-ad', command);
        const prior = await priorCommand(tx, actor.userId, command.idempotencyKey, hash);
        if (prior) return NativeAdSaved.parse({ ...parse(NativeAdSaved, prior), replayed: true });
        const [receipt] = await tx`select * from portal_marketing.lookup_receipts
          where id=${command.receipt} and actor_id=${actor.userId} and expires_at>clock_timestamp() for update`;
        if (
          !receipt ||
          String(receipt.staff_revision) !== actor.revision ||
          receipt.target_id !== current.target.id ||
          String(receipt.target_revision) !== current.target.version ||
          receipt.connection_id !== current.connection.id ||
          String(receipt.connection_revision) !== current.connection.version ||
          JSON.stringify(AdDraft.parse(receipt.draft)) !== JSON.stringify(command.draft)
        )
          throw new AccessFailure('conflict');
        const source = parse(NativeAdReceipt, {
          schemaVersion: 2,
          receipt: receipt.id,
          expiresAt: instant(receipt.expires_at),
          draft: receipt.draft,
          source: receipt.resolved,
        }).source;
        if (
          JSON.stringify(source.identity) !== JSON.stringify(current.identity) ||
          source.creativeIds?.length !== 1
        )
          throw new AccessFailure('conflict');
        // Unique source identity enforces the invariant even against concurrent/replayed commands.
        const [existing] = await tx`select a.*,j.id as job_id from portal_marketing.associations a
          join portal_marketing.sync_jobs j on j.association_id=a.id and j.mapping_revision=a.mapping_revision
          where a.namespace=${current.identity.namespace} and a.platform=${current.identity.platform}
          and a.account_id=${current.identity.accountId} and a.object_type='ad' and a.external_id=${current.identity.externalId}`;
        if (
          existing &&
          (existing.partner_id !== current.target.partner_id ||
            existing.clip_id !== current.target.clip_id ||
            existing.agreement_id !== current.target.agreement_id)
        )
          throw new AccessFailure('conflict');
        const associationId = existing?.id ?? randomUUID(),
          jobId = existing?.job_id ?? randomUUID();
        if (!existing) {
          await tx`insert into portal_marketing.associations
            (id,target_id,partner_id,clip_id,agreement_id,connection_id,namespace,account_id,platform,object_type,external_id,source_identity,creative_ids,name,created_by)
            values(${associationId},${current.target.id},${current.target.partner_id},${current.target.clip_id},${current.target.agreement_id},
              ${current.connection.id},${source.identity.namespace},${source.identity.accountId},'facebook','ad',${source.identity.externalId},
              ${JSON.stringify(source.identity)}::text::jsonb,${JSON.stringify(source.creativeIds)}::text::jsonb,${source.name},${actor.userId})`;
          await tx`insert into portal_marketing.sync_jobs(id,association_id,mapping_revision) values(${jobId},${associationId},1)`;
          await advanceRevisions(tx, current.target.partner_id, ['metrics']);
        }
        const result = NativeAdSaved.parse({
          schemaVersion: 2,
          associationId,
          jobId,
          partnerId: current.target.partner_id,
          clipId: current.target.clip_id,
          agreementId: current.target.agreement_id,
          externalId: command.draft.externalId,
          replayed: !!existing,
        });
        await recordCommand(
          tx,
          actor.userId,
          current.target.partner_id,
          'register-ad',
          associationId,
          command.idempotencyKey,
          hash,
          result,
          {
            receiptId: command.receipt,
            sourceIdentity: source.identity,
            targetRevision: current.target.version,
            connectionRevision: current.connection.version,
          },
        );
        return result;
      });
    },
  };
}
