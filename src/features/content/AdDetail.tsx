'use client';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';
import { Card } from '@/shared/ui/Card';
import { BackLink } from '@/shared/ui/BackLink';
import { DataState } from '@/shared/ui/DataState';
import { reportHref, validContentFilters } from '@/shared/routing/report-context';
import { timestamp } from '@/shared/ui/format-date';
import { useContent } from './useContent';
import { ContentState, DataEnvelope } from './ContentState';
import { MetricSections } from './MetricDefinition';
import { adStatus } from './AdList';
import type { ContentProps } from './types';
import styles from './content.module.css';
import { AdPerformance } from './AdPerformance';
export function AdDetail(props: ContentProps & { contentId: string; adId: string }) {
  const query = useContent(props.transport, {
    scope: props.scope,
    context: props.context,
    resource: 'ad',
    contentId: props.contentId,
    adId: props.adId,
  });
  const data = query.data;
  const { showConnectedAds = true } = useApplicationPresentation();
  return (
    <div className={styles.page}>
      <BackLink
        label="กลับรายละเอียดคลิป"
        href={reportHref(
          `${props.routes.content}/${encodeURIComponent(props.contentId)}`,
          props.context,
        )}
      />
      {!showConnectedAds ? (
        <p>รายละเอียดโฆษณายังไม่เปิดแสดง</p>
      ) : !validContentFilters(props.context) ? (
        <DataState state="error" message="ช่วงเวลาหรือรุ่นข้อมูลไม่ถูกต้อง" />
      ) : (
        <ContentState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
          latestHref={reportHref(props.routes.overview, { ...props.context, generation: null })}
        />
      )}
      {showConnectedAds && data && !query.error && (
        <DataEnvelope data={data} periodLabel="ช่วงข้อมูลโฆษณา">
          <Card
            title={data.data.title}
            description={
              data.data.status === 'unknown'
                ? adStatus.unknown
                : `${adStatus[data.data.status]} · สถานะ ณ ${timestamp(data.data.asOf)}`
            }
          >
            <p className={styles.notice}>
              ผลโฆษณาจากแพลตฟอร์ม · คอมมิชชันแสดงที่หน้าคลิป และไม่ถูกนับซ้ำต่อโฆษณา
            </p>
            {data.data.performance ? (
              <AdPerformance
                performance={data.data.performance}
                canViewAdSpend={props.canViewAdSpend}
              />
            ) : (
              <MetricSections metrics={data.data.metrics} canViewAdSpend={props.canViewAdSpend} />
            )}
          </Card>
        </DataEnvelope>
      )}
    </div>
  );
}
