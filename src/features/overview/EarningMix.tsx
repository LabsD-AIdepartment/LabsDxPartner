import { Sparkles } from 'lucide-react';
import type { OverviewValue } from '@/contracts/overview';
import { Card } from '@/shared/ui/Card';
import { DonutChart } from '@/shared/charts/DonutChart';
import styles from './overview.module.css';
export function EarningMix({ data }: { data: OverviewValue }) {
  const split = data.earnings.channelBreakdown;
  const comparable =
    split &&
    split.other.minor === '0' &&
    BigInt(split.organic.minor) >= 0n &&
    BigInt(split.brandAds.minor) >= 0n;
  return (
    <Card
      title="Your earning mix"
      className={styles.mixCard}
      action={<Sparkles size={18} aria-hidden />}
    >
      {comparable && data.earnings.confirmed ? (
        <DonutChart primary={split.organic.minor} total={data.earnings.confirmed.minor} />
      ) : (
        <>
          <div className={styles.unknownMix}>
            <div className={styles.unknownRing} aria-label="ยังไม่มีสัดส่วนรายได้">
              —
            </div>
            <p>
              Made by you
              <br />
              Earned by you
            </p>
          </div>
          <p className="small muted">
            {split
              ? 'มีรายการปรับปรุงหรือรายได้ประเภทอื่น ดูรายละเอียดที่มาของรายได้'
              : 'ยังไม่มีข้อมูลสัดส่วน Organic และ Brand ads'}
          </p>
        </>
      )}
    </Card>
  );
}
