'use client';
import { useEffect, useId, useRef } from 'react';
import type { MoneyValue } from '@/contracts/common';
import type {
  PayoutBeneficiaryValue,
  RequestStatusValue,
  WithdrawalQuoteValue,
  WithdrawalRequestValue,
  WithdrawalResumeValue,
} from '@/contracts/withdrawal-journey';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Field } from '@/shared/ui/Field';
import { Money } from '@/shared/ui/Money';
import { WalletDialog } from './WalletSurface';
import { Text } from '@/shared/ui/Text';
import { timestamp } from '@/shared/ui/format-date';
import { PayoutBeneficiarySummary } from './PayoutBeneficiarySummary';
import { WithdrawalAmountDetails, WithdrawalRequestFacts } from './WithdrawalRequestFacts';
import styles from './withdrawals.module.css';

type Quoted = Extract<WithdrawalQuoteValue, { state: 'quoted' }>;
export type WithdrawalRecoveryHandle = { idempotencyKey: string; requestRef?: string };
export type WithdrawalAmountMode = 'all' | 'partial';
type AmountInput = { mode: WithdrawalAmountMode; amountText: string };

/** UI-only states. Eligibility and all financial values are supplied by the caller. */
export type WithdrawalSheetView =
  | ({
      state: 'editing';
      canReview: boolean;
      fieldError?: string;
      reasons?: readonly string[];
    } & AmountInput)
  | ({ state: 'quoting' } & AmountInput)
  | { state: 'review'; quote: Quoted; canConfirm: boolean; notice?: string }
  | { state: 'submitting'; quote: Quoted }
  | {
      state: 'uncertain';
      handle: WithdrawalRecoveryHandle;
      request?: WithdrawalRequestValue;
      canRecover: boolean;
      checking?: boolean;
      message?: string;
    }
  | {
      state: 'result';
      request: WithdrawalRequestValue;
      canRecover: boolean;
      checking?: boolean;
      message?: string;
    }
  | {
      state: 'active';
      entries: readonly WithdrawalResumeValue[];
      checkingKey?: string;
      message?: string;
    };

export type WithdrawalRequestSheetProps = {
  open: boolean;
  view: WithdrawalSheetView;
  available: MoneyValue | null;
  beneficiary: PayoutBeneficiaryValue;
  canStartNew?: boolean;
  onClose: () => void;
  onModeChange?: (mode: WithdrawalAmountMode) => void;
  onAmountChange?: (raw: string) => void;
  onReview?: () => void;
  onEdit?: () => void;
  onConfirm?: () => void;
  onRecover?: (handle: WithdrawalRecoveryHandle) => void;
  onNewRequest?: () => void;
  requestHref?: (requestRef: string) => string;
  historyHref?: string;
};

const statusLabels: Record<RequestStatusValue, string> = {
  requested: 'รอดำเนินการ',
  processing: 'กำลังดำเนินการโอน',
  paid: 'โอนเงินแล้ว',
  cancelled: 'คำขอถูกยกเลิกแล้ว',
  failed: 'คำขอไม่สำเร็จ',
  reconciling: 'ยังยืนยันผลการโอนไม่ได้',
};
const statusDescriptions: Record<RequestStatusValue, string> = {
  requested: 'รายการนี้ยังรอดำเนินการ ตรวจสอบสถานะล่าสุดได้ใน Wallet',
  processing: 'กำลังดำเนินการโอน ติดตามสถานะได้ใน Wallet',
  paid: 'สถานะคำขอระบุว่าโอนเงินแล้ว',
  cancelled: 'ตรวจสอบยอดล่าสุดได้จากหน้าภาพรวม',
  failed: 'ตรวจสอบข้อมูลคำขอและยอดล่าสุดก่อนดำเนินการต่อ',
  reconciling: 'ยังไม่ยืนยันผลการโอน ยอดที่กันไว้ยังคงอยู่ระหว่างตรวจสอบ',
};

