import type { OverviewValue } from '@/contracts/overview';
import type { FilterValue } from '@/shared/ui/FilterBar';
import { Card } from '@/shared/ui/Card';
import { Money } from '@/shared/ui/Money';
import { LinkButton } from '@/shared/ui/LinkButton';
import { earningsHref } from './model';
import styles from './overview.module.css';
export function EarningsSummary({ data, filters }: { data: OverviewValue; filters: FilterValue }) {
  return (
    <Card
      className={styles.earnings}
      title="คอมมิชชันของคุณ"
      description="ตามช่วงวันที่เกิดรายได้ที่เลือก"
    >
      <p className={styles.label}>ยืนยันแล้ว</p>
      <Money className={styles.heroMoney} value={data.earnings.confirmed} />
      <div className={styles.estimate}>
        <span>ประมาณการ · ยังไม่ยืนยัน</span>
        <Money value={data.earnings.estimated} />
      </div>
      <p className="small muted">ยอดประมาณการอาจเปลี่ยนหลังตรวจสอบ ไม่ใช่ยอดพร้อมจ่าย</p>
      <LinkButton href={earningsHref('/content', data, filters)}>ดูที่มาของรายได้ ↗</LinkButton>
      <p className={styles.label}>ยอดยืนยันอาจรวมรายการปรับปรุงหรือคืนสินค้า</p>
    </Card>
  );
}
