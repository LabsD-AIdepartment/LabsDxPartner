'use client';
import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import type { PayoutBeneficiaryConfigValue } from '@/contracts/withdrawal-journey';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DataState } from '@/shared/ui/DataState';
import { Dialog } from '@/shared/ui/Dialog';
import { Field } from '@/shared/ui/Field';
import { Text } from '@/shared/ui/Text';
import forms from '@/shared/ui/forms.module.css';
import styles from './payout-beneficiary.module.css';

export type PayoutBeneficiaryDraft = {
  displayName: string;
  bankId: string;
  accountChoiceId: string;
};
export type PayoutBeneficiaryPanelProps = {
  config: PayoutBeneficiaryConfigValue | null;
  state: 'ready' | 'stale' | 'loading' | 'read-error' | 'invalid' | 'unavailable';
  compact?: boolean;
  action?: ReactNode;
  onRetry?: () => void;
  onEdit?: () => void;
  notice?: string;
  uncertain?: boolean;
  checking?: boolean;
  onCheckCurrent?: () => void;
  editor?: {
    open: boolean;
    draft: PayoutBeneficiaryDraft;
    catalog: PayoutBeneficiaryConfigValue['catalog'];
    busy: boolean;
    canSave: boolean;
    changed: boolean;
    error?: string;
    onChange: (draft: PayoutBeneficiaryDraft) => void;
    onClose: () => void;
    onSave: () => void;
    onReviewLatest?: () => void;
  };
};
const labels = {
  missing: 'ยังไม่ได้ตั้งค่าบัญชีรับเงิน',
  pending: 'รอตรวจสอบบัญชีรับเงินใน DEMO',
  verified: '',
  unavailable: 'ยังตรวจสอบข้อมูลบัญชีรับเงินไม่ได้',
};

