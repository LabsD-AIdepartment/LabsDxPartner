'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Text } from './Text';
import styles from './forms.module.css';
/** Remount for a new target/scope. Retrying the same review reuses its idempotency key. */
export function ConfirmAction({
  title,
  children,
  onClose,
  onConfirm,
  onComplete,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: (signal: AbortSignal, idempotencyKey: string) => Promise<{ message: string }>;
  onComplete: (message: string) => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const active = useRef<AbortController | null>(null),
    key = useRef<string | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function confirm() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    key.current ??= crypto.randomUUID();
    setPending(true);
    setError('');
    try {
      const result = await onConfirm(controller.signal, key.current);
      if (!controller.signal.aborted) onComplete(result.message);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setPending(false);
      }
    }
  }
  return (
    <Dialog
      open
      title={title}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      {children}
      {error && <Text role="alert">{error}</Text>}
      {pending && <Text role="status">กำลังดำเนินการ กรุณารอสักครู่</Text>}
      <div className={styles.actions}>
        <Button disabled={pending} onClick={onClose}>
          ยกเลิก
        </Button>
        <Button variant="primary" disabled={pending} onClick={() => void confirm()}>
          ยืนยัน
        </Button>
      </div>
    </Dialog>
  );
}
