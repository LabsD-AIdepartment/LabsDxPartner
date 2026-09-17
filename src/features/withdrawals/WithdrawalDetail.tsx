'use client';
import type { ReactNode } from 'react';
import type {
  WithdrawalCancellationReceiptValue,
  WithdrawalRequestDetailValue,
} from '@/contracts/withdrawal-journey';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DataState } from '@/shared/ui/DataState';
import { BackLink } from '@/shared/ui/BackLink';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Money } from '@/shared/ui/Money';
import { Text } from '@/shared/ui/Text';
import { timestamp } from '@/shared/ui/format-date';
import { WithdrawalRequestFacts } from './WithdrawalRequestFacts';
import { WithdrawalStatus } from './WithdrawalStatus';
import styles from './withdrawals.module.css';

/** Authoritative action projections/callbacks supplied by the controller. No command is made here. */
export type WithdrawalDetailActions = {
  cancel?: { enabled: boolean; onClick: () => void };
  checkStatus?: { enabled: boolean; onClick: () => void };
  recoverCancellation?: {
    enabled: boolean;
    onClick: (receipt: WithdrawalCancellationReceiptValue) => void;
    checkingOperationKey?: string;
  };
  busy?: boolean;
  message?: string;
};
export type WithdrawalDetailProps = {
  detail: WithdrawalRequestDetailValue | null;
  state: 'ready' | 'stale' | 'loading' | 'read-error' | 'invalid' | 'unavailable' | 'missing';
  backHref: string;
  /** Called only for an actual, non-null statement mapping. Caller builds the safe scoped URL. */
  periodHref?: (statementId: string) => string;
  actions?: WithdrawalDetailActions;
  onRetry?: () => void;
  className?: string;
  /** Partner detail can omit totals retained by staff and confirmation surfaces. */
  compactAmountDetails?: boolean;
  wallet?: boolean;
  proofAction?: ReactNode;
};

