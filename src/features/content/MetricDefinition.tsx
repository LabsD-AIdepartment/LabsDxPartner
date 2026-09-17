import type { z } from 'zod';
import type { Metric } from '@/contracts/content';
import {
  PlatformMetricV2,
  formatExactDecimal,
  type PlatformMetricValue,
} from '@/contracts/platform-metrics';
import type { SourceReportV2 } from '@/contracts/platform-metrics';
import { Text } from '@/shared/ui/Text';
import styles from './content.module.css';
import { isCelebSafeMetricKey } from '@/contracts/celeb-safe-metrics';
const labels: Record<string, string> = {
  eligible_orders: 'ออเดอร์เข้าเงื่อนไข',
  eligible_sales: 'ยอดขายที่สร้างคอมมิชชัน',
  impressions: 'ครั้งที่แสดง',
  link_clicks: 'คลิกลิงก์',
  video_views: 'ยอดดูวิดีโอ',
  reach: 'ผู้ชมไม่ซ้ำ',
  platform_orders: 'ออเดอร์ตามแพลตฟอร์ม',
  platform_value: 'มูลค่าตามแพลตฟอร์ม',
  spend: 'ค่าโฆษณา',
  roas: 'ROAS',
  cpc: 'CPC',
  ctr: 'CTR',
  purchase_conversion_rate: 'อัตราปิดการขาย',
  cpm: 'CPM',
  cost_per_purchase: 'ต้นทุนต่อการซื้อ',
};
export const metricRatioSuffix = (key: string) =>
  key === 'ctr' || key === 'purchase_conversion_rate' ? '%' : '×';
export function MetricDefinition({ metric: m }: { metric: z.infer<typeof Metric> }) {
  const value =
    m.value === null
      ? '—'
      : new Intl.NumberFormat('th-TH', {
          maximumFractionDigits: m.unit === 'count' ? 0 : 2,
          minimumFractionDigits: m.unit === 'THB' ? 2 : 0,
        }).format(m.value);
  return (
    <MetricCard
      metric={m}
      value={value}
      prefix={m.unit === 'THB' ? '฿' : ''}
      suffix={m.unit === 'ratio' ? metricRatioSuffix(m.key) : ''}
    />
  );
}

/** V2 presentation uses exact strings; never downcast into the V1 number DTO. */
export function PlatformMetricDefinition({
  metric,
  report,
}: {
  metric: PlatformMetricValue;
  report: Pick<z.infer<typeof SourceReportV2>, 'period' | 'dataThrough' | 'reportDefinition'>;
}) {
  const m = PlatformMetricV2.parse(metric);
  return (
    <MetricCard
      metric={{
        ...m,
        source: report.reportDefinition,
        period: report.period,
        dataThrough: report.dataThrough,
        additive: m.aggregation === 'sum-disjoint',
      }}
      value={m.value === null ? '—' : formatExactDecimal(m.value, m.unit === 'count' ? 0 : 2)}
      prefix={m.unit === 'money' ? (m.currency === 'THB' ? '฿' : m.currency + ' ') : ''}
      suffix={m.unit === 'ratio' ? metricRatioSuffix(m.key) : ''}
    />
  );
}

function MetricCard({
  metric: m,
  value,
  prefix,
  suffix,
}: {
  metric: {
    key: z.infer<typeof Metric>['key'];
    value: string | number | null;
    definition: string;
    source: string;
    period: { from: string; toExclusive: string };
    dataThrough: string | null;
    unavailableReason: string | null;
    additive: boolean;
  };
  value: string;
  prefix: string;
  suffix: string;
}) {
  return (
    <article className={styles.metric}>
      <h3>{labels[m.key]}</h3>
      <strong>
        {m.value !== null ? prefix : ''}
        {value}
        {m.value !== null ? suffix : ''}
      </strong>
      {m.value === null && <p>{m.unavailableReason}</p>}
    </article>
  );
}
export function MetricSections({
  metrics,
  canViewAdSpend,
  showEmpty = true,
}: {
  metrics: z.infer<typeof Metric>[];
  canViewAdSpend: boolean;
  showEmpty?: boolean;
}) {
  const visible = metrics.filter((x) =>
    isCelebSafeMetricKey(x.key, { canViewSpend: canViewAdSpend }),
  );
  const response = visible.filter((x) => !['platform_orders', 'platform_value'].includes(x.key));
  const conversions = visible.filter((x) => ['platform_orders', 'platform_value'].includes(x.key));
  return (
    <>
      {showEmpty && !visible.length && (
        <Text variant="caption" tone="muted" className={styles.meta}>
          ยังไม่มีข้อมูลประสิทธิภาพจากต้นทาง
        </Text>
      )}
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
