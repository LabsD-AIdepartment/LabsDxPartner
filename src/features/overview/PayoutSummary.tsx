import type { OverviewValue } from '@/contracts/overview';
import { Card } from '@/shared/ui/Card';
import { Money } from '@/shared/ui/Money';
import { LinkButton } from '@/shared/ui/LinkButton';
import { timestamp, dateLabel, obligationHref } from './model';
import styles from './overview.module.css';
export function PayoutSummary({
  data,
  basePath,
  returnTo,
}: {
  data: OverviewValue;
  basePath?: string;
  returnTo?: string;
}) {
  const { obligation } = data;
  const next = obligation.nextPayout;
  return (
    <Card
      className={styles.payout}
      title="Your next payout"
      description="ยอดจากใบสรุปที่เผยแพร่แล้วและการจ่ายเงินจริง"
    >
      <p className={styles.label}>ยืนยันแล้ว ยังไม่จ่าย · ทุกงวด</p>
      <Money className={styles.largeMoney} value={obligation.confirmedUnpaid} />
      {next ? (
        <div className={styles.scheduled}>
          <strong>กำหนดจ่ายถัดไป {dateLabel(next.scheduledAt)}</strong>
          <Money value={next.amount} />
          <p className={styles.label}>
            {next.period
              ? `งวด ${dateLabel(next.period.from)} ถึงก่อน ${dateLabel(next.period.toExclusive)}`
              : 'ยังไม่ระบุงวดจ่าย'}
          </p>
          <LinkButton
            variant="primary"
            href={obligationHref(data, next.statementId, basePath, returnTo)}
          >
            ดูรอบจ่ายนี้ ↗
          </LinkButton>
        </div>
      ) : (
        <p className="muted">
          {obligation.nextPayoutReason ?? (obligation.confirmedUnpaid === null
            ? 'ยังไม่มีข้อมูลสถานะการจ่าย'
            : 'ยังไม่มีกำหนดจ่ายรอบถัดไป')}
        </p>
      )}
      <p className={styles.label}>สถานะการจ่าย ณ {timestamp(obligation.asOf)}</p>
      <p className={styles.label}>
        ยอดนี้ไม่เปลี่ยนตามตัวกรองคอนเทนต์ และไม่ต้องนำไปบวกกับคอมมิชชันด้านซ้าย
      </p>
      <div
        className={styles.payoutTrack}
        data-confirmed={
          obligation.confirmedUnpaid !== null && BigInt(obligation.confirmedUnpaid.minor) > 0n
        }
        aria-hidden
      >
        <i />
        <i />
        <i />
      </div>
      <div className={styles.payoutSteps}>
        <span>บันทึกยอด</span>
        <span>ยืนยันยอด</span>
        <span>โอนเงิน</span>
      </div>
      <a href={obligationHref(data, undefined, basePath, returnTo)}>ดูรายการจ่ายทั้งหมด</a>
    </Card>
  );
}
