'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/shared/ui/Button';
import { DataState } from '@/shared/ui/DataState';
import { reportHref } from '@/shared/routing/report-context';
import { timestamp } from '@/shared/ui/format-date';
import { ContentState, DataEnvelope } from './ContentState';
import { useContent } from './useContent';
import type { ContentProps } from './types';
import { Text } from '@/shared/ui/Text';
import styles from './content.module.css';
export const adStatus = {
  active: 'กำลังแสดง',
  paused: 'หยุดแสดงชั่วคราว',
  removed: 'นำออกแล้ว',
  unknown: 'ยังไม่ทราบสถานะ',
};
export function AdList(props: ContentProps & { contentId: string }) {
  const [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<(string | null)[]>([]);
  const query = useContent(props.transport, {
    scope: props.scope,
    context: props.context,
    contentId: props.contentId,
    resource: 'ads',
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
          <Text variant="caption" tone="muted" className={styles.meta}>
            หลายโฆษณาใช้คลิปเดียวกันได้ รายได้ของคลิปแสดงครั้งเดียว ไม่กระจายหรือคูณซ้ำตามจำนวนโฆษณา
          </Text>
          {data.data.items.length ? (
            <div className={styles.adList}>
              {data.data.items.map((ad) => (
                <Link
                  key={ad.id}
                  href={reportHref(
                    `${props.routes.content}/${encodeURIComponent(props.contentId)}/ads/${encodeURIComponent(ad.id)}`,
                    props.context,
                  )}
                >
                  <div>
                    <strong>{ad.title}</strong>
                    <p>
                      {adStatus[ad.status]} · สถานะ ณ {timestamp(ad.asOf)}
                    </p>
                  </div>
                  <span aria-hidden>↗</span>
                </Link>
              ))}
            </div>
          ) : (
            <DataState state="empty" message="ยังไม่มีโฆษณาที่เชื่อมกับคลิปนี้" />
          )}
          <nav className={styles.pagination} aria-label="หน้าโฆษณาของคลิป">
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
