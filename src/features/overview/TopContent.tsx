import Link from 'next/link';
import type { OverviewValue } from '@/contracts/overview';
import type { FilterValue } from '@/shared/ui/FilterBar';
import { Card } from '@/shared/ui/Card';
import { Money } from '@/shared/ui/Money';
import { CoverImage } from '@/shared/ui/CoverImage';
import { DataState } from '@/shared/ui/DataState';
import { earningsHref } from './model';
import styles from './overview.module.css';
export function TopContent({ data, filters }: { data: OverviewValue; filters: FilterValue }) {
  return (
    <Card
      title="Small clips Real results"
      description="สูงสุด 3 คลิปตามรายได้ยืนยันในช่วงที่เลือก"
      action={<Link href={earningsHref('/content', data, filters)}>ดูทั้งหมด ↗</Link>}
    >
      {data.earnings.topContent.length ? (
        <div className={styles.clips}>
          {data.earnings.topContent.map((clip) => (
            <Link
              className={styles.clip}
              key={clip.id}
              href={earningsHref('/content/' + encodeURIComponent(clip.id), data, filters)}
            >
              <CoverImage
                className={styles.cover}
                src={clip.removed ? null : clip.cover}
                alt={clip.title}
                style={{ objectPosition: clip.coverPosition }}
              />
              <div>
                <strong>{clip.removed ? 'คลิปถูกนำออกแล้ว' : clip.title}</strong>
                <p>{clip.brand}</p>
              </div>
              <Money value={clip.earned} reason={clip.unavailableReason ?? undefined} />
              <span aria-hidden>↗</span>
            </Link>
          ))}
        </div>
      ) : (
        <DataState state="empty" message="ยังไม่มีคลิปที่จับคู่รายได้ในช่วงนี้" />
      )}
      {data.earnings.unassignedAmount.minor !== '0' && (
        <div className={styles.explanation}>
          <strong>มีรายได้ที่ยังไม่จับคู่กับคลิป</strong>
          <p>
            <Money value={data.earnings.unassignedAmount} /> รวมอยู่ในยอดพาร์ทเนอร์แล้ว
            จึงไม่ต้องบวกเพิ่ม และยอดรายคลิปอาจไม่เท่ากับยอดรวม
          </p>
        </div>
      )}
      {data.earnings.excludedCount > 0 && (
        <p className="small muted">
          {data.earnings.excludedCount} รายการยังไม่ผ่านเงื่อนไขและไม่รวมในยอดนี้
        </p>
      )}
    </Card>
  );
}
