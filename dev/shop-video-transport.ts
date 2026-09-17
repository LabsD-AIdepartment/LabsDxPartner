import { PartnerShopVideos, ShopVideoReceipt } from '@/contracts/shop-video';
import type { ConnectionTransport } from '@/features/marketing-ads/ConnectionsPanel';
import type {
  VideoReadTransport,
  VideoRegistrationTransport,
} from '@/features/shop-video/transport';
/** Synthetic data stays exclusively in the development entry points. */
export const previewVideoRead: VideoReadTransport = async (q, signal) => {
  signal.throwIfAborted();
  const days = (Date.parse(q.toExclusive) - Date.parse(q.from)) / 86400000;
  const mid = new Date(Date.parse(q.from) + Math.max(1, Math.floor(days / 2)) * 86400000)
    .toISOString()
    .slice(0, 10);
  const values = {
    views: '24000',
    paidSkuOrders: '18',
    itemsSold: '22',
    gmv: { amount: '21500.50', currency: 'THB' },
    productClickThroughRate: '0.045',
  };
  const periods =
    days > 1
      ? [
          { from: q.from, toExclusive: mid },
          { from: mid, toExclusive: q.toExclusive },
        ]
      : [{ from: q.from, toExclusive: q.toExclusive }];
  return PartnerShopVideos.parse({
    schemaVersion: 1,
    partnerId: q.partnerId,
    permissionRevision: q.permissionRevision,
    clipId: q.clipId,
    period: { from: q.from, toExclusive: q.toExclusive },
    metricsRevision: '1',
    items: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        source: 'TikTok Shop Video',
        performance: {
          ...values,
          views: days > 1 ? '48000' : '24000',
          paidSkuOrders: days > 1 ? '36' : '18',
          itemsSold: days > 1 ? '44' : '22',
          gmv: { amount: days > 1 ? '43001.00' : '21500.50', currency: 'THB' },
          productClickThroughRate: days > 1 ? null : '0.045',
          state: 'ready',
          timezone: 'Asia/Bangkok',
          fetchedAt: '2026-09-10T01:00:00Z',
          latestAvailableDate: '2026-09-09',
          series: periods.map((period) => ({ ...values, period, available: true })),
        },
      },
    ],
  });
};
export function createPreviewVideoRegistration(): VideoRegistrationTransport & {
  connectionTransport: ConnectionTransport;
} {
  let enabled = true,
    revision = 1;
  const results = new Map<string, unknown>();
  return {
    connectionTransport: {
      read: async (scope, signal) => {
        signal.throwIfAborted();
        return {
          ...scope,
          connections: [
            {
              id: 'video-shop',
              label: 'Labs D · ร้านค้าตัวอย่าง',
              platform: 'tiktok',
              accountId: 'preview-shop',
              revision: String(revision),
              enabled,
              configured: true,
              verifiedAt: '2026-09-10T05:00:00Z',
              jobs: 7,
              attention: 0,
              lastSuccessAt: '2026-09-10T05:00:00Z',
            },
          ],
        };
      },
      command: async (command, signal) => {
        signal.throwIfAborted();
        if (results.has(command.idempotencyKey)) return results.get(command.idempotencyKey);
        if (command.connectionId !== 'video-shop' || command.revision !== String(revision))
          throw new Error('ข้อมูลเปลี่ยน กรุณาลองอีกครั้ง');
        if (command.action !== 'retry') {
          enabled = command.action === 'verify';
          revision++;
        }
        const result = {
          connectionId: 'video-shop',
          revision: String(revision),
          enabled,
          replayed: false,
        };
        results.set(command.idempotencyKey, result);
        return result;
      },
    },
    options: async (scope) => ({
      ...scope,
      q: (scope.q ?? '').trim(),
      hasMore: false,
      targets: [
        {
          id: 'video-target',
          partnerId: 'preview-partner',
          clipId: 'clip-3',
          label: 'มดดำ · ลองให้ดูแบบไม่สปอนเซอร์ · ดีลตัวอย่าง',
        },
      ].filter((target) =>
        target.label.toLowerCase().includes((scope.q ?? '').trim().toLowerCase()),
      ),
      connections: [{ id: 'video-shop', label: 'Labs D · ร้านค้าตัวอย่าง', available: enabled }],
    }),
    lookup: async (q) =>
      ShopVideoReceipt.parse({
        ...q,
        generationId: '22222222-2222-4222-8222-222222222222',
        creatorId: 'sample-creator',
        targetRevision: '1',
        connectionRevision: '1',
        title: 'ลองให้ดูแบบไม่สปอนเซอร์ ถ้าไม่ดีก็ไม่พูด',
        creatorName: 'มดดำ (ตัวอย่าง)',
      }),
    save: async (q) => ({
      mappingId: q.idempotencyKey,
      partnerId: 'preview-partner',
      clipId: 'clip-3',
      videoId: q.videoId,
      replayed: false,
    }),
  };
}
