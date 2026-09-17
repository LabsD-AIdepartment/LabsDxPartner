import type { WithdrawalPeriodsViewValue } from '@/contracts/withdrawal-journey';
import { Card } from '@/shared/ui/Card';
import { DataState } from '@/shared/ui/DataState';
import { Money } from '@/shared/ui/Money';
import { Text } from '@/shared/ui/Text';
import { timestamp } from '@/shared/ui/format-date';
import styles from './withdrawal-periods.module.css';

export type StaffWithdrawalPeriodsProps = {
  /** Already validated and scoped by the caller; amounts and release state remain authoritative. */
  periods: WithdrawalPeriodsViewValue | null;
  state: 'ready' | 'stale' | 'loading' | 'read-error' | 'invalid' | 'unavailable';
  onRetry?: () => void;
};

/** Read-only period provenance. No balance sums, release commands or payment actions. */
export function StaffWithdrawalPeriods({ periods, state, onRetry }: StaffWithdrawalPeriodsProps) {
  const visible = state === 'ready' || state === 'stale' ? periods : null;
  return (
    <Card
      title="งวดและการปล่อยยอด"
      aria-label="งวดและการปล่อยยอด"
      className={styles.periods}
      aria-busy={state === 'loading'}
    >
      <Text variant="caption" tone="muted">
        การปล่อยยอดเพิ่มยอดสะสมของพาร์ตเนอร์ ไม่ใช่การโอนเงินเข้าบัญชี
      </Text>
      <div className={styles.feedback}>
        {state === 'loading' && <DataState state="loading" message="กำลังโหลดข้อมูลงวด" />}
        {state === 'read-error' && (
          <DataState
            state="error"
            message="โหลดข้อมูลงวดไม่สำเร็จ กรุณาลองอีกครั้ง"
            onRetry={onRetry}
          />
        )}
        {state === 'invalid' && (
          <DataState
            state="error"
            message="ตรวจสอบความถูกต้องของข้อมูลงวดไม่ได้ กรุณาโหลดข้อมูลล่าสุด"
            onRetry={onRetry}
          />
        )}
        {(state === 'unavailable' || ((state === 'ready' || state === 'stale') && !visible)) && (
          <DataState state="unavailable" message="ยังไม่มีข้อมูลงวดจากต้นทาง" onRetry={onRetry} />
        )}
        {state === 'stale' && visible && (
          <DataState
            state="stale"
            message="แสดงข้อมูลงวดครั้งล่าสุดเพื่ออ่านเท่านั้น กรุณาตรวจสอบข้อมูลล่าสุด"
            onRetry={onRetry}
          />
        )}
      </div>
      {visible && (
        <>
          <section className={styles.section} aria-label="งวดปัจจุบันที่รอยืนยัน">
            <Text as="h3" variant="label">
              งวดปัจจุบันที่รอยืนยัน
            </Text>
            {visible.currentPeriod ? (
              <div className={styles.identity}>
                <Text>{visible.currentPeriod.label}</Text>
                <Text variant="caption" tone="muted">
                  รหัสงวด {visible.currentPeriod.periodId}
                </Text>
                <Text variant="caption" tone="muted">
                  ตั้งแต่{' '}
                  <time dateTime={visible.currentPeriod.from}>
                    {timestamp(visible.currentPeriod.from)}
                  </time>{' '}
                  ถึงก่อน{' '}
                  <time dateTime={visible.currentPeriod.toExclusive}>
                    {timestamp(visible.currentPeriod.toExclusive)}
                  </time>{' '}
                  (เวลาไทย)
                </Text>
              </div>
            ) : (
              <Text tone="muted">ยังไม่มีข้อมูลระบุงวดปัจจุบัน</Text>
            )}
            <dl className={styles.amounts}>
              <div>
                <dt>รายได้งวดปัจจุบันที่รอยืนยัน</dt>
                <dd>
                  <Money
                    value={visible.currentPeriodPending}
                    omitZeroFraction={false}
                    reason="ยังไม่มีข้อมูลรายได้งวดปัจจุบันที่รอยืนยัน"
                  />
                </dd>
              </div>
            </dl>
            {visible.currentPeriodPending === null && (
              <Text variant="caption" tone="muted">
                ยังไม่มีข้อมูลรายได้งวดปัจจุบันที่รอยืนยัน
              </Text>
            )}
          </section>
          <section className={styles.section} aria-label="งวดที่ปล่อยยอดแล้ว">
            <Text as="h3" variant="label">
              งวดที่ปล่อยยอดแล้ว
            </Text>
            {visible.released.length === 0 ? (
              <div className={styles.feedback}>
                <DataState state="empty" message="ยังไม่มีงวดที่ปล่อยยอดในข้อมูลนี้" />
              </div>
            ) : (
              <ul className={styles.list} aria-label="รายการงวดที่ปล่อยยอดแล้ว">
                {visible.released.map((period) => (
                  <li key={period.periodId}>
                    <div className={styles.identity}>
                      <Text as="h4" variant="label">
                        {period.label}
                      </Text>
                      <Text variant="caption" tone="muted">
                        รหัสงวด {period.periodId}
                      </Text>
                    </div>
                    <dl className={styles.amounts}>
                      <div>
                        <dt>ยอดที่ปล่อยเข้าสู่ยอดสะสม</dt>
                        <dd>
                          <Money
                            value={period.releasedAmount}
                            omitZeroFraction={false}
                            reason="ยังไม่มีข้อมูลจำนวนเงินที่ปล่อย"
                          />
                        </dd>
                      </div>
                    </dl>
                    {period.releasedAmount === null && (
                      <Text variant="caption" tone="muted">
                        ยังไม่มีข้อมูลจำนวนเงินที่ปล่อย
                      </Text>
                    )}
                    <Text variant="caption" tone="muted">
                      {period.releasedAt === null ? (
                        'ยังไม่มีข้อมูลเวลาที่ปล่อยยอด'
                      ) : (
                        <>
                          ปล่อยยอดเมื่อ{' '}
                          <time dateTime={period.releasedAt}>{timestamp(period.releasedAt)}</time>
                        </>
                      )}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={styles.section} aria-label="งวดที่เข้าเกณฑ์รอปล่อยยอด">
            <Text as="h3" variant="label">
              งวดที่เข้าเกณฑ์รอปล่อยยอด
            </Text>
            <Text variant="caption" tone="muted">
              ยอดส่วนนี้ยังไม่ได้ปล่อยเข้าสู่ยอดสะสม
            </Text>
            {visible.releasable.length === 0 ? (
              <div className={styles.feedback}>
                <DataState state="empty" message="ไม่มีงวดที่เข้าเกณฑ์รอปล่อยยอดในข้อมูลนี้" />
              </div>
            ) : (
              <ul className={styles.list} aria-label="รายการงวดที่เข้าเกณฑ์รอปล่อยยอด">
                {visible.releasable.map((period) => (
                  <li key={period.periodId}>
                    <div className={styles.identity}>
                      <Text as="h4" variant="label">
                        {period.label}
                      </Text>
                      <Text variant="caption" tone="muted">
                        รหัสงวด {period.periodId}
                      </Text>
                    </div>
                    <dl className={styles.amounts}>
                      <div>
                        <dt>ยอดเข้าเกณฑ์รอปล่อย</dt>
                        <dd>
                          <Money value={period.eligibleAmount} omitZeroFraction={false} />
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Text variant="caption" tone="muted" className={styles.asOf}>
            ข้อมูล ณ <time dateTime={visible.asOf}>{timestamp(visible.asOf)}</time>
          </Text>
        </>
      )}
    </Card>
  );
}
