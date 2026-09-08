import { BadgeCheck, Wallet } from 'lucide-react';
import type { OverviewValue } from '@/contracts/overview';
import type { FilterValue } from '@/shared/ui/FilterBar';
import { Card } from '@/shared/ui/Card';
import { Money } from '@/shared/ui/Money';
import { CoverImage } from '@/shared/ui/CoverImage';
import { LinkButton } from '@/shared/ui/LinkButton';
import { earningsHref } from './model';
import styles from './overview.module.css';
export type PartnerPresentation = {
  name: string;
  greeting: string;
  role: string;
  portrait: string | null;
  avatar: string | null;
};
export function EarningsSummary({
  data,
  filters,
  partner,
}: {
  data: OverviewValue;
  filters: FilterValue;
  partner?: PartnerPresentation;
}) {
  const channels = data.earnings.channelBreakdown;
  return (
    <Card className={styles.earnings} aria-label="โปรไฟล์และคอมมิชชัน">
      <div className={styles.portrait}>
        <CoverImage
          src={partner?.portrait ?? null}
          alt={partner ? `ภาพโปรไฟล์ ${partner.name}` : 'ภาพโปรไฟล์พาร์ทเนอร์'}
          loading="eager"
        />
        <div className={styles.identity}>
          <CoverImage src={partner?.avatar ?? null} alt="" />
          <div>
            <strong>{partner?.name ?? 'พาร์ทเนอร์'}</strong>
            <span>{partner?.role ?? 'Partner'}</span>
          </div>
          <BadgeCheck size={19} aria-hidden />
        </div>
      </div>
      <div className={styles.earningPane}>
        <div className={styles.cardLabel}>
          <h2>คอมมิชชันของฉัน</h2>
          <Wallet size={17} aria-hidden />
        </div>
        <p className="small muted">Total commission · ยืนยันแล้วในช่วงที่เลือก</p>
        <Money value={data.earnings.confirmed} className={styles.heroMoney} />
        <div className={styles.breakdown}>
          <div>
            <span>
              <i className={styles.organicDot} />
              Organic
            </span>
            <Money value={channels?.organic ?? null} reason="ยังไม่มีข้อมูลแยกช่องทาง" />
            <small className="muted">
              {channels?.organicRatePpm != null
                ? `${channels.organicRatePpm / 10000}% commission`
                : 'อัตราตามข้อตกลง'}
            </small>
          </div>
          <div>
            <span>
              <i className={styles.adsDot} />
              Brand ads
            </span>
            <Money value={channels?.brandAds ?? null} reason="ยังไม่มีข้อมูลแยกช่องทาง" />
            <small className="muted">
              {channels?.brandAdsRatePpm != null
                ? `${channels.brandAdsRatePpm / 10000}% commission`
                : 'อัตราตามข้อตกลง'}
            </small>
          </div>
        </div>
        {channels && channels.other.minor !== '0' && (
          <p className="small muted">
            รายได้ประเภทอื่น <Money value={channels.other} />
          </p>
        )}
        <div className={styles.estimate}>
          <span>ประมาณการ · ยังไม่ยืนยัน</span>
          <Money value={data.earnings.estimated} />
          <p className="small muted">ยอดประมาณการอาจเปลี่ยนหลังตรวจสอบ ไม่ใช่ยอดพร้อมจ่าย</p>
        </div>
        <LinkButton href={earningsHref('/content', data, filters)}>ดูที่มาของรายได้ ↗</LinkButton>
        <p className="small muted">ยอดยืนยันอาจรวมรายการปรับปรุงหรือคืนสินค้า</p>
      </div>
    </Card>
  );
}