/** Presentation only: closing hides the dialog; no callback cancels a financial operation. */
export function WithdrawalRequestSheet({
  open,
  view,
  available,
  beneficiary,
  canStartNew = false,
  onClose,
  onModeChange,
  onAmountChange,
  onReview,
  onEdit,
  onConfirm,
  onRecover,
  onNewRequest,
  requestHref,
  historyHref,
}: WithdrawalRequestSheetProps) {
  const inputGroup = useId();
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const fieldError = view.state === 'editing' ? view.fieldError : undefined;
  useEffect(() => {
    if (open) stageHeading.current?.focus();
  }, [open, view.state]);
  useEffect(() => {
    if (open && fieldError)
      content.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
  }, [open, fieldError]);

  const heading =
    view.state === 'editing'
      ? 'ระบุยอดที่ต้องการถอน'
      : view.state === 'quoting'
        ? 'กำลังตรวจสอบรายการ'
        : view.state === 'review'
          ? 'ตรวจสอบก่อนถอนเงิน'
          : view.state === 'submitting'
            ? 'กำลังดำเนินการถอน'
            : view.state === 'uncertain'
              ? 'ยังยืนยันผลคำขอไม่ได้'
              : view.state === 'active'
                ? 'คำขอที่ยังดำเนินการ'
                : statusLabels[view.request.status];

  return (
    <WalletDialog open={open} onClose={onClose} title="ถอนเงิน" className={styles.walletSheet}>
      <div className={styles.sheetContent} ref={content}>
        <h3 className={styles.sheetStage} tabIndex={-1} ref={stageHeading}>
          {heading}
        </h3>
        {(view.state === 'editing' || view.state === 'quoting') && (
          <form
            className={styles.sheetForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (view.state === 'editing' && view.canReview) onReview?.();
            }}
          >
            <dl className={styles.sheetBalance}>
              <div>
                <dt>ยอดพร้อมถอน</dt>
                <dd>
                  <Money value={available} reason="ยังไม่มีข้อมูลยอดพร้อมถอน" />
                </dd>
              </div>
            </dl>
            <fieldset className={styles.sheetModes} disabled={view.state === 'quoting'}>
              <legend>จำนวนเงินที่ต้องการถอน</legend>
              <div className={styles.sheetChoices}>
                <label>
                  <input
                    type="radio"
                    name={inputGroup}
                    value="all"
                    checked={view.mode === 'all'}
                    onChange={() => onModeChange?.('all')}
                  />
                  ถอนทั้งหมด
                </label>
                <label>
                  <input
                    type="radio"
                    name={inputGroup}
                    value="partial"
                    checked={view.mode === 'partial'}
                    onChange={() => onModeChange?.('partial')}
                  />
                  ระบุจำนวนเงิน
                </label>
              </div>
            </fieldset>
            {view.mode === 'partial' && (
              <Field
                label="ยอดที่ขอถอน (บาท)"
                aria-label="ยอดที่ขอถอน (บาท)"
                hint="ยอดก่อนหักภาษีและค่าธรรมเนียม ระบุทศนิยมได้ไม่เกิน 2 ตำแหน่ง"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={view.amountText}
                disabled={view.state === 'quoting'}
                error={view.state === 'editing' ? view.fieldError : undefined}
                onChange={(event) => onAmountChange?.(event.target.value)}
              />
            )}
            {view.mode === 'all' && (
              <Text variant="caption" tone="muted">
                ใช้ยอดพร้อมถอนทั้งหมดก่อนหักภาษีและค่าธรรมเนียม
              </Text>
            )}
            <PayoutBeneficiarySummary beneficiary={beneficiary} />
            {view.state === 'editing' && view.reasons && view.reasons.length > 0 && (
              <div role="alert" className={styles.sheetNotice}>
                <ul>
                  {view.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {view.state === 'quoting' && <Text role="status">กำลังตรวจสอบยอดและรายการหัก…</Text>}
            <Button
              type="submit"
              variant="primary"
              disabled={
                view.state === 'quoting' ||
                !onReview ||
                (view.state === 'editing' && !view.canReview)
              }
            >
              {view.state === 'quoting' ? 'กำลังตรวจสอบ…' : 'ตรวจสอบรายการ'}
            </Button>
          </form>
        )}

        {(view.state === 'review' || view.state === 'submitting') && (
          <>
            <WithdrawalAmountDetails value={view.quote} />
            <PayoutBeneficiarySummary beneficiary={{ ...view.quote.beneficiary, state: 'known' }} />
            <dl className={styles.sheetAmounts}>
              <div>
                <dt>ยอดพร้อมถอนที่เหลือหลังส่งคำขอนี้</dt>
                <dd>
                  <Money value={view.quote.availableAfterRequest} omitZeroFraction={false} />
                </dd>
              </div>
            </dl>
            <Text variant="caption" tone="muted">
              เมื่อยืนยัน ระบบจะเริ่มดำเนินการถอน
            </Text>
            {view.state === 'review' && view.notice && (
              <Text role="alert" className={styles.sheetNotice}>
                {view.notice}
              </Text>
            )}
            {view.state === 'submitting' && (
              <Text role="status">กำลังดำเนินการ ปิดหน้าต่างได้โดยรายการยังคงดำเนินต่อ</Text>
            )}
            <div className={styles.sheetActions}>
              {view.state === 'review' && (
                <Button onClick={onEdit} disabled={!onEdit}>
                  แก้ไขจำนวนเงิน
                </Button>
              )}
              <Button
                variant="primary"
                onClick={onConfirm}
                disabled={
                  view.state === 'submitting' ||
                  !onConfirm ||
                  (view.state === 'review' && !view.canConfirm)
                }
              >
                {view.state === 'submitting' ? 'กำลังดำเนินการ…' : 'ยืนยันถอนเงิน'}
              </Button>
            </div>
          </>
        )}

        {view.state === 'uncertain' && (
          <>
            <Text role="status" className={styles.sheetNotice}>
              {view.message ??
                'ยังไม่ทราบผลแน่นอน กรุณาตรวจสอบคำขอเดิมก่อนส่งคำขอใหม่ การปิดหน้าต่างไม่ยกเลิกคำขอ'}
            </Text>
            {view.request ? (
              <WithdrawalRequestFacts request={view.request} />
            ) : (
              <dl className={styles.sheetReference}>
                <div>
                  <dt>รหัสติดตามคำขอ</dt>
                  <dd>{view.handle.requestRef ?? view.handle.idempotencyKey}</dd>
                </div>
              </dl>
            )}
            <div className={styles.sheetActions}>
              {requestHref && view.handle.requestRef && (
                <LinkButton href={requestHref(view.handle.requestRef)}>ดูรายละเอียดคำขอ</LinkButton>
              )}
              {onRecover && (
                <Button
                  variant="primary"
                  disabled={!view.canRecover || view.checking}
                  onClick={() => onRecover(view.handle)}
                >
                  {view.checking ? 'กำลังตรวจสอบ…' : 'ตรวจสอบสถานะคำขอเดิม'}
                </Button>
              )}
              <Button onClick={onClose}>กลับไปดูภาพรวม</Button>
            </div>
          </>
        )}

        {view.state === 'result' && (
          <>
            <Text role="status" className={styles.sheetNotice}>
              {statusDescriptions[view.request.status]}
            </Text>
            {view.message && <Text role="status">{view.message}</Text>}
            <WithdrawalRequestFacts request={view.request} />
            <div className={styles.sheetActions}>
              {requestHref && (
                <LinkButton href={requestHref(view.request.requestRef)}>
                  ดูรายละเอียดคำขอ
                </LinkButton>
              )}
              {onRecover && view.request.allowedActions.includes('check_status') && (
                <Button
                  disabled={!view.canRecover || view.checking}
                  onClick={() =>
                    onRecover({
                      idempotencyKey: view.request.idempotencyKey,
                      requestRef: view.request.requestRef,
                    })
                  }
                >
                  {view.checking ? 'กำลังตรวจสอบ…' : 'ตรวจสอบสถานะ'}
                </Button>
              )}
              <Button variant="primary" onClick={onClose}>
                เสร็จสิ้น
              </Button>
            </div>
          </>
        )}

        {view.state === 'active' && (
          <>
            <Text variant="caption" tone="muted">
              เลือกรายการเพื่อตรวจสอบคำขอเดิม
            </Text>
            {view.message && (
              <Text role="status" className={styles.sheetNotice}>
                {view.message}
              </Text>
            )}
            {view.entries.length === 0 ? (
              <Text>ไม่มีคำขอที่รอดำเนินการในข้อมูลล่าสุด</Text>
            ) : (
              <ul className={styles.sheetActiveList}>
                {view.entries.map((entry) => (
                  <li key={entry.idempotencyKey}>
                    <Text variant="label">{statusLabels[entry.status]}</Text>
                    <Text variant="caption" tone="muted">
                      เลขอ้างอิง {entry.requestRef}
                    </Text>
                    <Text variant="caption" tone="muted">
                      <time dateTime={entry.submittedAt}>{timestamp(entry.submittedAt)}</time>
                    </Text>
                    <dl className={styles.sheetAmounts}>
                      <div>
                        <dt>ยอดที่ขอถอน</dt>
                        <dd>
                          <Money value={entry.gross} omitZeroFraction={false} />
                        </dd>
                      </div>
                      <div>
                        <dt>ยอดที่กันไว้</dt>
                        <dd>
                          <Money value={entry.reserved} omitZeroFraction={false} />
                        </dd>
                      </div>
                    </dl>
                    {onRecover && entry.allowedActions.includes('check_status') && (
                      <Button
                        aria-label={`ตรวจสอบคำขอ ${entry.requestRef}`}
                        disabled={view.checkingKey !== undefined}
                        onClick={() =>
                          onRecover({
                            idempotencyKey: entry.idempotencyKey,
                            requestRef: entry.requestRef,
                          })
                        }
                      >
                        {view.checkingKey === entry.idempotencyKey
                          ? 'กำลังตรวจสอบ…'
                          : 'ตรวจสอบคำขอนี้'}
                      </Button>
                    )}
                    {requestHref && (
                      <LinkButton
                        href={requestHref(entry.requestRef)}
                        aria-label={`ดูรายละเอียดคำขอ ${entry.requestRef}`}
                      >
                        ดูรายละเอียดคำขอ
                      </LinkButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.sheetActions}>
              {canStartNew && onNewRequest && (
                <Button
                  variant="primary"
                  onClick={onNewRequest}
                  disabled={view.checkingKey !== undefined}
                >
                  ขอถอนเงินเพิ่ม
                </Button>
              )}
              <Button onClick={onClose}>กลับไปดูภาพรวม</Button>
            </div>
          </>
        )}
        {historyHref && view.state === 'editing' && (
          <LinkButton
            href={historyHref}
            onClick={(event) => {
              if (
                !event.defaultPrevented &&
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              )
                onClose();
            }}
          >
            ประวัติใน Wallet
          </LinkButton>
        )}
      </div>
    </WalletDialog>
  );
}
