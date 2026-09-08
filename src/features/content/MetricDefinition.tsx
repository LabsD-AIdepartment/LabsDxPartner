import type { z } from 'zod';
import type { Metric } from '@/contracts/content';
import { timestamp, dateLabel } from '@/shared/ui/format-date';
import styles from './content.module.css';
const labels: Record<z.infer<typeof Metric>['key'], string> = {
  eligible_orders: 'ออเดอร์เข้าเงื่อนไข',
  eligible_sales: 'ยอดขายเข้าเงื่อนไข',
  impressions: 'ครั้งที่แสดง',
  link_clicks: 'คลิกลิงก์',
  video_views: 'ยอดดูวิดีโอ',
  reach: 'ผู้ชมไม่ซ้ำ',
  platform_orders: 'ออเดอร์ตามแพลตฟอร์ม',
  platform_value: 'มูลค่าตามแพลตฟอร์ม',
  spend: 'ค่าโฆษณา',
  roas: 'ROAS',
};
export function MetricDefinition({ metric: m }: { metric: z.infer<typeof Metric> }) {
  const value =
    m.value === null
      ? '—'
      : new Intl.NumberFormat('th-TH', {
          maximumFractionDigits: m.unit === 'count' ? 0 : 2,
          minimumFractionDigits: m.unit === 'THB' ? 2 : 0,
        }).format(m.value);
  return (
    <article className={styles.metric}>
      <h3>{labels[m.key]}</h3>
      <strong>
        {m.value !== null && m.unit === 'THB' ? '฿' : ''}
        {value}
        {m.value !== null && m.unit === 'ratio' ? '×' : ''}
      </strong>
      {m.value === null && <p>{m.unavailableReason}</p>}
      <details>
        <summary>ที่มาและความหมาย</summary>
        <p>{m.definition}</p>
        <p>
          {m.source} · {dateLabel(m.period.from)} – ก่อน {dateLabel(m.period.toExclusive)}
        </p>
        <p>ข้อมูลถึง {timestamp(m.dataThrough)}</p>
        {!m.additive && <p>ห้ามบวกรวมข้ามโฆษณาหรือช่วงเวลา</p>}
      </details>
    </article>
  );
}
export function MetricSections({
  metrics,
  canViewAdSpend,
}: {
  metrics: z.infer<typeof Metric>[];
  canViewAdSpend: boolean;
}) {
  const visible = metrics.filter((x) => canViewAdSpend || !['spend', 'roas'].includes(x.key));
  const response = visible.filter((x) => !['platform_orders', 'platform_value'].includes(x.key));
  const conversions = visible.filter((x) => ['platform_orders', 'platform_value'].includes(x.key));
  return (
    <>
      {!visible.length && <p className={styles.meta}>ยังไม่มีข้อมูลประสิทธิภาพจากต้นทาง</p>}
      <div className={styles.metrics}>
        {response.map((m) => (
          <MetricDefinition key={m.key} metric={m} />
        ))}
      </div>
      {conversions.length > 0 && (
        <section className={styles.platform}>
          <h3>ผลลัพธ์ที่แพลตฟอร์มรายงาน</h3>
          <p>
            ตัวเลขส่วนนี้ใช้ดูผลโฆษณา ไม่ใช่คอมมิชชันหรือยอดพร้อมจ่าย
            และอาจนับต่างจากออเดอร์ที่เข้าเงื่อนไข
          </p>
          <div className={styles.metrics}>
            {conversions.map((m) => (
              <MetricDefinition key={m.key} metric={m} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
