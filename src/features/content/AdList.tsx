'use client';
import { ActionArrow } from '@/shared/ui/ActionArrow';
import { useEffect } from 'react';
import Link from '@/shared/ui/AppLink';
import { DataState } from '@/shared/ui/DataState';
import { reportHref } from '@/shared/routing/report-context';
import { timestamp } from '@/shared/ui/format-date';
import { ContentState, DataEnvelope } from './ContentState';
import { useContentAds } from './useContentAds';
import { ContentError } from './model';
import { AccessLost } from '@/shared/query/revision-watcher';
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
  const query = useContentAds(props.transport, {
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
  const showPages = !query.error || (query.isFetchNextPageError && !unsafe);
  const empty =
    pages.length > 0 &&
    !query.hasNextPage &&
    pages.every((page) => page.dataState !== 'unavailable' && page.data.items.length === 0);
  const selected = pages[0] ? { ...props.context, generation: pages[0].generation } : props.context;
  const retry = () => {
    if (query.isFetchNextPageError && !unsafe) void query.fetchNextPage();
    else void query.refetch();
  };
  return (
    <>
      {query.isFetchNextPageError && !unsafe ? (
        <DataState
          state="error"
          message="โหลดโฆษณาเพิ่มเติมไม่สำเร็จ กรุณาลองอีกครั้ง"
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
          {pages.some((page) => page.dataState !== 'unavailable') && (
            <Text variant="caption" tone="muted" className={styles.meta}>
              หลายโฆษณาใช้คลิปเดียวกันได้ รายได้ของคลิปแสดงครั้งเดียว
              ไม่กระจายหรือคูณซ้ำตามจำนวนโฆษณา
            </Text>
          )}
          <div className={styles.adList}>
            {pages.map((data, index) => (
              <DataEnvelope key={index} data={data} showFreshness={false}>
                {data.data.items.map((ad) => (
                  <Link
                    key={ad.id}
                    href={reportHref(
                      `${props.routes.content}/${encodeURIComponent(props.contentId)}/ads/${encodeURIComponent(ad.id)}`,
                      selected,
                    )}
                  >
                    <div>
                      <strong>{ad.title}</strong>
                      <p>
                        {adStatus[ad.status]}
                        {ad.status !== 'unknown' && ` · สถานะ ณ ${timestamp(ad.asOf)}`}
                      </p>
                    </div>
                    <ActionArrow />
                  </Link>
                ))}
              </DataEnvelope>
            ))}
          </div>
          {empty && <DataState state="empty" message="ยังไม่มีโฆษณาที่เชื่อมกับคลิปนี้" />}
          {query.isFetchingNextPage && (
            <DataState state="loading" message="กำลังโหลดโฆษณาเพิ่มเติม" />
          )}
        </>
      )}
    </>
  );
}
