import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AccountProfile,
  ProfilePublishCommand as Command,
  ProfilePublishReceipt as Receipt,
  ProfileReviewQuery,
  ProfileReview,
} from '@/contracts/account-profile';
import { AccountResponse } from '@/contracts/account';
import { Id } from '@/contracts/common';
import { PartnerCapability } from '@/contracts/access';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { commandHash, priorCommand, recordCommand } from '@/server/modules/access/command-audit';
export interface AccountProfileRepository {
  /** Reviewed server-owned source; never deserialize a browser command as the profile. */
  load(partnerId: string, reviewId: string): Promise<unknown>;
}
export const accountProfileDigest = (input: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(AccountProfile.parse(input)))
    .digest('hex');
export function createAccountProfileReview(
  access: ReturnType<typeof createPartnerAccess>,
  source: AccountProfileRepository,
) {
  return async (headers: Headers, input: unknown) => {
    const query = ProfileReviewQuery.parse(input);
    await access.withStaffCapability(headers, 'manage_partners', false, async (tx) => {
      const [partner] =
        await tx`select id from portal_access.partners where id=${query.partnerId} and status='active'`;
      if (!partner) throw new AccessFailure('forbidden');
    });
    const parsed = AccountProfile.safeParse(await source.load(query.partnerId, query.reviewId));
    if (!parsed.success) throw new Error('Account source unavailable');
    if (parsed.data.partnerId !== query.partnerId) throw new AccessFailure('conflict');
    return access.withStaffCapability(headers, 'manage_partners', false, async (tx) => {
      const [partner] =
        await tx`select id from portal_access.partners where id=${query.partnerId} and status='active' for share`;
      if (!partner) throw new AccessFailure('forbidden');
      const [old] =
        await tx`select revision::text from portal_access.account_profiles where partner_id=${query.partnerId}`;
      return ProfileReview.parse({
        ...query,
        expectedRevision: old?.revision ?? '0',
        expectedDigest: accountProfileDigest(parsed.data),
        profile: parsed.data,
      });
    });
  };
}
export function createAccountProfilePublisher(
  access: ReturnType<typeof createPartnerAccess>,
  source: AccountProfileRepository,
) {
  return async (headers: Headers, input: unknown) => {
    const command = Command.parse(input),
      hash = commandHash('publish-account-profile', command);
    const prior = await access.withStaffCapability(headers, 'manage_partners', true, (tx, actor) =>
      priorCommand(tx, actor.userId, command.idempotencyKey, hash),
    );
    if (prior) return Receipt.parse(prior);
    const parsed = AccountProfile.safeParse(await source.load(command.partnerId, command.reviewId));
    if (!parsed.success) throw new Error('Account source unavailable');
    const snapshot = parsed.data;
    if (
      snapshot.partnerId !== command.partnerId ||
      accountProfileDigest(snapshot) !== command.expectedDigest
    )
      throw new AccessFailure('conflict');
    return access.withStaffCapability(headers, 'manage_partners', true, async (tx, actor) => {
      const replay = await priorCommand(tx, actor.userId, command.idempotencyKey, hash);
      if (replay) return Receipt.parse(replay);
      const [partner] =
        await tx`select id from portal_access.partners where id=${command.partnerId} and status='active' for update`;
      if (!partner) throw new AccessFailure('forbidden');
      const [old] =
        await tx`select revision::text from portal_access.account_profiles where partner_id=${command.partnerId} for update`;
      if ((old?.revision ?? '0') !== command.expectedRevision) throw new AccessFailure('conflict');
      const revision = (BigInt(command.expectedRevision) + 1n).toString();
      await tx`insert into portal_access.account_profiles(partner_id,revision,snapshot,source_digest,published_by)
        values(${command.partnerId},${revision},${JSON.stringify(snapshot)}::text::jsonb,${command.expectedDigest},${actor.userId})
        on conflict(partner_id) do update set revision=excluded.revision,snapshot=excluded.snapshot,
        source_digest=excluded.source_digest,published_at=clock_timestamp(),published_by=excluded.published_by`;
      const result = { partnerId: command.partnerId, revision };
      await recordCommand(
        tx,
        actor.userId,
        command.partnerId,
        'publish-account-profile',
        command.partnerId,
        command.idempotencyKey,
        hash,
        result,
        {
          sourceRevision: snapshot.sourceRevision,
          evidenceRef: snapshot.evidenceRef,
          digest: command.expectedDigest,
        },
      );
      return result;
    });
  };
}
const Query = z.strictObject({ partnerId: Id, permissionRevision: Id });
export function createAccountReader(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const q = Query.parse(input);
    const session = await access.session(headers, q.partnerId);
    const member = session.memberships.find((m) => m.partnerId === q.partnerId);
    const capability = member?.capabilities.find(
      (value) => PartnerCapability.safeParse(value).success,
    );
    if (!capability) throw new AccessFailure('forbidden');
    // Re-authorize in the data transaction; the earlier session is not a grant.
    return access.withPartner(
      headers,
      q.partnerId,
      PartnerCapability.parse(capability),
      async (tx, scope) => {
        if (scope.permissionRevision !== q.permissionRevision) throw new AccessFailure('conflict');
        const [user] =
          await tx`select name,username from portal_identity.users where id=${scope.userId}`;
        const [profile] =
          await tx`select snapshot,revision::text,published_at from portal_access.account_profiles where partner_id=${q.partnerId}`;
        const parsedProfile = profile ? AccountProfile.safeParse(profile.snapshot) : null;
        if (parsedProfile && !parsedProfile.success) throw new Error('Account profile unavailable');
        const data = parsedProfile?.data ?? null;
        if (data && data.partnerId !== q.partnerId) throw new AccessFailure('conflict');
        const result = AccountResponse.safeParse({
          dataState: 'ready',
          reasons: [],
          requestId: randomUUID(),
          generatedAt: new Date().toISOString(),
          dataThrough: profile ? new Date(profile.published_at).toISOString() : null,
          revision: profile?.revision ?? '0',
          partnerId: q.partnerId,
          permissionRevision: scope.permissionRevision,
          data: {
            userId: scope.userId,
            displayName: user.name,
            username: user.username,
            agreement: data?.agreement ?? null,
            termsSummary: data?.termsSummary ?? null,
            supportUrl: data?.supportUrl ?? null,
          },
        });
        if (!result.success) throw new Error('Account metadata unavailable');
        return result.data;
      },
    );
  };
}