/** Controlled presentation of a validated detail. Status never grants cancellation authority. */
export function WithdrawalDetail({
  detail,
  state,
  backHref,
  periodHref,
  actions,
  onRetry,
  className = '',
  compactAmountDetails = false,
  wallet = false,
  proofAction,
}: WithdrawalDetailProps) {
  const visible = state === 'ready' || state === 'stale' ? detail : null;
  const fresh = state === 'ready';
  const busy = !!actions?.busy || !!actions?.recoverCancellation?.checkingOperationKey;
  return (
    <div className={`${styles.detailPage} ${className}`} aria-busy={state === 'loading'}>
      <nav
        aria-label="กลับรายการคำขอถอนเงิน"
        className={`${styles.detailActions} ${visible ? styles.detailBackOutside : ''}`}
      >
        <BackLink
          href={backHref}
          label={wallet ? 'กลับ Wallet' : 'กลับคำขอถอนเงินทั้งหมด'}
          compactOnMobile
        />
      </nav>
      <div className={styles.detailFeedback}>
        {state === 'loading' && (
          <DataState state="loading" message="กำลังโหลดรายละเอียดคำขอถอนเงิน" />
        )}
        {state === 'read-error' && (
          <DataState
            state="error"
            message="โหลดรายละเอียดคำขอไม่สำเร็จ กรุณาลองอีกครั้ง"
            onRetry={onRetry}
          />
        )}
        {state === 'invalid' && (
          <DataState
            state="error"
            message="ตรวจสอบความถูกต้องของรายละเอียดคำขอไม่ได้ กรุณาโหลดข้อมูลล่าสุด"
            onRetry={onRetry}
          />
        )}
        {state === 'unavailable' && (
          <DataState
            state="unavailable"
            message="ยังไม่มีรายละเอียดคำขอจากต้นทาง"
            onRetry={onRetry}
          />
        )}
        {state === 'missing' && (
          <DataState state="unavailable" message="ไม่พบคำขอถอนเงินในขอบเขตนี้" onRetry={onRetry} />
        )}
        {state === 'stale' && visible && (
          <DataState
            state="stale"
            message="แสดงรายละเอียดครั้งล่าสุด อ่านได้อย่างเดียวจนกว่าจะตรวจสอบข้อมูลล่าสุด"
            onRetry={onRetry}
          />
        )}
        {(state === 'ready' || state === 'stale') && !visible && (
          <DataState
            state="unavailable"
            message="ยังไม่มีรายละเอียดคำขอที่ตรวจสอบได้"
            onRetry={onRetry}
          />
        )}
      </div>
      {visible && (
        <>
          <Card
            className={styles.detailCard}
            title={wallet ? 'รายละเอียดการถอนเงิน' : 'รายละเอียดคำขอถอน'}
            aria-label="รายละเอียดคำขอถอน"
            action={
              <BackLink
                href={backHref}
                label={wallet ? 'กลับ Wallet' : 'กลับคำขอถอนเงินทั้งหมด'}
                mobileOnly
              />
            }
          >
            <div className={styles.detailFacts}>
              <WithdrawalRequestFacts
                request={visible.request}
                showNet={!compactAmountDetails}
                showReserved={!compactAmountDetails}
              />
              {actions?.message && <Text role="status">{actions.message}</Text>}
              <div className={`${styles.detailActions} ${styles.detailRequestActions}`}>
                {actions?.checkStatus &&
                  visible.request.allowedActions.includes('check_status') && (
                    <Button
                      disabled={!fresh || busy || !actions.checkStatus.enabled}
                      onClick={actions.checkStatus.onClick}
                    >
                      ตรวจสอบสถานะคำขอ
                    </Button>
                  )}
                {actions?.cancel && visible.request.allowedActions.includes('cancel') && (
                  <Button
                    disabled={
                      !fresh ||
                      busy ||
                      !actions.cancel.enabled ||
                      visible.pendingCancellations.length > 0
                    }
                    onClick={actions.cancel.onClick}
                  >
                    ยกเลิกคำขอถอน
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {visible.pendingCancellations.length > 0 && (
            <Card title="การยกเลิกที่รอตรวจสอบ" aria-label="การยกเลิกที่รอตรวจสอบ">
              <Text role="status">
                ยังยืนยันผลการยกเลิกไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนเริ่มการยกเลิกใหม่
              </Text>
              <ul className={styles.detailPendingList}>
                {visible.pendingCancellations.map((receipt) => (
                  <li key={receipt.operationKey}>
                    <dl className={styles.sheetReference}>
                      <div>
                        <dt>รหัสติดตามการยกเลิก</dt>
                        <dd>{receipt.operationKey}</dd>
                      </div>
                      <div>
                        <dt>เริ่มดำเนินการเมื่อ</dt>
                        <dd>
                          <time dateTime={receipt.createdAt}>{timestamp(receipt.createdAt)}</time>
                        </dd>
                      </div>
                    </dl>
                    {receipt.detail && <Text>{receipt.detail}</Text>}
                    {actions?.recoverCancellation && (
                      <Button
                        disabled={!fresh || busy || !actions.recoverCancellation.enabled}
                        aria-label={`ตรวจสอบผลการยกเลิก ${receipt.operationKey}`}
                        onClick={() => actions.recoverCancellation?.onClick(receipt)}
                      >
                        {actions.recoverCancellation.checkingOperationKey === receipt.operationKey
                          ? 'กำลังตรวจสอบ…'
                          : 'ตรวจสอบผลการยกเลิก'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className={styles.detailColumns}>
            <Card title="ลำดับสถานะคำขอ" aria-label="ลำดับสถานะคำขอ">
              {!visible.historyComplete && (
                <Text className={styles.sheetNotice}>
                  ประวัติเดิมบันทึกไว้ไม่ครบ แสดงเฉพาะข้อมูลและเหตุการณ์ที่บันทึกไว้
                </Text>
              )}
              <Text variant="caption" tone="muted">
                เรียงตามลำดับที่ระบบบันทึก เวลาแสดงตามข้อมูลจากต้นทาง
              </Text>
              <ol className={styles.detailTimeline}>
                {visible.timeline.map((entry) => (
                  <li key={entry.seq}>
                    {entry.kind === 'legacy_snapshot' ? (
                      <>
                        <Text as="h3" variant="label">
                          ข้อมูลสถานะเดิม
                        </Text>
                        <WithdrawalStatus status={entry.status} />
                        <Text variant="caption" tone="muted">
                          ข้อมูลเดิมบันทึกสถานะนี้ไว้ แต่ไม่มีเวลาที่สถานะเกิดขึ้น
                        </Text>
                      </>
                    ) : (
                      <>
                        <WithdrawalStatus status={entry.status} />
                        <Text variant="caption" tone="muted">
                          <time dateTime={entry.at}>{timestamp(entry.at)}</time>
                        </Text>
                      </>
                    )}
                    {entry.detail && <Text>{entry.detail}</Text>}
                  </li>
                ))}
              </ol>
            </Card>

            {!wallet && (
              <Card title="งวดที่เกี่ยวข้องกับยอดสะสม" aria-label="งวดที่เกี่ยวข้องกับยอดสะสม">
                {visible.sourceContext.state === 'unavailable' ? (
                  <div className={styles.detailSection}>
                    <Text>ยังไม่มีข้อมูลงวดที่เกี่ยวข้องกับคำขอนี้</Text>
                    <ul className={styles.detailReasons}>
                      {visible.sourceContext.reasons.map((reason, index) => (
                        <li key={index}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : visible.sourceContext.periods.length === 0 ? (
                  <Text className={styles.detailSection}>ไม่มีรายการงวดในข้อมูลที่บันทึกไว้</Text>
                ) : (
                  <ul className={styles.detailPeriodList}>
                    {visible.sourceContext.periods.map((period) => (
                      <li key={period.periodId}>
                        <Text as="h3" variant="label">
                          {period.label}
                        </Text>
                        <dl className={styles.sheetAmounts}>
                          <div>
                            <dt>ยอดที่งวดนี้ปล่อยเข้าสู่ยอดสะสม</dt>
                            <dd>
                              <Money
                                value={period.releasedAmount}
                                reason="ยังไม่มีข้อมูลยอดที่งวดนี้ปล่อย"
                                omitZeroFraction={false}
                              />
                            </dd>
                          </div>
                        </dl>
                        <Text variant="caption" tone="muted">
                          {period.releasedAt ? (
                            <>
                              ปล่อยยอดเมื่อ{' '}
                              <time dateTime={period.releasedAt}>
                                {timestamp(period.releasedAt)}
                              </time>
                            </>
                          ) : (
                            'ยังไม่มีวันที่ปล่อยยอดจากต้นทาง'
                          )}
                        </Text>
                        {period.statementId !== null && periodHref && (
                          <LinkButton href={periodHref(period.statementId)}>
                            ดูใบสรุปงวด {period.label}
                          </LinkButton>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>

          <Card title="หลักฐานการโอน" aria-label="เอกสารของคำขอ">
            {visible.documents.state === 'available' ? (
              <div className={styles.detailActions}>
                <Text>{visible.documents.documents[0].title}</Text>
                {fresh && proofAction}
              </div>
            ) : (
              <>
                <Text>หลักฐานจะพร้อมเมื่อโอนเงินสำเร็จ</Text>
                <ul className={styles.detailReasons}>
                  {visible.documents.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
