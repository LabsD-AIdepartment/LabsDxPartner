'use client';
import { useId, type ReactNode } from 'react';
import Link from '@/shared/ui/AppLink';
import type { RequestStatusValue, WithdrawalRequestValue } from '@/contracts/withdrawal-journey';
import { ActionArrow } from '@/shared/ui/ActionArrow';
import { Card } from '@/shared/ui/Card';
import { DataState } from '@/shared/ui/DataState';
import { Field } from '@/shared/ui/Field';
import { Money } from '@/shared/ui/Money';
import { Text } from '@/shared/ui/Text';
import { TextGroup } from '@/shared/ui/TextGroup';
import { timestamp } from '@/shared/ui/format-date';
import { WithdrawalStatus, withdrawalStatusLabels } from './WithdrawalStatus';
import styles from './withdrawals.module.css';

/** Controlled display values only. Parsing/filtering/URL semantics belong to the caller. */
export type WithdrawalHistoryFilters = {
  status: 'all' | RequestStatusValue;
  from: string;
  toExclusive: string;
};

export type WithdrawalHistoryProps = {
  /** Already validated, scoped, filtered and ordered; render every supplied row (up to 200). */
  requests: readonly WithdrawalRequestValue[];
  filters: WithdrawalHistoryFilters;
  onFiltersChange: (filters: WithdrawalHistoryFilters) => void;
  /** Caller owns scope-safe route construction; this component never builds a request URL. */
  requestHref: (requestRef: string) => string;
  state: 'ready' | 'loading' | 'read-error' | 'invalid' | 'stale' | 'unavailable';
  emptyKind?: 'history' | 'filtered';
  filterError?: string;
  onRetry?: () => void;
  className?: string;
  /** Independently scoped summary owned by the composing experience. */
  balanceSummary?: ReactNode;
};

/** Read-only list. No transport, pagination, local filtering or financial arithmetic. */
export function WithdrawalHistory({
  requests,
  filters,
  onFiltersChange,
  requestHref,
  state,
  emptyKind = 'history',
  filterError,
  onRetry,
  className = '',
  balanceSummary,
}: WithdrawalHistoryProps) {
  const filterId = useId();
  const visible = state === 'ready' || state === 'stale';
  return (
    <Card
      title="คำขอถอนเงินของคุณ"
      description="ยอดก่อนหักและยอดสุทธิตามคำขอ แยกจากสถานะโอนเงิน"
      aria-label="ประวัติคำขอถอนเงิน"
      aria-busy={state === 'loading'}
      className={`${styles.history} ${className}`}
    >
      {balanceSummary}
      <div
        className={styles.historyFilters}
        role="group"
        aria-label="ตัวกรองคำขอถอนเงิน"
        aria-describedby={`${filterId}-hint${filterError ? ` ${filterId}-error` : ''}`}
      >
        <label className={styles.historyStatusFilter} htmlFor={`${filterId}-status`}>
          <Text as="span" variant="label">
            สถานะคำขอถอน
          </Text>
          <select
            id={`${filterId}-status`}
            value={filters.status}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                status: event.target.value as WithdrawalHistoryFilters['status'],
              })
            }
          >
            <option value="all">ทุกสถานะ</option>
            {Object.entries(withdrawalStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="วันที่ส่งคำขอ ตั้งแต่"
          type="date"
          value={filters.from}
          onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })}
        />
        <Field
          label="ถึงก่อนวันที่ (ไม่รวมวันนี้)"
          type="date"
          value={filters.toExclusive}
          onChange={(event) => onFiltersChange({ ...filters, toExclusive: event.target.value })}
        />
      </div>
      <Text variant="caption" tone="muted" id={`${filterId}-hint`}>
        กรองตามวันที่ส่งคำขอ ตัวกรองนี้ไม่เปลี่ยนยอดพร้อมถอนสะสม
      </Text>
      {filterError && (
        <Text role="alert" id={`${filterId}-error`}>
          {filterError}
        </Text>
      )}
      <div className={styles.historyFeedback}>
        {state === 'loading' && <DataState state="loading" message="กำลังโหลดคำขอถอนเงิน" />}
        {state === 'read-error' && (
          <DataState
            state="error"
            message="โหลดคำขอถอนเงินไม่สำเร็จ กรุณาลองอีกครั้ง"
            onRetry={onRetry}
          />
        )}
        {state === 'invalid' && (
          <DataState
            state="error"
            message="ตรวจสอบความถูกต้องของข้อมูลคำขอไม่ได้ กรุณาโหลดข้อมูลล่าสุด"
            onRetry={onRetry}
          />
        )}
        {state === 'unavailable' && (
          <DataState
            state="unavailable"
            message="ยังไม่มีข้อมูลประวัติคำขอถอนเงินจากต้นทาง"
            onRetry={onRetry}
          />
        )}
        {state === 'stale' && (
          <DataState
            state="stale"
            message="แสดงคำขอครั้งล่าสุด ต้องตรวจสอบสถานะล่าสุดก่อนดำเนินการ"
            onRetry={onRetry}
          />
        )}
        {visible && requests.length === 0 && (
          <DataState
            state="empty"
            message={
              emptyKind === 'filtered'
                ? 'ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้'
                : 'ยังไม่มีคำขอถอนเงิน'
            }
          />
        )}
      </div>
      {visible && requests.length > 0 && (
        <ul className={styles.historyList} aria-label="รายการคำขอถอนเงิน">
          {requests.map((request) => (
            <li key={request.requestRef}>
              <Link
                className={styles.historyLink}
                href={requestHref(request.requestRef)}
                aria-label={`ดูรายละเอียดคำขอ ${request.requestRef}`}
              >
                <div className={styles.historyBody}>
                  <TextGroup className={styles.historyIdentity}>
                    <WithdrawalStatus status={request.status} />
                    <Text as="h3" variant="label">
                      เลขอ้างอิง {request.requestRef}
                    </Text>
                    <Text variant="caption" tone="muted">
                      ส่งคำขอ{' '}
                      <time dateTime={request.submittedAt}>{timestamp(request.submittedAt)}</time>
                    </Text>
                  </TextGroup>
                  <dl className={styles.historyAmounts}>
                    <div>
                      <dt>ยอดที่ขอถอนก่อนหัก</dt>
                      <dd>
                        <Money value={request.gross} omitZeroFraction={false} />
                      </dd>
                    </div>
                    <div>
                      <dt>ยอดรับเข้าบัญชีตามคำขอ</dt>
                      <dd>
                        <Money value={request.net} omitZeroFraction={false} />
                      </dd>
                    </div>
                  </dl>
                </div>
                <ActionArrow />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
