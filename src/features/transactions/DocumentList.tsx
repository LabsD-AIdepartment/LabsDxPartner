'use client';
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { Text } from '@/shared/ui/Text';
import {
  TransactionError,
  documentIsCurrent,
  type PreparedDocument,
  type DetailValue,
} from './model';
import type { TransactionsProps } from './types';
import styles from './transactions.module.css';
export function DocumentList({
  data,
  ...props
}: TransactionsProps & { data: DetailValue['data'] }) {
  return (
    <Card title="เอกสารของรอบจ่าย">
      {!data.documents.length && <Text tone="muted">ยังไม่มีเอกสารสำหรับรอบนี้</Text>}
      <div className={styles.rows}>
        {data.documents.map((doc) => (
          <DocumentRow
            key={`${props.scope.userId}:${props.scope.partnerId}:${props.scope.permissionRevision}:${data.statement.id}:${data.statement.version}:${doc.id}`}
            {...props}
            doc={doc}
            version={data.statement.version}
          />
        ))}
      </div>
    </Card>
  );
}
function DocumentRow({
  doc,
  version,
  scope,
  documents,
}: TransactionsProps & { doc: DetailValue['data']['documents'][number]; version: string }) {
  const [state, setState] = useState<'idle' | 'pending' | 'ready' | 'error' | 'forbidden'>('idle');
  const [message, setMessage] = useState('');
  const prepared = useRef<PreparedDocument | null>(null),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    prepared.current = null;
    setState('idle');
    setMessage('');
    return () => {
      abort.current?.abort();
      prepared.current?.dispose?.();
    };
  }, [documents]);
  async function prepare() {
    abort.current?.abort();
    prepared.current?.dispose?.();
    prepared.current = null;
    const controller = new AbortController();
    abort.current = controller;
    setState('pending');
    setMessage('กำลังเตรียมเอกสาร');
    try {
      const file = await documents({
        scope,
        statementId: doc.statementId,
        version,
        documentId: doc.id,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        file.dispose?.();
        return;
      }
      if (!documentIsCurrent(file)) {
        file.dispose?.();
        throw new Error('ลิงก์หมดอายุ กรุณาเตรียมเอกสารใหม่');
      }
      prepared.current = file;
      setState('ready');
      setMessage('เอกสารพร้อมดาวน์โหลด');
    } catch (e) {
      if (controller.signal.aborted) return;
      setState(e instanceof TransactionError && e.code === 'forbidden' ? 'forbidden' : 'error');
      setMessage(e instanceof Error ? e.message : 'เตรียมเอกสารไม่สำเร็จ');
    }
  }
  async function save() {
    const file = prepared.current;
    if (!file || !documentIsCurrent(file)) {
      setState('error');
      setMessage('ลิงก์หมดอายุ กรุณาเตรียมเอกสารใหม่');
      return;
    }
    setState('pending');
    setMessage('กำลังดาวน์โหลด');
    try {
      await file.save();
      if (abort.current?.signal.aborted) return;
      setState('ready');
      setMessage('ส่งเอกสารให้เบราว์เซอร์ดาวน์โหลดแล้ว');
    } catch (e) {
      if (abort.current?.signal.aborted) return;
      setState(e instanceof TransactionError && e.code === 'forbidden' ? 'forbidden' : 'error');
      setMessage(e instanceof Error ? e.message : 'ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่');
    }
  }
  return (
    <div className={styles.row}>
      <div>
        <Text as="strong" variant="label">
          {doc.name}
        </Text>
        <Text
          variant="caption"
          tone="muted"
          role={state === 'error' || state === 'forbidden' ? 'alert' : 'status'}
        >
          {message}
        </Text>
      </div>
      {state === 'ready' ? (
        <Button onClick={save}>ดาวน์โหลด</Button>
      ) : (
        state !== 'forbidden' && (
          <Button disabled={state === 'pending'} onClick={() => void prepare()}>
            {state === 'pending'
              ? 'กำลังเตรียม…'
              : state === 'error'
                ? 'ลองใหม่'
                : 'เตรียมดาวน์โหลด'}
          </Button>
        )
      )}
    </div>
  );
}
