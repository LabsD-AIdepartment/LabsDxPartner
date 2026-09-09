import { CircleAlert, Clock3, LoaderCircle, Inbox } from 'lucide-react';
import { Button } from './Button';
import { Text } from './Text';
import styles from './ui.module.css';
export type DisplayState =
  'ready' | 'loading' | 'empty' | 'error' | 'partial' | 'stale' | 'unavailable';
const labels: Record<Exclude<DisplayState, 'ready'>, string> = {
  loading: 'กำลังโหลดข้อมูล',
  empty: 'ยังไม่มีข้อมูลในช่วงเวลานี้',
  error: 'โหลดข้อมูลไม่สำเร็จ',
  partial: 'ข้อมูลบางส่วนยังรอตรวจสอบ',
  stale: 'กำลังรอข้อมูลรอบใหม่',
  unavailable: 'ยังไม่มีข้อมูลจากต้นทาง',
};
export function DataState({
  state,
  message,
  onRetry,
}: {
  state: DisplayState;
  message?: string;
  onRetry?: () => void;
}) {
  if (state === 'ready') return null;
  const Icon =
    state === 'loading'
      ? LoaderCircle
      : state === 'empty'
        ? Inbox
        : state === 'stale'
          ? Clock3
          : CircleAlert;
  return (
    <div className={styles.dataState} role={state === 'error' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden className={state === 'loading' ? styles.spinner : ''} />
      <Text variant="caption">{message ?? labels[state]}</Text>
      {onRetry && ['error', 'stale', 'unavailable'].includes(state) && (
        <Button onClick={onRetry}>ลองอีกครั้ง</Button>
      )}
    </div>
  );
}
