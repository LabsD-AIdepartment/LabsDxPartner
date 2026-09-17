import type { WithdrawalQuoteValue, WithdrawalRequestValue } from '@/contracts/withdrawal-journey';
import { Money } from '@/shared/ui/Money';
import { timestamp } from '@/shared/ui/format-date';
import { PayoutBeneficiarySummary } from './PayoutBeneficiarySummary';
import styles from './withdrawals.module.css';

type Quoted = Extract<WithdrawalQuoteValue, { state: 'quoted' }>;

export function WithdrawalAmountDetails({
  value,
  showNet = true,
}: {
  showNet?: boolean;
  value: Pick<Quoted, 'gross' | 'deductions' | 'net'>;
}) {
  return (
    <dl className={styles.sheetAmounts}>
      <div>
        <dt>ยอดที่ขอถอนก่อนหักรายการต่าง ๆ</dt>
        <dd>
          <Money value={value.gross} omitZeroFraction={false} />
        </dd>
      </div>
      {value.deductions.map((deduction, index) => (
        <div key={index}>
          <dt>{deduction.label}</dt>
          <dd>
            <Money value={deduction.amount} omitZeroFraction={false} />
          </dd>
        </div>
      ))}
      {value.deductions.length === 0 && (
        <div>
          <dt>รายการหัก</dt>
          <dd>ไม่มีรายการหักในยอดนี้</dd>
        </div>
      )}
      {showNet && (
        <div className={styles.sheetNet}>
          <dt>ยอดรับเข้าบัญชีหลังหักรายการต่าง ๆ</dt>
          <dd>
            <Money value={value.net} omitZeroFraction={false} />
          </dd>
        </div>
      )}
    </dl>
  );
}

export function WithdrawalRequestFacts({
  request,
  showNet = true,
  showReserved = true,
}: {
  request: WithdrawalRequestValue;
  showNet?: boolean;
  showReserved?: boolean;
}) {
  return (
    <>
      <dl className={styles.sheetReference}>
        <div>
          <dt>เลขอ้างอิงคำขอ</dt>
          <dd>{request.requestRef}</dd>
        </div>
        <div>
          <dt>วันที่ส่งคำขอ</dt>
          <dd>
            <time dateTime={request.submittedAt}>{timestamp(request.submittedAt)}</time>
          </dd>
        </div>
      </dl>
      <WithdrawalAmountDetails value={request} showNet={showNet} />
      {showReserved && (
        <dl className={styles.sheetAmounts}>
          <div>
            <dt>ยอดที่กันไว้สำหรับคำขอนี้</dt>
            <dd>
              <Money value={request.reserved} omitZeroFraction={false} />
            </dd>
          </div>
        </dl>
      )}
      <PayoutBeneficiarySummary beneficiary={{ ...request.beneficiary, state: 'known' }} />
    </>
  );
}
