'use client';
import { MetricValueList } from '@/shared/ui/MetricValueList';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { ShopVideoPerformance } from '@/contracts/shop-video';
import { formatExactDecimal, formatExactPercentage } from '@/contracts/platform-metrics';
import { partnerKey, type QueryScope } from '@/shared/query/keys';
import { changeMeta } from '@/shared/query/invalidate-changes';
import { Text } from '@/shared/ui/Text';
import { TextGroup } from '@/shared/ui/TextGroup';
import { DataState } from '@/shared/ui/DataState';
import { dateLabel, timestamp } from '@/shared/ui/format-date';
import { loadShopVideos, type VideoReadTransport } from './transport';
import forms from '@/shared/ui/forms.module.css';
type Values = Pick<
  z.infer<typeof ShopVideoPerformance>,
  'paidSkuOrders' | 'itemsSold' | 'gmv' | 'productClickThroughRate'
>;
// Shared labels and exact formatters for totals and every source period.
function VideoValues({ value: v }: { value: Values }) {
  const count = (n: string | null) => (n === null ? '—' : formatExactDecimal(n, 0));
  return (
    <MetricValueList>
      <div>
        <dt>ออเดอร์สินค้า (SKU) ที่ชำระแล้ว</dt>
        <dd>{count(v.paidSkuOrders)}</dd>
      </div>
      <div>
        <dt>จำนวนชิ้นที่ขาย</dt>
        <dd>{count(v.itemsSold)}</dd>
      </div>
      <div>
        <dt>GMV ที่ TikTok รายงาน</dt>
        <dd>{v.gmv ? `${formatExactDecimal(v.gmv.amount, 2)} ${v.gmv.currency}` : '—'}</dd>
      </div>
      <div>
        <dt>อัตราคลิกสินค้า</dt>
        <dd>
          {v.productClickThroughRate === null
            ? '—'
            : formatExactPercentage(v.productClickThroughRate)}
        </dd>
      </div>
    </MetricValueList>
  );
}
export function ShopVideoPerformanceView({
  performance: p,
}: {
  performance: z.infer<typeof ShopVideoPerformance>;
}) {
  return (
    <section className={forms.stack}>
      <Text as="h3">TikTok Shop Video</Text>
      {p.state !== 'ready' && (
        <DataState
          state={p.state}
          message={
            p.state === 'partial'
              ? 'ข้อมูลยังไม่ครบช่วงที่เลือก จึงยังไม่รวมยอดทั้งหมด'
              : p.state === 'stale'
                ? 'แสดงรายงานล่าสุดที่มี การอัปเดตยังไม่สำเร็จ'
                : 'ยังไม่มีรายงานในช่วงที่เลือก'
          }
        />
      )}
      <VideoValues value={p} />
      <Text tone="muted">ผลลัพธ์ตามการนับของ TikTok ไม่ใช่คอมมิชชันหรือยอดพร้อมจ่าย</Text>
      <details>
        <summary>ช่วงข้อมูลและวิธีนับ</summary>
        <TextGroup>
          <Text tone="muted">
            ข้อมูลถึง {p.latestAvailableDate ? dateLabel(p.latestAvailableDate) : '—'} ·{' '}
            {p.timezone ?? 'ยังไม่ระบุเขตเวลา'}
          </Text>
          <Text tone="muted">นำเข้าล่าสุด {timestamp(p.fetchedAt)}</Text>
          <Text>
            ออเดอร์ SKU อาจต่างจากจำนวนคำสั่งซื้อ อัตราคลิกไม่รวมข้ามช่วงรายงาน และ —
            หมายถึงยังไม่มีข้อมูลที่ใช้ได้
          </Text>
        </TextGroup>
        {p.series.map((row) => (
          <details key={row.period.from + row.period.toExclusive}>
            <summary>
              {dateLabel(row.period.from)} – ก่อน {dateLabel(row.period.toExclusive)}
            </summary>
            {row.available ? (
              <VideoValues value={row} />
            ) : (
              <Text>ยังไม่มีข้อมูลวิดีโอนี้ในรายงาน</Text>
            )}
          </details>
        ))}
      </details>
    </section>
  );
}
export function ShopVideoPanel({
  scope,
  clipId,
  from,
  toExclusive,
  transport,
}: {
  scope: QueryScope;
  clipId: string;
  from: string;
  toExclusive: string;
  transport: VideoReadTransport;
}) {
  const query = useQuery({
    queryKey: partnerKey(scope, 'metrics', 'shop-videos', { clipId, from, toExclusive }),
    meta: changeMeta('metrics'),
    queryFn: ({ signal }) =>
      loadShopVideos(
        transport,
        {
          partnerId: scope.partnerId,
          permissionRevision: scope.permissionRevision,
          clipId,
          from,
          toExclusive,
        },
        signal,
      ),
    retry: false,
    refetchInterval: 60_000,
  });
  if (query.isPending) return <DataState state="loading" />;
  // Never keep cached source values visible after a permission or scope error.
  if (query.error)
    return (
      <DataState
        state="unavailable"
        message="ข้อมูล TikTok ยังไม่พร้อม หรือสิทธิ์การเข้าถึงเปลี่ยนแล้ว"
      />
    );
  if (!query.data?.items.length)
    return <Text tone="muted">ยังไม่มีรายงาน TikTok Shop Video สำหรับคลิปนี้ในช่วงที่เลือก</Text>;
  return (
    <>
      {query.data?.items.map((item) => (
        <ShopVideoPerformanceView key={item.id} performance={item.performance} />
      ))}
    </>
  );
}
