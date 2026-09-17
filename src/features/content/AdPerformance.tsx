import type { z } from 'zod';
import type { PartnerAdPerformance } from '@/contracts/partner-ad-performance';
import { PlatformMetricDefinition } from './MetricDefinition';
import { isCelebSafeMetricKey } from '@/contracts/celeb-safe-metrics';
import { Text } from '@/shared/ui/Text';
import { DataState } from '@/shared/ui/DataState';
import { timestamp } from '@/shared/ui/format-date';
import styles from './content.module.css';

function attributionSentence(value: string) {
  const window = /^(\d+)d_click(?:\+(\d+)d_view)?$/.exec(value);
  if (!window) return 'แพลตฟอร์มเป็นผู้กำหนดช่วงเวลาที่ใช้เชื่อมยอดซื้อกับโฆษณา';
  return `แพลตฟอร์มนับยอดซื้อที่เกิดขึ้นภายใน ${window[1]} วันหลังคลิก${window[2] ? ` หรือ ${window[2]} วันหลังเห็นโฆษณา` : ''} เป็นผลลัพธ์ของโฆษณานี้`;
}

export function AdPerformance({
  performance: p,
  canViewAdSpend,
}: {
  performance: z.infer<typeof PartnerAdPerformance>;
  canViewAdSpend: boolean;
}) {
  const visible = (key: string) => isCelebSafeMetricKey(key, { canViewSpend: canViewAdSpend });
  const metrics = p.metrics
    .filter((m) => visible(m.key))
    .map((m) =>
      m.unavailableReason === 'ข้อมูลยังไม่ครบช่วงวันที่เลือก ดูช่วงที่มีข้อมูลด้านล่าง'
        ? { ...m, unavailableReason: 'ข้อมูลยังไม่ครบช่วงวันที่เลือก' }
        : m,
    );
  const definition = { period: p.period, dataThrough: p.dataThrough, reportDefinition: p.source };
  const conversions = new Set(['platform_orders', 'platform_value']);
  return (
    <section className={styles.performance} aria-label="ผลโฆษณาที่ใช้คลิปนี้">
      <Text variant="caption" tone="muted">
        {p.source}
      </Text>
      <Text variant="caption" tone="muted">
        อัปเดต {p.fetchedAt ? <time dateTime={p.fetchedAt}>{timestamp(p.fetchedAt)}</time> : '—'}
        {p.state === 'stale' && ' · ข้อมูลล่าสุดที่บันทึกไว้'}
        {p.state === 'partial' && ' · ข้อมูลบางส่วน'}
        {p.intraday && ' · ข้อมูลระหว่างวัน ยอดยังเปลี่ยนแปลงได้'}
      </Text>
      {p.state === 'unavailable' ? (
        <DataState state="unavailable" message={p.reasons.join(' · ') || 'ยังไม่มีข้อมูลผลโฆษณา'} />
      ) : !metrics.length ? (
        <Text variant="caption" tone="muted">
          ยังไม่มีข้อมูลประสิทธิภาพจากต้นทาง
        </Text>
      ) : null}
      {!!metrics.filter((m) => !conversions.has(m.key)).length && (
        <div className={styles.metrics}>
          {metrics
            .filter((m) => !conversions.has(m.key))
            .map((m) => (
              <PlatformMetricDefinition key={m.key} metric={m} report={definition} />
            ))}
        </div>
      )}
      {metrics.some((m) => conversions.has(m.key)) && (
        <section className={styles.platform}>
          <h3>ผลลัพธ์ที่แพลตฟอร์มรายงาน</h3>
          <Text variant="caption" tone="muted">
            ยอดขายตามแพลตฟอร์ม แยกจากฐานคอมมิชชัน
          </Text>
          <div className={styles.metrics}>
            {metrics
              .filter((m) => conversions.has(m.key))
              .map((m) => (
                <PlatformMetricDefinition key={m.key} metric={m} report={definition} />
              ))}
          </div>
        </section>
      )}
      {(p.definition || p.dataThrough || p.automaticRefreshFrom) && (
        <details className={styles.performanceDefinition}>
          <summary>วิธีนับผลลัพธ์ของแพลตฟอร์ม</summary>
          {p.definition && (
            <>
              <Text variant="caption">{attributionSentence(p.definition.attribution)}</Text>
              <Text variant="caption">
                {p.definition.actionReportTime === 'impression'
                  ? 'ยอดซื้อจะรวมไว้ในวันที่แสดงโฆษณา ไม่ใช่วันที่ชำระเงิน'
                  : p.definition.actionReportTime === 'conversion'
                    ? 'ยอดซื้อจะรวมไว้ในวันที่เกิดการซื้อ'
                    : 'วันที่รายงานผลลัพธ์เป็นไปตามวิธีนับของแพลตฟอร์ม'}
                {p.definition.reportTimezone === 'Asia/Bangkok'
                  ? ' โดยใช้เวลาประเทศไทย'
                  : ` โดยใช้เขตเวลา ${p.definition.reportTimezone}`}
              </Text>
            </>
          )}
          {metrics.some((m) => m.key === 'purchase_conversion_rate') && (
            <Text variant="caption">
              อัตราปิดการขายคือจำนวนออเดอร์จากโฆษณาหารด้วยจำนวนคลิกลิงก์ แล้วคูณ 100 เป็นเปอร์เซ็นต์
              ยอดซื้อที่แพลตฟอร์มนับอาจต่างจากยอดขายที่เข้าเงื่อนไขคอมมิชชัน
            </Text>
          )}
          {p.dataThrough && <Text variant="caption">ข้อมูลถึง {timestamp(p.dataThrough)}</Text>}
        </details>
      )}
    </section>
  );
}
