'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadPayoutBeneficiaryConfig, withdrawalKeys } from '@/features/withdrawals/model';
import { Button } from '@/shared/ui/Button';
import type { WithdrawalRuntime } from './transport';
import styles from '../withdrawal-preview.module.css';

/** Synthetic controls belong only to the preview strip, never the product panel. */
export function PayoutBeneficiaryPreviewControls({
  runtime,
  version,
}: {
  runtime: WithdrawalRuntime;
  version: number;
}) {
  const scope = runtime.controller.currentScope();
  const config = useQuery({
    queryKey: withdrawalKeys.beneficiary(scope, String(version)),
    queryFn: ({ signal }) => loadPayoutBeneficiaryConfig(runtime.transport, { scope, signal }),
    retry: false,
    staleTime: 0,
  });
  const [mode, setMode] = useState<'ok' | 'unknown'>('ok');
  const canSimulate =
    config.isSuccess &&
    !config.isFetching &&
    config.data.state !== 'unavailable' &&
    config.data.allowedEdit &&
    !!config.data.bankId &&
    !!config.data.accountChoiceId;
  return (
    <div
      role="group"
      aria-label="จำลองบัญชีรับเงิน DEV"
      className={`${styles.controls} ${styles.actions}`}
    >
      <span>DEV · สถานะบัญชีรับเงินตัวอย่าง</span>
      <Button
        disabled={!canSimulate}
        onClick={() => runtime.controller.simulateBeneficiaryVerified()}
      >
        จำลองยืนยันบัญชี
      </Button>
      <Button
        disabled={!canSimulate}
        onClick={() => runtime.controller.simulateBeneficiaryPending()}
      >
        จำลองรอตรวจสอบบัญชี
      </Button>
      <Button
        disabled={!canSimulate}
        onClick={() => runtime.controller.simulateBeneficiaryMissing()}
      >
        จำลองยังไม่ตั้งค่าบัญชี
      </Button>
      {!canSimulate && <span>บันทึกข้อมูลตัวอย่างก่อนจำลองสถานะ และรอข้อมูลล่าสุด</span>}
      <label>
        ผลบันทึกบัญชีตัวอย่าง{' '}
        <select
          value={mode}
          onChange={(event) => {
            const value = event.target.value === 'unknown' ? 'unknown' : 'ok';
            setMode(value);
            runtime.controller.setBeneficiarySaveMode(value);
          }}
        >
          <option value="ok">ตอบผลตามปกติ</option>
          <option value="unknown">ไม่ทราบผลการบันทึก</option>
        </select>
      </label>
    </div>
  );
}
