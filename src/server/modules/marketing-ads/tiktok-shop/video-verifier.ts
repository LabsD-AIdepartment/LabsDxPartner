import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Id, Instant } from '@/contracts/common';
import { ExternalId } from '@/contracts/platform-capabilities';
import { parseShopVideoProfiles, type VideoProfile } from './video-config';
import { ShopVideoPeriod, VideoPage, type VideoConnection } from './video-contract';
import { videoDailySchedule } from './video-schedule';
import { SHOP_VIDEO_PATH } from './video-collector';
import {
  abortable,
  createShopAuthorizationRead,
  createShopVideoTransport,
  ShopVideoCredentialSchema,
  type VideoTransportDependencies,
} from './video-transport';
import { SourceReadError } from '../source-error';

const AuthorizedShops = z.object({
  code: z.literal(0),
  request_id: z.string().min(1).max(200),
  data: z.object({
    shops: z
      .array(z.object({ id: ExternalId, cipher: z.string().min(1).max(8192), region: z.string() }))
      .max(1000),
  }),
});
/** Internal proof: no credentials, ciphers, other shops or video payloads. */
export const VerifiedShopVideo = z.strictObject({
  schemaVersion: z.literal(1),
  capability: z.literal('tiktok.shop_video'),
  connectionId: Id,
  namespace: Id,
  accountId: ExternalId,
  acquisitionOwner: z.literal('sale-dashboard'),
  sourceConnectionRef: Id,
  configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  currency: z.literal('THB'),
  timezone: z.literal('Asia/Bangkok'),
  marketPolicy: z.literal('TH-v1'),
  apiVersion: z.literal('202605'),
  checkedAt: Instant,
  authorizationRequestId: z.string().min(1).max(200),
  analyticsRequestId: z.string().min(1).max(200),
  probePeriod: ShopVideoPeriod,
  latestAvailableDate: z.iso.date(),
  reportReady: z.boolean(),
});
const digest = (profile: VideoProfile) =>
  createHash('sha256').update(JSON.stringify(profile)).digest('hex');

/** Runs within the source-owner boundary. Its credential callback must resolve exactly the
 * configured per-shop owner reference; this service never refreshes/copies a stored token.
 * Before enabling a DB connection, its caller must recheck grants/revision/configurationDigest. */
export function createShopVideoVerifier(
  rawProfiles: readonly VideoProfile[],
  deps: VideoTransportDependencies,
) {
  const profiles = parseShopVideoProfiles(JSON.stringify(rawProfiles));
  return {
    configured(id: string) {
      const p = profiles.find((p) => p.connectionId === id);
      return p ? { ...p } : undefined;
    },
    async verify(id: string, parent: AbortSignal) {
      const signal = AbortSignal.any([parent, AbortSignal.timeout(20000)]);
      try {
        signal.throwIfAborted();
        const p = profiles.find((p) => p.connectionId === id);
        if (!p) throw new SourceReadError('access');
        // These are an explicit supported-market policy, not fields returned by authorized-shops.
        if (p.currency !== 'THB' || p.timezone !== 'Asia/Bangkok')
          throw new SourceReadError('invalid-source');
        const connection: VideoConnection = {
          connectionId: p.connectionId,
          namespace: p.namespace,
          shopId: p.shopId,
          currency: p.currency,
          timezone: p.timezone,
        };
        const parsed = ShopVideoCredentialSchema.safeParse(
          await abortable(deps.credential(id, signal), signal),
        );
        if (!parsed.success || parsed.data.shopId !== p.shopId) throw new SourceReadError('access');
        // Capture one immutable credential snapshot for BOTH requests; never mix refreshed identities.
        const pinned = Object.freeze({ ...parsed.data });
        const transport = { ...deps, credential: async () => pinned };
        const authorized = AuthorizedShops.safeParse(
          await createShopAuthorizationRead([connection], transport)(id, signal),
        );
        if (!authorized.success) throw new SourceReadError('invalid-source');
        const matches = authorized.data.data.shops.filter((s) => s.id === p.shopId);
        if (matches.length !== 1 || matches[0].cipher !== pinned.shopCipher)
          throw new SourceReadError('access');
        if (matches[0].region !== 'TH') throw new SourceReadError('invalid-source');
        const plan = videoDailySchedule(p.timezone, (deps.now ?? Date.now)(), { historyDays: 1 });
        const period = plan.windows[0].period;
        const result = VideoPage.safeParse(
          await createShopVideoTransport([connection], transport)(
            {
              connectionId: id,
              path: SHOP_VIDEO_PATH,
              query: {
                start_date_ge: period.from,
                end_date_lt: period.toExclusive,
                page_size: '100',
                sort_field: 'gmv',
                sort_order: 'DESC',
                currency: 'LOCAL',
                account_type: 'ALL',
              },
            },
            signal,
          ),
        );
        if (!result.success) throw new SourceReadError('invalid-source');
        const data = result.data.data;
        if (
          data.latest_available_date >= plan.toExclusive ||
          data.total_count < data.videos.length ||
          new Set(data.videos.map((v) => v.id)).size !== data.videos.length ||
          data.videos.some((v) => v.gmv && v.gmv.currency !== p.currency)
        )
          throw new SourceReadError('invalid-source');
        signal.throwIfAborted();
        return VerifiedShopVideo.parse({
          schemaVersion: 1,
          capability: 'tiktok.shop_video',
          connectionId: id,
          namespace: p.namespace,
          accountId: p.shopId,
          acquisitionOwner: p.acquisitionOwner,
          sourceConnectionRef: p.sourceConnectionRef,
          configurationDigest: digest(p),
          currency: p.currency,
          timezone: p.timezone,
          marketPolicy: 'TH-v1',
          apiVersion: '202605',
          checkedAt: new Date((deps.now ?? Date.now)()).toISOString(),
          authorizationRequestId: authorized.data.request_id,
          analyticsRequestId: result.data.request_id,
          probePeriod: period,
          latestAvailableDate: data.latest_available_date,
          reportReady: data.latest_available_date >= period.from,
        });
      } catch (error) {
        if (parent.aborted) throw new DOMException('Aborted', 'AbortError');
        if (error instanceof SourceReadError) throw error;
        throw new SourceReadError('temporary');
      }
    },
  };
}
