import { SourceUnavailableError } from '@/shared/query/source-unavailable';
import { DataState } from '@/shared/ui/DataState';
import { Button } from '@/shared/ui/Button';
import { TransactionError } from './model';
export function TransactionState({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => void;
}) {
  if (error instanceof SourceUnavailableError)
    return <DataState state="unavailable" message={error.message} />;
  if (pending) return <DataState state="loading" />;
  if (!error) return null;
  const blocked =
    error instanceof TransactionError && ['forbidden', 'not_found'].includes(error.code);
  return (
    <div>
      <DataState
        state="error"
        message={blocked ? error.message : 'ไม่สามารถแสดงรอบจ่ายได้ ' + error.message}
      />
      {!blocked && <Button onClick={retry}>โหลดข้อมูลล่าสุด</Button>}
    </div>
  );
}
