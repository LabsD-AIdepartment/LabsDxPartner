'use client';
import { Card } from '@/shared/ui/Card';
import { LinkButton } from '@/shared/ui/LinkButton';
import { DataState } from '@/shared/ui/DataState';
import { reportHref, validContentFilters } from '@/shared/routing/report-context';
import { timestamp } from '@/shared/ui/format-date';
import { useContent } from './useContent';
import { ContentState, DataEnvelope } from './ContentState';
import { MetricSections } from './MetricDefinition';
import { adStatus } from './AdList';
import type { ContentProps } from './types';
import styles from './content.module.css';
export function AdDetail(props: ContentProps & { contentId: string; adId: string }) {
  const query = useContent(props.transport, {
    scope: props.scope,
    context: props.context,
    resource: 'ad',
    contentId: props.contentId,
    adId: props.adId,
  });
  const data = query.data;
  return (
    <div className={styles.page}>
      <LinkButton
        href={reportHref(
          `${props.routes.content}/${encodeURIComponent(props.contentId)}`,
          props.context,
        )}
      >
        ← กลับรายละเอียดคลิป
      </LinkButton>
      {!validContentFilters(props.context) ? (
        <DataState state="error" message="ช่วงเวลาหรือรุ่นข้อมูลไม่ถูกต้อง" />
      ) : (
        <ContentState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
          latestHref={reportHref(props.routes.overview, { ...props.context, generation: null })}
        />
      )}
      {data && !query.error && (
        <DataEnvelope data={data}>
          <Card
            title={data.data.title}
            description={`${adStatus[data.data.status]} · สถานะ ณ ${timestamp(data.data.asOf)}`}
          >
            <p className={styles.notice}>
              ผลโฆษณาจากแพลตฟอร์ม · คอมมิชชันแสดงที่หน้าคลิป และไม่ถูกนับซ้ำต่อโฆษณา
            </p>
            <MetricSections metrics={data.data.metrics} canViewAdSpend={props.canViewAdSpend} />
          </Card>
        </DataEnvelope>
      )}
    </div>
  );
}
