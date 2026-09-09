import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Id } from '@/contracts/common';
import { Revision } from '@/contracts/changes';
import { CatalogueSnapshot } from '@/contracts/catalogue';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash, priorCommand, recordCommand } from '@/server/modules/access/command-audit';
import { advanceRevisions } from '@/server/platform/db/revisions';

export interface CatalogueRepository {
  /** Must return already reviewed server-owned metadata, never the browser command body. */
  load(partnerId: string, reviewId: string): Promise<unknown>;
}
export const catalogueDigest = (snapshot: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(CatalogueSnapshot.parse(snapshot)))
    .digest('hex');
const Command = z.strictObject({
  partnerId: Id,
  reviewId: Id,
  expectedRevision: Revision,
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: Id,
});
const Receipt = z.strictObject({ partnerId: Id, revision: Revision });

export function createCataloguePublisher(
  access: ReturnType<typeof createPartnerAccess>,
  source: CatalogueRepository,
) {
  return async (headers: Headers, input: unknown) => {
    const parsed = Command.safeParse(input);
    if (!parsed.success) throw new AccessFailure('invalid_input');
    const command = parsed.data;
    // Reject unauthorized callers before loading private review metadata. Loading is outside
    // DB locks; current staff/freshness is checked again when committing the supplied snapshot.
    const prior = await access.withStaffCapability(
      headers,
      'manage_partners',
      true,
      async (tx, actor) => {
        return priorCommand(
          tx,
          actor.userId,
          command.idempotencyKey,
          commandHash('publish-catalogue', command),
        );
      },
    );
    if (prior) return { ...Receipt.parse(prior), replayed: true };
    const snapshot = CatalogueSnapshot.parse(
      await source.load(command.partnerId, command.reviewId),
    );
    if (
      snapshot.partnerId !== command.partnerId ||
      catalogueDigest(snapshot) !== command.expectedDigest
    )
      throw new AccessFailure('conflict');
    return access.withStaffCapability(headers, 'manage_partners', true, async (tx, actor) => {
      const hash = commandHash('publish-catalogue', command);
      const replay = await priorCommand(tx, actor.userId, command.idempotencyKey, hash);
      if (replay) return { ...Receipt.parse(replay), replayed: true };
      await tx`select pg_advisory_xact_lock(hashtextextended(${command.partnerId},981709))`;
      const [partner] =
        await tx`select id from portal_access.partners where id=${command.partnerId} and status='active' for share`;
      if (!partner) throw new AccessFailure('forbidden');
      const [old] =
        await tx`select revision::text from portal_content.catalogues where partner_id=${command.partnerId} for update`;
      if ((old?.revision ?? '0') !== command.expectedRevision) throw new AccessFailure('conflict');
      const revision = (BigInt(command.expectedRevision) + 1n).toString();
      await tx`insert into portal_content.catalogues(partner_id,revision,source_revision,evidence_ref,source_digest,profile,published_by)
        values(${command.partnerId},${revision},${snapshot.sourceRevision},${snapshot.evidenceRef},${command.expectedDigest},${JSON.stringify(snapshot.profile)}::text::jsonb,${actor.userId})
        on conflict(partner_id) do update set revision=excluded.revision,source_revision=excluded.source_revision,
          evidence_ref=excluded.evidence_ref,source_digest=excluded.source_digest,profile=excluded.profile,
          published_by=excluded.published_by,published_at=clock_timestamp()`;
      // A source removal must not erase titles/brand/cover needed by historical earnings.
      await tx`update portal_content.clips set removed=true where partner_id=${command.partnerId}`;
      for (let start = 0; start < snapshot.clips.length; start += 250) {
        await tx`insert into portal_content.clips(partner_id,id,title,brand,published_at,cover,cover_position,removed,source_url)
          select ${command.partnerId},r.id,r.title,r.brand,r."publishedAt",r.cover,r."coverPosition",r.removed,r."sourceUrl"
          from jsonb_to_recordset(${JSON.stringify(snapshot.clips.slice(start, start + 250))}::text::jsonb)
          as r(id text,title text,brand text,"publishedAt" timestamptz,cover text,"coverPosition" text,removed boolean,"sourceUrl" text)
          on conflict(partner_id,id) do update set title=excluded.title,brand=excluded.brand,published_at=excluded.published_at,
            cover=excluded.cover,cover_position=excluded.cover_position,removed=excluded.removed,source_url=excluded.source_url`;
      }
      await advanceRevisions(tx, command.partnerId, ['earnings', 'metrics']);
      const result = { partnerId: command.partnerId, revision };
      await recordCommand(
        tx,
        actor.userId,
        command.partnerId,
        'publish-catalogue',
        command.partnerId,
        command.idempotencyKey,
        hash,
        result,
        { reviewId: command.reviewId, sourceDigest: command.expectedDigest, snapshot },
      );
      return { ...result, replayed: false };
    });
  };
}
