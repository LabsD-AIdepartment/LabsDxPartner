import { z } from 'zod';
import { Id, Instant } from '@/contracts/common';
import { ExternalId } from '@/contracts/platform-capabilities';
import { ExactDecimal, ExactCount, SourcePeriod } from '@/contracts/platform-metrics';

/** Server-only acquisition contract. Shop video performance is not a paid-ad report. */
export const ShopVideoConnection = z.strictObject({
  connectionId: Id,
  namespace: Id,
  shopId: ExternalId,
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: SourcePeriod.shape.timezone,
});
export type VideoConnection = z.infer<typeof ShopVideoConnection>;
export const ShopVideoPeriod = z.strictObject({
  from: z.iso.date(),
  toExclusive: z.iso.date(),
});
export type VideoPeriod = z.infer<typeof ShopVideoPeriod>;

// The API documents JSON integer counts. Reject unsafe numbers; String() cannot recover lost bits.
const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Money = z.object({ amount: ExactDecimal, currency: z.string().regex(/^[A-Z]{3}$/) });
const Ratio = ExactDecimal.refine((value) => /^(0(?:\.\d+)?|1(?:\.0+)?)$/.test(value));
export const VideoRow = z.object({
  id: ExternalId,
  title: z.string().max(2000),
  creator: z.object({
    open_id: ExternalId,
    user_name: z.string().max(500),
    nick_name: z.string().max(500),
    author_type: z.enum(['OFFICIAL', 'CHANNEL', 'AFFILIATE']),
  }),
  views: Count.nullish(),
  sku_orders: Count.nullish(),
  items_sold: Count.nullish(),
  gmv: Money.nullish(),
  click_through_rate: Ratio.nullish(),
});
export const VideoPage = z.object({
  code: z.literal(0),
  request_id: z.string().min(1).max(200),
  data: z.object({
    videos: z.array(VideoRow).max(100),
    total_count: Count,
    latest_available_date: z.iso.date(),
    next_page_token: z.string().max(2000).optional(),
  }),
});
export type VideoObservation = {
  videoId: string;
  title: string;
  creator: {
    openId: string;
    username: string;
    nickname: string;
    authorType: 'OFFICIAL' | 'CHANNEL' | 'AFFILIATE';
  };
  // Exact source values. Null is unavailable; zero is a reported zero.
  views: string | null;
  paidSkuOrders: string | null;
  itemsSold: string | null;
  gmv: { amount: string; currency: string } | null;
  productClickThroughRate: string | null;
};
type CollectionBase = {
  schemaVersion: 1;
  capability: 'tiktok.shop_video';
  apiVersion: '202605';
  grain: 'shop-video-period';
  connection: VideoConnection;
  period: VideoPeriod;
  fetchedAt: string;
  latestAvailableDate: string;
  sourceRequestIds: string[];
  reportDefinition: 'tiktok.shop-video.202605.local.all.v1';
};
export type VideoCollection = CollectionBase &
  (
    | { completeness: 'complete'; reason: null; videos: VideoObservation[] }
    | { completeness: 'partial'; reason: 'source-not-ready' | 'page-limit'; videos: [] }
  );

/** Validate normalized evidence again at the durable publication boundary. */
export const VideoObservationSchema = z.strictObject({
  videoId: ExternalId,
  title: z.string().max(2000),
  creator: z.strictObject({
    openId: ExternalId,
    username: z.string().max(500),
    nickname: z.string().max(500),
    authorType: z.enum(['OFFICIAL', 'CHANNEL', 'AFFILIATE']),
  }),
  views: ExactCount.nullable(),
  paidSkuOrders: ExactCount.nullable(),
  itemsSold: ExactCount.nullable(),
  gmv: Money.nullable(),
  productClickThroughRate: Ratio.nullable(),
});
export const CompleteVideoCollection = z
  .strictObject({
    schemaVersion: z.literal(1),
    capability: z.literal('tiktok.shop_video'),
    apiVersion: z.literal('202605'),
    grain: z.literal('shop-video-period'),
    connection: ShopVideoConnection,
    period: ShopVideoPeriod,
    fetchedAt: Instant,
    latestAvailableDate: z.iso.date(),
    sourceRequestIds: z.array(z.string().min(1).max(200)).min(1).max(20),
    reportDefinition: z.literal('tiktok.shop-video.202605.local.all.v1'),
    completeness: z.literal('complete'),
    reason: z.null(),
    videos: z.array(VideoObservationSchema).max(2000),
  })
  .superRefine((v, ctx) => {
    const fail = () => ctx.addIssue({ code: 'custom', message: 'Invalid complete video evidence' });
    const days = (Date.parse(v.period.toExclusive) - Date.parse(v.period.from)) / 86_400_000;
    if (!Number.isFinite(days) || days < 1 || days > 31) {
      fail();
      return;
    }
    const lastDay = new Date(Date.parse(v.period.toExclusive) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (
      days < 1 ||
      days > 31 ||
      v.latestAvailableDate < lastDay ||
      new Set(v.videos.map((x) => x.videoId)).size !== v.videos.length
    )
      fail();
    if (v.videos.some((x) => x.gmv !== null && x.gmv.currency !== v.connection.currency)) fail();
  });
