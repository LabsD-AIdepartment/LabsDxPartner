import { PartnerAdPerformance } from '@/contracts/partner-ad-performance';
import type { z } from 'zod';
import type { Period } from '@/contracts/common';
/** Explicit preview observations, never used by the native provider/read model. */
export function performanceFixture(period: z.infer<typeof Period>) {
  const mid = new Date(
    (Date.parse(period.from) + Date.parse(period.toExclusive)) / 2,
  ).toISOString();
  const metric = (
    key: 'impressions' | 'link_clicks' | 'video_views' | 'platform_orders',
    value: string,
  ) => ({
    schemaVersion: 2 as const,
    key,
    value,
    unit: 'count' as const,
    currency: null,
    definition: {
      impressions: 'จำนวนครั้งที่แสดง',
      link_clicks: 'การคลิกลิงก์',
      video_views: 'การดูวิดีโอตามนิยามต้นทาง',
      platform_orders: 'คำสั่งซื้อที่แพลตฟอร์มให้เครดิตแก่โฆษณา',
    }[key],
    unavailableReason: null,
    aggregation: 'sum-disjoint' as const,
  });
  const metrics = [
    metric('impressions', '120000'),
    metric('link_clicks', '2400'),
    metric('video_views', '42000'),
    metric('platform_orders', '120'),
  ];
  return PartnerAdPerformance.parse({
    schemaVersion: 2,
    source: 'Facebook · ข้อมูลจำลอง',
    definition: {
      apiVersion: 'v25.0',
      attribution: '7d_click+1d_view',
      actionReportTime: 'impression',
      reportTimezone: 'Asia/Bangkok',
    },
    period,
    coverage: { status: 'complete', periods: [period] },
    fetchedAt: '2026-09-10T00:00:00Z',
    dataThrough: null,
    state: 'ready',
    reasons: [],
    metrics,
    series: [
      {
        period: { ...period, toExclusive: mid },
        metrics: [
          metric('impressions', '50000'),
          metric('link_clicks', '1000'),
          metric('video_views', '18000'),
          metric('platform_orders', '50'),
        ],
      },
      {
        period: { ...period, from: mid },
        metrics: [
          metric('impressions', '70000'),
          metric('link_clicks', '1400'),
          metric('video_views', '24000'),
          metric('platform_orders', '70'),
        ],
      },
    ],
  });
}
