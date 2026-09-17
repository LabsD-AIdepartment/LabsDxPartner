'use client';
import { PreviewTools } from '../PreviewTools';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WithdrawalOutcomeTargetValue } from '@/contracts/withdrawal-journey';
import {
  applyWithdrawalOutcome,
  loadWithdrawalDetail,
  loadWithdrawalPeriods,
  loadWithdrawalSummary,
  withdrawalKeys,
} from '@/features/withdrawals/model';
import { Button } from '@/shared/ui/Button';
import { SCENARIOS, SCENARIO_NAMES } from './scenarios';
import { isPreviewIdentity, isScenarioName, type PreviewIdentity } from './navigation';
import type { WithdrawalRuntime } from './transport';
import styles from '../withdrawal-preview.module.css';

function StaffWithdrawalPreviewControlsBody({
  runtime,
  version,
  identity,
  scenario,
  requestRef,
  periods,
  onSelectionChange,
  beneficiaryControls,
}: {
  beneficiaryControls?: ReactNode;
  runtime: WithdrawalRuntime;
  version: number;
  identity: PreviewIdentity;
  scenario: string;
  requestRef: string | null;
  periods: boolean;
  onSelectionChange: (selection: { identity: PreviewIdentity; scenario: string }) => void;
}) {
  const scope = runtime.controller.currentScope();
  const control = runtime.controller.view();
  const summary = useQuery({
    queryKey: withdrawalKeys.summary(scope, String(version)),
    queryFn: ({ signal }) => loadWithdrawalSummary(runtime.transport, { scope, signal }),
    enabled: !!requestRef,
    retry: false,
    staleTime: 0,
  });
  const detail = useQuery({
    queryKey: withdrawalKeys.detail(scope, requestRef ?? '', String(version)),
    queryFn: ({ signal }) =>
      loadWithdrawalDetail(runtime.transport, { scope, requestRef: requestRef!, signal }),
    enabled: !!requestRef,
    retry: false,
    staleTime: 0,
  });
  const periodQuery = useQuery({
    queryKey: withdrawalKeys.periods(scope, String(version)),
    queryFn: ({ signal }) => loadWithdrawalPeriods(runtime.transport, { scope, signal }),
    enabled: periods,
    retry: false,
    staleTime: 0,
  });
  const lock = useRef(false);
  const commandEpoch = useRef<number | null>(null);
  const releasedVersion = useRef<number | null>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; version: number; epoch: number } | null>(
    null,
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const freshRequest =
    !!requestRef &&
    summary.isSuccess &&
    !summary.isFetching &&
    summary.data.balance.state === 'known' &&
    detail.isSuccess &&
    !detail.isFetching &&
    detail.data.state === 'found' &&
    detail.data.detail.revision === summary.data.revision;
  const freshPeriods = periodQuery.isSuccess && !periodQuery.isFetching;
  const show = (text: string) =>
    setNotice({ text, version: runtime.version(), epoch: runtime.controller.epoch() });

  async function outcome(target: WithdrawalOutcomeTargetValue) {
    if (lock.current || !freshRequest || !summary.data || !requestRef) return;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    const epoch = runtime.controller.epoch();
    commandEpoch.current = epoch;
    const command = Object.freeze({
      scope: Object.freeze({ ...scope }),
      requestRef,
      expectedRevision: summary.data.revision,
      target,
    });
    try {
      // View disposal never aborts a dispatched command. The transport checks its captured epoch.
      const result = await applyWithdrawalOutcome(runtime.transport, {
        command,
        signal: new AbortController().signal,
      });
      if (!alive.current || runtime.controller.epoch() !== epoch) return;
      show(
        result.outcome === 'applied'
          ? 'บันทึกผลจำลองแล้ว โปรดดูสถานะคำขอล่าสุด'
          : `ยังไม่ได้เปลี่ยนผลจำลอง: ${result.detail}`,
      );
    } catch {
      if (alive.current && runtime.controller.epoch() === epoch)
        show('ยังยืนยันผลจำลองไม่ได้ กรุณาตรวจสอบสถานะคำขอเดิม ไม่ส่งซ้ำอัตโนมัติ');
    } finally {
      if (alive.current) {
        lock.current = false;
        setBusy(false);
        // Also refresh on a lost/invalid reply without manufacturing a new command.
        if (runtime.controller.epoch() === epoch) {
          void summary.refetch();
          void detail.refetch();
        }
      }
    }
  }

  return (
    <aside className={styles.toolbar} aria-label="ชุดตรวจเจ้าหน้าที่ถอนเงินจำลอง">
      <div className={styles.intro}>
        <strong>Staff withdrawal preview</strong>
        <span>DEV · ข้อมูลจำลองเท่านั้น · ไม่มีการโอนเงินจริง</span>
      </div>
      <div className={styles.controls}>
        <label>
          สถานการณ์จำลอง
          <select
            value={scenario}
            onChange={(event) => {
              if (isScenarioName(event.target.value))
                onSelectionChange({ identity, scenario: event.target.value });
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
          พาร์ตเนอร์เป้าหมายของ DEV
          <select
            value={identity}
            onChange={(event) => {
              if (isPreviewIdentity(event.target.value))
                onSelectionChange({ identity: event.target.value, scenario });
            }}
          >
            <option value="a">พาร์ตเนอร์ A / ผู้จ่าย A</option>
            <option value="b">พาร์ตเนอร์ B / ผู้จ่าย B</option>
          </select>
        </label>
      </div>
      <div className={styles.actions}>
        <Button onClick={() => runtime.controller.setReadError(!control.readError)}>
          {control.readError ? 'คืนการอ่านข้อมูล' : 'จำลองอ่านข้อมูลไม่สำเร็จ'}
        </Button>
        {requestRef && (
          <>
            <Button disabled={!freshRequest || busy} onClick={() => void outcome('processing')}>
              จำลองเริ่มดำเนินการโอน
            </Button>
            <Button disabled={!freshRequest || busy} onClick={() => void outcome('paid')}>
              จำลองโอนสำเร็จ
            </Button>
            <Button disabled={!freshRequest || busy} onClick={() => void outcome('failed')}>
              จำลองคำขอไม่สำเร็จ
            </Button>
            <Button disabled={!freshRequest || busy} onClick={() => void outcome('reconciling')}>
              จำลองยังไม่ทราบผลโอน
            </Button>
          </>
        )}
        {periods && (
          <Button
            disabled={!freshPeriods || !periodQuery.data?.releasable.length || busy}
            onClick={() => {
              if (
                lock.current ||
                releasedVersion.current === version ||
                !freshPeriods ||
                !periodQuery.data?.releasable.length
              )
                return;
              lock.current = true;
              releasedVersion.current = version;
              try {
                const released = runtime.controller.releaseNextPeriod();
                show(
                  released ? `ปล่อยยอดงวดจำลองแล้ว: ${released}` : 'ยังไม่ได้ปล่อยยอดงวดเพิ่มเติม',
                );
              } finally {
                lock.current = false;
              }
              void periodQuery.refetch();
            }}
          >
            จำลองปล่อยยอดงวดที่เข้าเกณฑ์ถัดไป
          </Button>
        )}
        <Button
          onClick={() => {
            setNotice(null);
            runtime.controller.reset();
          }}
        >
          เริ่มข้อมูลจำลองขอบเขตนี้ใหม่
        </Button>
      </div>
      {beneficiaryControls}
      {busy && commandEpoch.current === runtime.controller.epoch() && (
        <p role="status">กำลังส่งผลจำลองของคำขอเดิม…</p>
      )}
      {notice && notice.version === version && notice.epoch === runtime.controller.epoch() && (
        <p role="status" className={styles.warning}>
          {notice.text}
        </p>
      )}
    </aside>
  );
}

export function StaffWithdrawalPreviewControls(
  props: Parameters<typeof StaffWithdrawalPreviewControlsBody>[0],
) {
  return (
    <PreviewTools toolbar>
      <StaffWithdrawalPreviewControlsBody {...props} />
    </PreviewTools>
  );
}
