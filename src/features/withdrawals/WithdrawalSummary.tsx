import type { WithdrawalSummaryValue } from '@/contracts/withdrawal-journey';
import type { BlockingReasonValue } from '@/contracts/withdrawal-readiness';
import { ArrowDownRight, ArrowUpRight, Landmark, Wallet } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { WalletCard } from './WalletSurface';
import { DataState } from '@/shared/ui/DataState';
import { Money } from '@/shared/ui/Money';
import { dateLabel } from '@/shared/ui/format-date';
import { Text } from '@/shared/ui/Text';
import styles from './withdrawals.module.css';

export type WithdrawalSummaryData = Pick<
  WithdrawalSummaryValue,
  'balance' | 'currentPeriodPending' | 'currentPeriod' | 'readiness' | 'lastWithdrawal'
> &
  Partial<Pick<WithdrawalSummaryValue, 'beneficiary'>>;

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

function pendingDate(period: WithdrawalSummaryData['currentPeriod'] | undefined): string | null {
  if (!period) return null;
  const end = Date.parse(period.toExclusive);
  if (!Number.isFinite(end)) return null;
  return dateLabel(new Date(end - 1).toISOString());
}

/** Read-only projection. Amounts and readiness arrive from the transport; actions are injected. */
export function WithdrawalSummary({
  data,
  state = 'ready',
  action,
  onRetry,
  className = '',
  compact = false,
  layout = 'card',
}: {
  data: WithdrawalSummaryData | null;
  state?: 'ready' | 'loading' | 'error' | 'stale';
  action?: WithdrawalSummaryAction;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
  layout?: 'card' | 'wide';
}) {
  const visible = state === 'loading' || state === 'error' ? null : data;
  const balance = visible?.balance.state === 'known' ? visible.balance : null;
  const cutoffDate = pendingDate(visible?.currentPeriod);
  const requestDisabled = state !== 'ready' || visible?.readiness.requestGate !== 'ready';
  const showRows =
    !compact || !!(balance && (balance.held.minor !== '0' || balance.deficit.minor !== '0'));
  const wide = !compact && layout === 'wide';
  const amount = (
    <Money
      value={balance?.available ?? null}
      reason="ยังไม่มีข้อมูลยอดพร้อมถอน"
      className={styles.summaryAmount}
    />
  );
  const withdrawalAction = action && (
    <Button
      variant="primary"
      className={styles.summaryAction}
      onClick={action.onClick}
      disabled={action.disabled || (action.kind === 'request' && requestDisabled)}
    >
      {action.label ?? (action.kind === 'request' ? 'ถอนเงิน' : 'ตรวจสอบคำขอ')}
    </Button>
  );

  return (
    <WalletCard
      compact={compact}
      title={wide ? undefined : 'ยอดพร้อมถอน'}
      className={`${styles.summary} ${!compact ? styles.summaryWallet : ''} ${wide ? styles.summaryWide : ''} ${className}`}
      action={
        !compact && <Wallet className={styles.summaryWalletIcon} size={22} aria-hidden="true" />
      }
      aria-label="สรุปยอดพร้อมถอน"
      aria-busy={state === 'loading'}
    >
      {wide && (
        <section className={styles.summaryPrimary} aria-label="ยอดพร้อมถอน">
          <Text as="h2" variant="cardTitle">
            ยอดพร้อมถอน
          </Text>
          {state !== 'loading' && state !== 'error' && amount}
          {withdrawalAction}
        </section>
      )}
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
          {!wide && amount}
          {!compact && (wide || visible?.beneficiary?.state === 'known') && (
            <section className={styles.summaryBank} aria-label="บัญชีรับเงินที่ผูกไว้">
              <Landmark size={20} aria-hidden="true" />
              <div>
                {wide && (
                  <Text as="h3" variant="label">
                    บัญชีรับเงิน
                  </Text>
                )}
                {visible?.beneficiary?.state === 'known' ? (
                  <>
                    <span>{visible.beneficiary.bankName}</span>
                    <span className={styles.summaryBankAccount}>
                      {visible.beneficiary.maskedAccount}
                    </span>
                  </>
                ) : (
                  <span>ยังไม่มีบัญชีรับเงินที่พร้อมใช้งาน</span>
                )}
              </div>
            </section>
          )}
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
                        <ArrowUpRight size={22} aria-hidden="true" />
                      </span>
                      <span>ยอดรอตัดรอบ</span>
                      {cutoffDate && <span className={styles.summaryDate}>{cutoffDate}</span>}
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
                        <ArrowDownRight size={22} aria-hidden="true" />
                      </span>
                      <span>ถอนล่าสุด</span>
                      {visible?.lastWithdrawal && (
                        <span className={styles.summaryDate}>
                          {dateLabel(visible.lastWithdrawal.paidAt)}
                        </span>
                      )}
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
      {!wide && withdrawalAction}
    </WalletCard>
  );
}
