'use client';
import { useId } from 'react';
import Link from 'next/link';
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
import styles from './withdrawal-staff.module.css';

export type StaffWithdrawalQueueFilters = {
  /** Empty string selects all caller-authorized partners. */
  partner: string;
  status: 'all' | RequestStatusValue;
  from: string;
  toExclusive: string;
};

export type StaffWithdrawalQueueProps = {
  /** Validated, authorized, already filtered/ordered bounded rows; every supplied row is rendered. */
  rows: readonly { partnerLabel: string; request: WithdrawalRequestValue; href: string }[];
  partnerOptions: readonly { id: string; label: string }[];
  filters: StaffWithdrawalQueueFilters;
  onFiltersChange: (filters: StaffWithdrawalQueueFilters) => void;
  /** Stale/partial rows must still belong to the current authorized scope. Links only open detail;
   * the destination must freshly validate its data and action authority. No mutations live here. */
  state: 'ready' | 'loading' | 'read-error' | 'partial-error' | 'invalid' | 'unavailable' | 'stale';
  filterError?: string;
  onRetry?: () => void;
  emptyKind?: 'history' | 'filtered';
};

/** Presentation only: no reads, local filtering/sorting, access decisions or money arithmetic. */
export function StaffWithdrawalQueue({
  rows,
  partnerOptions,
  filters,
  onFiltersChange,
  state,
  filterError,
  onRetry,
  emptyKind = 'history',
}: StaffWithdrawalQueueProps) {
  const id = useId();
  const visible = state === 'ready' || state === 'partial-error' || state === 'stale';
  return (
    <Card
      title="คำขอถอนเงินของพาร์ตเนอร์"
      description="ตรวจสอบคำขอและสถานะโอนเงินแยกตามพาร์ตเนอร์"
      aria-label="คิวคำขอถอนเงินของพาร์ตเนอร์"
      aria-busy={state === 'loading'}
      className={styles.queue}
    >
      <div
        className={styles.filters}
        role="group"
        aria-label="ตัวกรองคิวคำขอถอนเงิน"
        aria-describedby={`${id}-hint${filterError ? ` ${id}-error` : ''}`}
      >
        <label className={styles.selectField} htmlFor={`${id}-partner`}>
          <Text as="span" variant="label">
            พาร์ตเนอร์
          </Text>
          <select
            id={`${id}-partner`}
            value={filters.partner}
            onChange={(event) => onFiltersChange({ ...filters, partner: event.target.value })}
          >
            <option value="">ทุกพาร์ตเนอร์</option>
            {partnerOptions.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.selectField} htmlFor={`${id}-status`}>
          <Text as="span" variant="label">
            สถานะคำขอถอน
          </Text>
          <select
            id={`${id}-status`}
            value={filters.status}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                status: event.target.value as StaffWithdrawalQueueFilters['status'],
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
          aria-invalid={!!filterError}
          onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })}
        />
        <Field
          label="ถึงก่อนวันที่ (ไม่รวมวันนี้)"
          type="date"
          value={filters.toExclusive}
          aria-invalid={!!filterError}
          onChange={(event) => onFiltersChange({ ...filters, toExclusive: event.target.value })}
        />
      </div>
      <Text variant="caption" tone="muted" id={`${id}-hint`}>
        วันที่ส่งคำขอตามเวลาไทย ตัวกรองนี้ไม่เปลี่ยนยอดพร้อมถอนสะสม
      </Text>
      {filterError && (
        <Text role="alert" id={`${id}-error`}>
          {filterError}
        </Text>
      )}
      <div className={styles.feedback}>
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
            message="ยังไม่มีข้อมูลคำขอถอนเงินจากต้นทาง"
            onRetry={onRetry}
          />
        )}
        {state === 'partial-error' && (
          <DataState
            state="error"
            message="โหลดคำขอได้เพียงบางส่วน รายการนี้ยังไม่ครบทุกพาร์ตเนอร์ที่เลือก กรุณาลองอีกครั้ง"
            onRetry={onRetry}
          />
        )}
        {state === 'stale' && (
          <DataState
            state="stale"
            message="แสดงข้อมูลครั้งล่าสุดเพื่ออ่านเท่านั้น ต้องตรวจสอบสถานะล่าสุดก่อนดำเนินการ"
            onRetry={onRetry}
          />
        )}
        {state === 'ready' && !filterError && rows.length === 0 && (
          <DataState
            state="empty"
            message={
              emptyKind === 'filtered'
                ? 'ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้'
                : 'ยังไม่มีคำขอถอนเงินของพาร์ตเนอร์ที่เลือก'
            }
          />
        )}
      </div>
      {visible && rows.length > 0 && (
        <ul className={styles.list} aria-label="รายการคำขอถอนเงินของพาร์ตเนอร์">
          {rows.map(({ partnerLabel, request, href }) => {
            const scope = request.scope;
            const key = JSON.stringify([
              scope.userId,
              scope.partnerId,
              scope.permissionRevision,
              scope.payerId,
              scope.currency,
              scope.scenario,
              request.requestRef,
            ]);
            return (
              <li key={key}>
                <Link
                  className={styles.rowLink}
                  href={href}
                  aria-label={`ดูรายละเอียดคำขอ ${request.requestRef} ของ ${partnerLabel}`}
                >
                  <div className={styles.rowBody}>
                    <TextGroup className={styles.identity}>
                      <Text as="h3" variant="label">
                        {partnerLabel}
                      </Text>
                      <WithdrawalStatus status={request.status} />
                      <Text>เลขอ้างอิง {request.requestRef}</Text>
                      <Text variant="caption" tone="muted">
                        ส่งคำขอ{' '}
                        <time dateTime={request.submittedAt}>{timestamp(request.submittedAt)}</time>
                      </Text>
                    </TextGroup>
                    <dl className={styles.amounts}>
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
            );
          })}
        </ul>
      )}
    </Card>
  );
}
