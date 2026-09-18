import type { WithdrawalSummaryValue } from '@/contracts/withdrawal-journey';
import type { BlockingReasonValue } from '@/contracts/withdrawal-readiness';
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DataState } from '@/shared/ui/DataState';
import { Money } from '@/shared/ui/Money';
import { dateLabel } from '@/shared/ui/format-date';
import { Text } from '@/shared/ui/Text';
import styles from './withdrawals.module.css';

export type WithdrawalSummaryData = Pick<
  WithdrawalSummaryValue,
  'balance' | 'currentPeriodPending' | 'currentPeriod' | 'readiness' | 'lastWithdrawal'
>;

export type WithdrawalSummaryAction = {
  kind: 'request' | 'recovery';
  onClick: () => void;
  disabled?: boolean;
  label?: string;
};

const prerequisiteLabels: Record<BlockingReasonValue['prerequisite'], string> = {
  payer: 'ข้อมูลผู้จ่าย',
  releaseRule: 'เงื่อนไขการปล่อยยอด',
  taxPolicy: 'ข้อมูลภาษี',
  beneficiary: 'บัญชีรับเงิน',
  balance: 'ยอดพร้อมถอน',
};

function blockingLabel(reason: BlockingReasonValue): string {
  if (reason.code === 'balance_not_positive') return 'ยังไม่มียอดพร้อมถอนในขณะนี้';
  if (reason.code === 'balance_revision_stale' || reason.code === 'version_mismatch')
    return `${prerequisiteLabels[reason.prerequisite]}มีการเปลี่ยนแปลง ต้องตรวจสอบข้อมูลล่าสุด`;
  return `${prerequisiteLabels[reason.prerequisite]}ยังไม่พร้อม ต้องตรวจสอบข้อมูลก่อนถอน`;
}

function pendingLabel(period: WithdrawalSummaryData['currentPeriod'] | undefined): string {
  if (!period) return 'ยอดรอตัดรอบ';
  const end = Date.parse(period.toExclusive);
  if (!Number.isFinite(end)) return 'ยอดรอตัดรอบ';
  const cutoff = new Date(end - 1);
  const parts = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    numberingSystem: 'latn',
    timeZone: 'Asia/Bangkok',
  }).formatToParts(cutoff);
  const date = ['day', 'month', 'year']
    .map((part) => parts.find((item) => item.type === part)?.value)
    .join('-');
  return `ยอดรอตัดรอบ ${date}`;
}

/** Read-only projection. Amounts and readiness arrive from the transport; actions are injected. */
export function WithdrawalSummary({
  data,
  state = 'ready',
  action,
  onRetry,
  className = '',
  compact = false,
}: {
  data: WithdrawalSummaryData | null;
  state?: 'ready' | 'loading' | 'error' | 'stale';
  action?: WithdrawalSummaryAction;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const visible = state === 'loading' || state === 'error' ? null : data;
  const balance = visible?.balance.state === 'known' ? visible.balance : null;
  const requestDisabled = state !== 'ready' || visible?.readiness.requestGate !== 'ready';
  const showRows =
    !compact || !!(balance && (balance.held.minor !== '0' || balance.deficit.minor !== '0'));

  return (
    <Card
      title="ยอดพร้อมถอน"
      className={`${styles.summary} ${!compact ? styles.summaryWallet : ''} ${className}`}
      action={
        !compact && <Wallet className={styles.summaryWalletIcon} size={22} aria-hidden="true" />
      }
      aria-label="สรุปยอดพร้อมถอน"
      aria-busy={state === 'loading'}
    >
      {state === 'loading' || state === 'error' ? (
        <div className={styles.summaryFeedback}>
          <DataState
            state={state}
            message={state === 'loading' ? 'กำลังตรวจสอบยอดพร้อมถอน' : 'โหลดข้อมูลการถอนไม่สำเร็จ'}
            onRetry={onRetry}
          />
        </div>
      ) : (
        <>
          <Money
            value={balance?.available ?? null}
            reason="ยังไม่มีข้อมูลยอดพร้อมถอน"
            className={styles.summaryAmount}
          />
          {state === 'stale' && (
            <div className={styles.summaryFeedback}>
              <DataState
                state="stale"
                message="แสดงยอดครั้งล่าสุด ต้องอัปเดตข้อมูลก่อนขอถอน"
                onRetry={onRetry}
              />
            </div>
          )}
          {!balance && (
            <div className={styles.summaryNotice}>
              <Text variant="caption" tone="muted">
                ยังไม่มีข้อมูลยอดพร้อมถอน
              </Text>
              {visible?.balance.state === 'unavailable' && (
                <ul className={styles.summaryReasons}>
                  {visible.balance.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {showRows && (
            <dl className={styles.summaryRows}>
              {!compact && (
                <>
                  <div className={`${styles.summaryTile} ${styles.summaryIncoming}`}>
                    <dt className={styles.summaryPendingLabel}>
                      <span className={styles.summaryFlowIcon}>
                        <ArrowDownLeft size={18} aria-hidden="true" />
                      </span>
                      <span>{pendingLabel(visible?.currentPeriod)}</span>
                    </dt>
                    <dd>
                      <Money
                        value={visible?.currentPeriodPending ?? null}
                        reason="ยังไม่มีข้อมูลรายได้งวดปัจจุบันที่รอยืนยัน"
                      />
                      {visible?.currentPeriodPending == null && <span>ยังไม่มีข้อมูล</span>}
                    </dd>
                  </div>
                  <div className={`${styles.summaryTile} ${styles.summaryOutgoing}`}>
                    <dt>
                      <span className={styles.summaryFlowIcon}>
                        <ArrowUpRight size={18} aria-hidden="true" />
                      </span>
                      <span>
                        ถอนล่าสุด
                        {visible?.lastWithdrawal
                          ? ` · ${dateLabel(visible.lastWithdrawal.paidAt)}`
                          : ''}
                      </span>
                    </dt>
                    <dd>
                      {visible?.lastWithdrawal === null ? (
                        <span>ยังไม่มีรายการถอนสำเร็จ</span>
                      ) : (
                        <Money
                          value={visible?.lastWithdrawal?.net ?? null}
                          reason="ยังไม่มีข้อมูลการถอนล่าสุด"
                        />
                      )}
                    </dd>
                  </div>
                </>
              )}
              {balance && balance.held.minor !== '0' && (
                <div>
                  <dt>ยอดที่ระงับไว้</dt>
                  <dd>
                    <Money value={balance.held} />
                  </dd>
                </div>
              )}
              {balance && balance.deficit.minor !== '0' && (
                <div>
                  <dt>ยอดขาดดุล</dt>
                  <dd>
                    <Money value={balance.deficit} />
                  </dd>
                </div>
              )}
            </dl>
          )}
          {visible?.readiness.requestGate === 'blocked' && (
            <div className={styles.summaryNotice}>
              <Text variant="label">ยังถอนเงินไม่ได้</Text>
              <ul className={styles.summaryReasons}>
                {visible.readiness.blockingReasons.map((reason, index) => (
                  <li key={index}>{blockingLabel(reason)}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {action && (
        <Button
          variant="primary"
          className={styles.summaryAction}
          onClick={action.onClick}
          disabled={action.disabled || (action.kind === 'request' && requestDisabled)}
        >
          {action.label ?? (action.kind === 'request' ? 'ถอนเงิน' : 'ตรวจสอบคำขอ')}
        </Button>
      )}
    </Card>
  );
}
