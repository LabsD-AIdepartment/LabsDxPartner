'use client';
import { useEffect } from 'react';
import { Money } from '@/shared/ui/Money';
import { DataState } from '@/shared/ui/DataState';
import { reportHref } from '@/shared/routing/report-context';
import { dateLabel } from '@/shared/ui/format-date';
import { AccessLost } from '@/shared/query/revision-watcher';
import { ContentState, DataEnvelope } from './ContentState';
import { useContentEarnings } from './useContentEarnings';
import { ContentError } from './model';
import type { ContentProps } from './types';
import styles from './content.module.css';
export function EarningsSection(props: ContentProps & { contentId: string }) {
  const query = useContentEarnings(props.transport, {
    scope: props.scope,
    context: props.context,
    contentId: props.contentId,
  });
  useEffect(() => {
    if (query.hasNextPage && !query.isFetching && !query.error) void query.fetchNextPage();
  }, [
    query.hasNextPage,
    query.isFetching,
    query.error,
    query.fetchNextPage,
    query.data?.pages.length,
  ]);
  const pages = query.data?.pages ?? [];
  const unsafe = query.error instanceof ContentError || query.error instanceof AccessLost;
  const recoverableNext = query.isFetchNextPageError && !unsafe;
  const showPages = !query.error || recoverableNext;
  const retry = () => {
    if (recoverableNext) void query.fetchNextPage();
    else void query.refetch();
  };
  const empty =
    pages.length > 0 &&
    !query.hasNextPage &&
    pages.every((page) => page.dataState !== 'unavailable' && page.data.items.length === 0);
  return (
    <>
      {recoverableNext ? (
        <DataState
          state="error"
          message="โหลดรายการรายได้เพิ่มเติมไม่สำเร็จ กรุณาลองอีกครั้ง"
          onRetry={retry}
        />
      ) : (
        <ContentState
          pending={query.isPending}
          error={query.error}
          retry={retry}
          latestHref={reportHref(props.routes.overview, { ...props.context, generation: null })}
        />
      )}
      {showPages && pages.length > 0 && (
        <>
          <div className={styles.earningRows}>
            {pages.map((data, index) => (
              <DataEnvelope key={index} data={data} showFreshness={false}>
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
                    {line.reason && <p>{line.reason}</p>}
                    <details>
                      <summary>เงื่อนไขค่าคอมมิชชัน</summary>
                      {line.eligibleBase && line.ratePpm !== null ? (
                        <p>
                          คิดค่าคอมมิชชัน {line.ratePpm / 10000}% จากยอดขายที่เข้าเงื่อนไข{' '}
                          <Money value={line.eligibleBase} />
                        </p>
                      ) : (
                        <p>
                          {line.kind === 'fixed-fee'
                            ? 'ค่าจ้างเป็นจำนวนเงินคงที่ตามข้อตกลง ไม่คำนวณเป็นเปอร์เซ็นต์ของยอดขาย'
                            : line.kind === 'bonus'
                              ? 'โบนัสเป็นจำนวนเงินตามเงื่อนไขของรายการ ไม่คำนวณเป็นเปอร์เซ็นต์ของยอดขาย'
                              : 'รายการนี้ปรับยอดรายได้เดิมตามเหตุผลที่ระบุไว้'}
                        </p>
                      )}
                    </details>
                  </article>
                ))}
              </DataEnvelope>
            ))}
          </div>
          {empty && (
            <DataState
              state="empty"
              message="ยังไม่มีรายการรายได้ที่จับคู่กับคลิปนี้ในช่วงที่เลือก"
            />
          )}
          {query.isFetchingNextPage && (
            <DataState state="loading" message="กำลังโหลดรายการรายได้เพิ่มเติม" />
          )}
        </>
      )}
    </>
  );
}
