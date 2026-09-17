'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { WithdrawalRequestValue, WithdrawalScopeValue } from '@/contracts/withdrawal-journey';
import { Button } from '@/shared/ui/Button';
import { loadWithdrawalDetail, withdrawalScopeKey, type WithdrawalHistoryTransport } from './model';
import styles from './wallet.module.css';

/** An explicit download always revalidates the paid transaction and its proof descriptor. */
export function WithdrawalProofButton(props: {
  scope: WithdrawalScopeValue;
  transport: WithdrawalHistoryTransport;
  request: WithdrawalRequestValue;
  refreshKey?: string | number;
  disabled?: boolean;
}) {
  return (
    <ScopedProof
      key={JSON.stringify([
        ...withdrawalScopeKey(props.scope),
        props.request.requestRef,
        props.refreshKey,
      ])}
      {...props}
    />
  );
}
function ScopedProof({
  scope,
  transport,
  request,
  disabled,
}: Parameters<typeof WithdrawalProofButton>[0]) {
  const job = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    setBusy(false);
    return () => {
      job.current?.abort();
      job.current = null;
    };
  }, [transport, disabled]);
  async function download() {
    if (disabled || job.current || request.status !== 'paid') return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await loadWithdrawalDetail(transport, {
        scope,
        requestRef: request.requestRef,
        signal: controller.signal,
      });
      if (controller.signal.aborted || job.current !== controller) return;
      if (
        result.state !== 'found' ||
        result.detail.request.status !== 'paid' ||
        result.detail.documents.state !== 'available'
      )
        throw new Error('Proof unavailable');
      const { downloadWithdrawalProof } = await import('./withdrawal-proof');
      if (controller.signal.aborted || job.current !== controller) return;
      await downloadWithdrawalProof(result.detail, undefined, undefined, controller.signal);
    } catch {
      if (!controller.signal.aborted && job.current === controller)
        setError('ดาวน์โหลดหลักฐานไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      if (job.current === controller) {
        job.current = null;
        setBusy(false);
      }
    }
  }
  if (request.status !== 'paid') return null;
  return (
    <div className={styles.proof}>
      <Button
        icon
        disabled={disabled || busy}
        onClick={() => void download()}
        aria-label={`ดาวน์โหลดหลักฐานการโอน ${request.requestRef}`}
        title="ดาวน์โหลดหลักฐานการโอน"
        aria-busy={busy}
      >
        <Download size={18} aria-hidden />
      </Button>
      {busy && (
        <span className={styles.visuallyHidden} role="status">
          กำลังเตรียมหลักฐาน
        </span>
      )}
      {error && (
        <p role="alert" className={styles.proofError}>
          {error}
        </p>
      )}
    </div>
  );
}
