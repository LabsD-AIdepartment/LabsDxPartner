import { z } from 'zod';
import { ImportActivitySnapshot } from '@/contracts/import-activity';
import { Text } from '@/shared/ui/Text';
type Snapshot = z.infer<typeof ImportActivitySnapshot>;
/** Shared across source lanes; missing/failed activity never implies a healthy queue. */
export function ImportActivity({
  snapshot,
  connectionId,
  revision,
  unavailable,
}: {
  snapshot?: Snapshot;
  connectionId: string;
  revision: string;
  unavailable: boolean;
}) {
  const row = snapshot?.connections.find((c) => c.connectionId === connectionId);
  if (unavailable || !row || row.revision !== revision)
    return <Text tone="muted">ยังตรวจสถานะคิวไม่ได้</Text>;
  if (row.paused) return <Text tone="muted">คิวพักอยู่ รายงานเดิมยังดูได้</Text>;
  if (!row.reports) return <Text tone="muted">ยังไม่มีช่วงรายงานที่วางแผนนำเข้า</Text>;
  const waitingMs = row.oldestWaitingAt
    ? Date.parse(snapshot!.evaluatedAt) - Date.parse(row.oldestWaitingAt)
    : 0;
  return (
    <div aria-label="สถานะคิวนำเข้า">
      <Text>
        กำลังดึง {row.running} · รอเริ่ม {row.waiting} · รอรอบถัดไป {row.scheduled} · ต้องตรวจสอบ{' '}
        {row.attention} ช่วงรายงาน
      </Text>
      {row.nextAttemptAt && (
        <Text tone="muted">
          รอบถัดไปไม่ก่อน {new Date(row.nextAttemptAt).toLocaleString('th-TH')} (รวมเวลารอต้นทาง)
        </Text>
      )}
      {waitingMs >= 180000 && (
        <Text>มีงานรอเริ่มเกิน 3 นาที ให้ผู้ดูแลตรวจตัวดึงข้อมูลอัตโนมัติ</Text>
      )}
      {row.freshness ? (
        <div aria-label="ความครบของรายงานที่ติดตาม">
          <Text>
            มีรายงานตามการเชื่อมต่อปัจจุบัน {row.freshness.imported}/{row.reports} ช่วง · รอนำเข้า{' '}
            {row.freshness.missing} ช่วง
          </Text>
          {row.freshness.refreshDue > 0 && (
            <Text>
              ถึงรอบอัปเดตแล้ว {row.freshness.refreshDue} ช่วง แต่ยังนำเข้ารอบใหม่ไม่สำเร็จ{' '}
              รายงานเดิมยังดูได้
            </Text>
          )}
          {row.freshness.oldestSuccessAt && (
            <Text tone="muted">
              รายงานที่นำเข้าไว้นานที่สุด{' '}
              {new Date(row.freshness.oldestSuccessAt).toLocaleString('th-TH')} ·
              นับเฉพาะช่วงที่ระบบวางแผนติดตาม
            </Text>
          )}
        </div>
      ) : (
        <Text tone="muted">ยังตรวจความครบของรายงานไม่ได้</Text>
      )}
    </div>
  );
}