/** Controlled current configuration. Historical request recipients remain in WithdrawalDetail. */
export function PayoutBeneficiaryPanel({
  config,
  state,
  compact,
  action,
  onRetry,
  onEdit,
  notice,
  uncertain,
  checking,
  onCheckCurrent,
  editor,
}: PayoutBeneficiaryPanelProps) {
  const visible = state === 'ready' || state === 'stale' ? config : null;
  const editable = state === 'ready' && visible?.allowedEdit && visible.state !== 'unavailable';
  return (
    <>
      <Card
        title="บัญชีรับเงินปัจจุบัน"
        action={
          <>
            {action}
            {editable && onEdit && (
              <Button aria-label="ดู/แก้ไขบัญชีรับเงิน" onClick={onEdit}>
                <Pencil size={16} />
                แก้ไข
              </Button>
            )}
          </>
        }
        aria-label="บัญชีรับเงินปัจจุบัน"
        description={
          compact ? 'การตั้งค่าปัจจุบันแยกจากผู้รับเงินที่บันทึกไว้ในคำขอเดิม' : undefined
        }
      >
        {state !== 'ready' && (
          <DataState
            state={state === 'read-error' || state === 'invalid' ? 'error' : state}
            message={
              state === 'invalid'
                ? 'ข้อมูลบัญชีรับเงินไม่ตรงกับขอบเขตหรือไม่ถูกต้อง'
                : state === 'read-error'
                  ? 'โหลดบัญชีรับเงินไม่สำเร็จ'
                  : undefined
            }
            onRetry={onRetry}
          />
        )}
        {visible && (
          <div className={styles.content}>
            {visible.state !== 'verified' && <Text variant="label">{labels[visible.state]}</Text>}
            <dl className={styles.facts}>
              {visible.displayName && (
                <div>
                  <dt>ชื่อผู้รับเงิน</dt>
                  <dd>{visible.displayName}</dd>
                </div>
              )}
              {visible.bankLabel && (
                <div>
                  <dt>ธนาคารตัวอย่าง</dt>
                  <dd>{visible.bankLabel}</dd>
                </div>
              )}
              {visible.maskedAccount && (
                <div>
                  <dt>บัญชีรับเงินตัวอย่าง</dt>
                  <dd>{visible.maskedAccount}</dd>
                </div>
              )}
            </dl>
            {visible.state === 'unavailable' && (
              <Text tone="muted">
                โปรดตรวจสอบข้อมูลปัจจุบันก่อนแก้ไข ไม่สามารถยืนยันความพร้อมของบัญชีได้
              </Text>
            )}
          </div>
        )}
        {notice && (
          <Text role="status" className={styles.notice}>
            {notice}
          </Text>
        )}
        {uncertain && onCheckCurrent && (
          <Button disabled={checking} onClick={onCheckCurrent}>
            {checking ? 'กำลังตรวจสอบข้อมูลปัจจุบัน…' : 'ตรวจสอบข้อมูลปัจจุบัน'}
          </Button>
        )}
        {visible?.state === 'unavailable' && !uncertain && onRetry && (
          <Button onClick={onRetry}>ตรวจสอบข้อมูลปัจจุบัน</Button>
        )}
      </Card>
      {editor && (
        <Dialog
          open={
            editor.open &&
            !['invalid', 'read-error', 'unavailable'].includes(state) &&
            config?.state !== 'unavailable'
          }
          onClose={editor.onClose}
          title="แก้ไขบัญชีรับเงินตัวอย่าง"
        >
          <form
            className={forms.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (editor.canSave) editor.onSave();
            }}
          >
            <Text tone="muted">บัญชีสำหรับ DEMO เท่านั้น บันทึกแล้วจะอยู่ระหว่างรอตรวจสอบ</Text>
            <Field
              label="ชื่อผู้รับเงินตัวอย่าง"
              maxLength={140}
              value={editor.draft.displayName}
              disabled={editor.busy}
              autoComplete="off"
              onChange={(event) =>
                editor.onChange({ ...editor.draft, displayName: event.target.value })
              }
            />
            <label className={forms.field}>
              <Text as="span" variant="label">
                ธนาคารตัวอย่าง
              </Text>
              <select
                value={editor.draft.bankId}
                disabled={editor.busy}
                onChange={(event) =>
                  editor.onChange({ ...editor.draft, bankId: event.target.value })
                }
              >
                <option value="">เลือกธนาคารตัวอย่าง</option>
                {editor.catalog.banks.map((bank) => (
                  <option key={bank.bankId} value={bank.bankId}>
                    {bank.bankLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className={forms.field}>
              <Text as="span" variant="label">
                บัญชีตัวอย่างที่ปิดบังเลขแล้ว
              </Text>
              <select
                value={editor.draft.accountChoiceId}
                disabled={editor.busy}
                onChange={(event) =>
                  editor.onChange({ ...editor.draft, accountChoiceId: event.target.value })
                }
              >
                <option value="">เลือกบัญชีตัวอย่าง</option>
                {editor.catalog.accounts.map((account) => (
                  <option key={account.accountChoiceId} value={account.accountChoiceId}>
                    {account.maskedAccount}
                  </option>
                ))}
              </select>
            </label>
            {editor.error && <Text role="alert">{editor.error}</Text>}
            {editor.changed && (
              <div className={styles.content}>
                <Text role="alert">
                  ข้อมูลบัญชีรับเงินเปลี่ยนแล้ว โปรดตรวจสอบข้อมูลล่าสุดก่อนบันทึก
                </Text>
                {editor.onReviewLatest && (
                  <Button onClick={editor.onReviewLatest}>ใช้ข้อมูลล่าสุด</Button>
                )}
              </div>
            )}
            {uncertain && (
              <Text role="status">
                ยังยืนยันผลการบันทึกไม่ได้ ปิดหน้าต่างแล้วตรวจสอบข้อมูลปัจจุบันก่อนแก้ไขใหม่
              </Text>
            )}
            <div className={forms.actions}>
              <Button type="submit" disabled={!editor.canSave}>
                {editor.busy ? 'กำลังบันทึก…' : 'บันทึกบัญชีตัวอย่าง'}
              </Button>
              <Button onClick={editor.onClose}>ปิด</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
