'use client';
import { useState } from 'react';
import { Money } from '@/shared/ui/Money';
import { Button } from '@/shared/ui/Button';
import { DataState } from '@/shared/ui/DataState';
import { reportHref } from '@/shared/routing/report-context';
import { dateLabel } from '@/shared/ui/format-date';
import { ContentState, DataEnvelope } from './ContentState';
import { useContent } from './useContent';
import type { ContentProps } from './types';
import styles from './content.module.css';
export function EarningsSection(props: ContentProps & { contentId: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const query = useContent(props.transport, {
    scope: props.scope,
    context: props.context,
    contentId: props.contentId,
    resource: 'earnings',
    cursor,
  });
  const data = query.data;
  return (
    <>
      <ContentState
        pending={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
        latestHref={reportHref(props.routes.overview, { ...props.context, generation: null })}
      />
      {data && !query.error && (
        <DataEnvelope data={data}>
          <p className={styles.meta}>
            รายการจากต้นทางในรุ่นข้อมูลเดียวกัน ยอดสรุปของคลิปแสดงด้านบน ไม่ต้องบวกรายการนี้ซ้ำ
          </p>
          {data.data.items.length === 0 ? (
            <DataState
              state="empty"
              message="ยังไม่มีรายการรายได้ที่จับคู่กับคลิปนี้ในช่วงที่เลือก"
            />
          ) : (
            <div className={styles.earningRows}>
              {data.data.items.map((line) => (
                <article key={line.id}>
                  <div className={styles.rowHeading}>
                    <strong>
                      {
                        {
                          commission: 'คอมมิชชัน',
                          'fixed-fee': 'ค่าจ้างคงที่',
                          bonus: 'โบนัส',
                          adjustment: 'รายการปรับปรุง',
                        }[line.kind]
                      }
                    </strong>
                    <Money value={line.amount} />
                  </div>
                  <p>
                    {dateLabel(line.earnedAt)} ·{' '}
                    {
                      {
                        confirmed: 'ยืนยันแล้ว',
                        estimated: 'ประมาณการ ยังไม่ยืนยัน',
                        adjustment: 'ปรับปรุงแล้ว',
                      }[line.status]
                    }
                  </p>
                  {line.eligibleBase && (
                    <p>
                      ฐานยอดขาย <Money value={line.eligibleBase} /> · อัตรา {line.ratePpm! / 10000}%
                    </p>
                  )}
                  {line.reason && <p>{line.reason}</p>}
                  <details>
                    <summary>เงื่อนไขและรายการอ้างอิง</summary>
                    <p>ข้อตกลงเวอร์ชัน {line.agreementVersion}</p>
                    <p>
                      อ้างอิง {line.sourceRef} · หลักฐาน {line.evidenceRef}
                    </p>
                    {line.originalLineId && <p>ปรับจากรายการ {line.originalLineId}</p>}
                  </details>
                </article>
              ))}
            </div>
          )}
          <nav className={styles.pagination} aria-label="หน้ารายการรายได้">
            <Button
              disabled={!history.length}
              onClick={() => {
                setCursor(history.at(-1) ?? null);
                setHistory(history.slice(0, -1));
              }}
            >
              ก่อนหน้า
            </Button>
            <span>หน้า {history.length + 1}</span>
            <Button
              disabled={!data.data.nextCursor}
              onClick={() => {
                setHistory([...history, cursor]);
                setCursor(data.data.nextCursor);
              }}
            >
              ถัดไป
            </Button>
          </nav>
        </DataEnvelope>
      )}
    </>
  );
}
