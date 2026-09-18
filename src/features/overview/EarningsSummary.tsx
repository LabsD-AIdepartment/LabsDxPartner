'use client';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';
import { ActionArrow } from '@/shared/ui/ActionArrow';
import { Wallet } from 'lucide-react';
import type { OverviewValue } from '@/contracts/overview';
import type { FilterValue } from '@/shared/ui/FilterBar';
import { Card } from '@/shared/ui/Card';
import { Money } from '@/shared/ui/Money';
import { PartnerIdentity } from './PartnerIdentity';
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
  contentBasePath = '/content',
}: {
  data: OverviewValue;
  filters: FilterValue;
  partner?: PartnerPresentation;
  contentBasePath?: string;
}) {
  const { showConnectedAdNotices = true } = useApplicationPresentation();
  const channels = data.earnings.channelBreakdown;
  return (
    <Card className={styles.earnings} aria-label="โปรไฟล์และคอมมิชชัน">
      <PartnerIdentity partner={partner} />
      <div className={styles.earningPane}>
        <div className={styles.earningsTotal}>
          <div className={styles.cardLabel}>
            <h2>คอมมิชชันของฉัน</h2>
            <Wallet size={17} aria-hidden />
          </div>
          <p className="small muted">แสดงยอดตามช่วงเวลาที่เลือก</p>
          <Money value={data.earnings.confirmed} className={styles.heroMoney} />
        </div>
        <div className={styles.breakdown}>
          <div>
            <span>
              <i className={styles.organicDot} />
              Organic
            </span>
            <Money value={channels?.organic ?? null} reason="ยังไม่มีข้อมูลแยกช่องทาง" />
            <small className="muted">
              {channels?.organicRatePpm != null
                ? `อัตรา ${channels.organicRatePpm / 10000}%`
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
                ? `อัตรา ${channels.brandAdsRatePpm / 10000}%`
                : 'อัตราตามข้อตกลง'}
            </small>
          </div>
        </div>
        {channels && channels.other.minor !== '0' && (
          <p className={styles.otherIncome}>
            <span>รายได้ประเภทอื่น</span> <Money value={channels.other} />
          </p>
        )}
        {(data.earnings.estimated === null || data.earnings.estimated.minor !== '0') && (
          <div className={styles.estimate}>
            <span>คอมมิชชันรอยืนยัน</span>
            <Money value={data.earnings.estimated} />
            <p className="small muted">
              {data.earnings.estimated === null
                ? 'ยังไม่มีข้อมูลยอดประมาณการ'
                : 'ยอดนี้ยังถอนไม่ได้'}
            </p>
          </div>
        )}
        {!!data.earnings.connectedAdEarnings?.length && (
          <div className={styles.estimate}>
            <span>ค่าคอมจากโฆษณาที่เชื่อมต่อ · รวมในยอดรอยืนยัน</span>
            {data.earnings.connectedAdEarnings.map((entry) => (
              <p key={entry.clipId} className="small">
                {entry.title} · <Money value={entry.amount} reason={entry.reason ?? undefined} />
                {entry.ratePpm !== null && ` (${entry.ratePpm / 10000}%)`}
                {showConnectedAdNotices && entry.reason && (
                  <small className="muted" role="status">
                    <br />
                    {entry.reason}
                  </small>
                )}
              </p>
            ))}
          </div>
        )}
        <div className={styles.earningsFooter}>
          <LinkButton href={earningsHref(contentBasePath, data, filters)}>
            ดูรายละเอียดของรายได้ <ActionArrow />
          </LinkButton>
        </div>
      </div>
    </Card>
  );
}
