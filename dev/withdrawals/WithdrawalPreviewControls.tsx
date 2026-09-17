'use client';
import { PreviewTools } from '../PreviewTools';
import { Button } from '@/shared/ui/Button';
import { SCENARIOS, SCENARIO_NAMES } from './scenarios';
import { isPreviewIdentity, isScenarioName, type WithdrawalLane } from './navigation';
import type { WithdrawalRuntime } from './transport';
import type { CancelSimModeValue } from './store';
import styles from '../withdrawal-preview.module.css';

function WithdrawalPreviewControlsBody({
  runtime,
  selection,
  onSelectionChange,
  onReset,
  requestRef,
  withdrawals = false,
}: {
  runtime: WithdrawalRuntime | null;
  selection: Pick<WithdrawalLane, 'scenario' | 'identity'>;
  onSelectionChange: (value: Pick<WithdrawalLane, 'scenario' | 'identity'>) => void;
  onReset: () => void;
  requestRef?: string | null;
  withdrawals?: boolean;
}) {
  const control = runtime?.controller.view();
  return (
    <aside className={styles.toolbar} aria-label="ชุดตรวจการถอนเงินจำลอง">
      <div className={styles.intro}>
        <strong>Withdrawal preview</strong>
        <span>ข้อมูลจำลองเท่านั้น · ไม่มีการโอนเงินจริง</span>
      </div>
      <div className={styles.controls}>
        <label>
          สถานการณ์จำลอง
          <select
            value={selection.scenario}
            onChange={(event) => {
              if (isScenarioName(event.target.value))
                onSelectionChange({ ...selection, scenario: event.target.value });
            }}
          >
            {SCENARIO_NAMES.map((name) => (
              <option key={name} value={name}>
                {SCENARIOS[name].title}
              </option>
            ))}
          </select>
        </label>
        <label>
          ขอบเขตจำลอง
          <select
            value={selection.identity}
            onChange={(event) => {
              if (isPreviewIdentity(event.target.value))
                onSelectionChange({ ...selection, identity: event.target.value });
            }}
          >
            <option value="a">พาร์ทเนอร์ A / ผู้จ่าย A</option>
            <option value="b">พาร์ทเนอร์ B / ผู้จ่าย B</option>
          </select>
        </label>
        {withdrawals && (
          <label>
            ผลการยกเลิกจำลอง
            <select
              disabled={!runtime}
              value={control?.controls.cancelMode ?? 'success'}
              onChange={(event) =>
                runtime?.controller.setCancelMode(event.target.value as CancelSimModeValue)
              }
            >
              <option value="success">ยกเลิกสำเร็จ</option>
              <option value="race">เริ่มดำเนินการก่อนยกเลิก</option>
              <option value="operation_failure">การยกเลิกล้มเหลวแน่นอน</option>
              <option value="unknown">ยังไม่ทราบผลการยกเลิก</option>
              <option value="lost_after_accept">ยกเลิกสำเร็จแต่ผลตอบกลับสูญหาย</option>
            </select>
          </label>
        )}
      </div>
      <div className={styles.actions}>
        <Button
          disabled={!runtime}
          onClick={() => runtime?.controller.setReadError(!control?.readError)}
        >
          {control?.readError ? 'คืนการอ่านข้อมูล' : 'จำลองอ่านข้อมูลไม่สำเร็จ'}
        </Button>
        {!withdrawals && (
          <>
            <Button
              disabled={!runtime}
              aria-pressed={control?.controls.unknownOutcome ?? false}
              onClick={() =>
                runtime?.controller.setUnknownOutcome(!control?.controls.unknownOutcome)
              }
            >
              {control?.controls.unknownOutcome
                ? 'ผลคำขอถัดไป: ไม่ทราบผลแน่นอน'
                : 'ผลคำขอถัดไป: รับคำขอได้'}
            </Button>
            <Button disabled={!runtime} onClick={() => runtime?.controller.forceStaleQuote()}>
              จำลองใบตรวจสอบล้าสมัย
            </Button>
            <Button disabled={!runtime} onClick={() => runtime?.controller.changeBeneficiary()}>
              จำลองบัญชีรับเงินเปลี่ยน
            </Button>
            <Button
              disabled={!control?.remainingReleasable.length}
              onClick={() => runtime?.controller.releaseNextPeriod()}
            >
              จำลองปล่อยยอดงวดก่อน 10,000 บาท
            </Button>
          </>
        )}
        {withdrawals && requestRef && (
          <>
            <Button
              disabled={!runtime}
              onClick={() => runtime?.controller.markProcessing(requestRef)}
            >
              จำลองกำลังโอน
            </Button>
            <Button disabled={!runtime} onClick={() => runtime?.controller.markPaid(requestRef)}>
              จำลองโอนสำเร็จ
            </Button>
            <Button disabled={!runtime} onClick={() => runtime?.controller.markFailed(requestRef)}>
              จำลองคำขอไม่สำเร็จ
            </Button>
            <Button
              disabled={!runtime}
              onClick={() => runtime?.controller.markReconciling(requestRef)}
            >
              จำลองยังไม่ทราบผลโอน
            </Button>
          </>
        )}
        <Button
          disabled={!runtime}
          onClick={() => {
            runtime?.controller.reset();
            onReset();
          }}
        >
          เริ่มข้อมูลจำลองขอบเขตนี้ใหม่
        </Button>
      </div>
    </aside>
  );
}

export function WithdrawalPreviewControls(
  props: Parameters<typeof WithdrawalPreviewControlsBody>[0],
) {
  return (
    <PreviewTools toolbar>
      <WithdrawalPreviewControlsBody {...props} />
    </PreviewTools>
  );
}
