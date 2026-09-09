'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ArrowUpRight, Video } from 'lucide-react';
import { type QueryScope, partnerKey } from '@/shared/query/keys';
import { changeMeta } from '@/shared/query/invalidate-changes';
import { FilterBar, type FilterValue } from '@/shared/ui/FilterBar';
import { DataState } from '@/shared/ui/DataState';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { Money } from '@/shared/ui/Money';
import { TrendChart } from '@/shared/charts/TrendChart';
import { EarningsSummary, type PartnerPresentation } from './EarningsSummary';
import { BarChart } from '@/shared/charts/BarChart';
import { EarningMix } from './EarningMix';
import { PayoutSummary } from './PayoutSummary';
import { TopContent } from './TopContent';
import {
  earningsHref,
  defaultOverviewFilters,
  loadOverview,
  validateFilters,
  timestamp,
  type OverviewTransport,
} from './model';
import styles from './overview.module.css';
import { SourceUnavailableError } from '@/shared/query/source-unavailable';
import { UnavailableOverview } from './UnavailableOverview';
import { CoverageNotice } from '@/shared/ui/CoverageNotice';
import { AccessLost } from '@/shared/query/revision-watcher';
import { LinkButton } from '@/shared/ui/LinkButton';
export function OverviewPage({
  scope,
  transport,
  brands,
  initialFilters = defaultOverviewFilters,
  partner,
  contentBasePath,
  transactionsBasePath,
  overviewBasePath = '/overview',
}: {
  scope: QueryScope;
  transport: OverviewTransport;
  brands: string[];
  initialFilters?: FilterValue;
  partner?: PartnerPresentation;
  contentBasePath?: string;
  transactionsBasePath?: string;
  overviewBasePath?: string;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [exportOpen, setExportOpen] = useState(false);
  const valid = validateFilters(filters);
  const query = useQuery({
    meta: changeMeta('earnings', 'settlements', 'metrics'),
    queryKey: partnerKey(scope, 'earnings', 'overview', filters),
    queryFn: ({ signal }) => loadOverview(transport, { scope, filters, signal }),
    enabled: valid,
  });
  const data = query.data;
  if (query.error instanceof AccessLost) return <>
    <DataState state="error" message="สิทธิ์เข้าถึงข้อมูลเปลี่ยนแล้ว กรุณาเข้าสู่ระบบอีกครั้ง" />
    <LinkButton href="/login">ไปหน้าเข้าสู่ระบบ</LinkButton>
  </>;
  const presentation = data?.profile ? { ...data.profile, greeting: `คุณ ${data.profile.name}` } : partner;
  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.welcome}>
          สวัสดี {presentation?.greeting ?? 'คุณพาร์ทเนอร์'} <span>✦</span>
          <small>นี่คือผลงานของคุณ</small>
        </div>
        <FilterBar
          value={filters}
          brands={data?.brands ?? brands}
          onChange={setFilters}
          onReset={() => setFilters(initialFilters)}
          onExport={() => setExportOpen(true)}
          actions={
            <Button
              icon
              aria-label="อัปเดตข้อมูลภาพรวม"
              disabled={!valid || query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={18} aria-hidden />
            </Button>
          }
        />
      </div>
      {!valid ? (
        <DataState
          state="error"
          message="เลือกช่วงวันที่ 1–366 วัน โดยวันสิ้นสุดต้องอยู่หลังวันเริ่มต้น"
        />
      ) : query.isPending ? (
        <DataState state="loading" />
      ) : query.error instanceof SourceUnavailableError && !data ? (
        <UnavailableOverview partner={presentation} />
      ) : query.isError && !data ? (
        <DataState state="error" onRetry={() => void query.refetch()} />
      ) : (
        data && (
          <>
            <div className={styles.freshness}>
              <span>ข้อมูลรายได้ถึง {timestamp(data.dataThrough)}</span>
              <span>
                {query.isFetching
                  ? 'กำลังอัปเดตข้อมูล…'
                  : `ประมวลผล ${timestamp(data.generatedAt)}`}
              </span>
            </div>
            {query.isError && (
              <DataState
                state="stale"
                message="อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลครั้งล่าสุด"
                onRetry={() => void query.refetch()}
              />
            )}
            {data.dataState !== 'ready' && (
              <DataState
                state={data.dataState}
                message={data.reasons.join(' · ') || undefined}
                onRetry={() => void query.refetch()}
              />
            )}
            <CoverageNotice coverage={data.earnings.coverage} />
            <>
              <div className={styles.contentBands}>
                <div className={styles.grid}>
                  <EarningsSummary
                    data={data}
                    filters={filters}
                    partner={presentation}
                    contentBasePath={contentBasePath}
                  />
                  <Card
                    className={styles.sales}
                    title="Sales in motion"
                    description="ยอดขายที่เข้าเงื่อนไขคอมมิชชันในช่วงที่เลือก"
                    action={<ArrowUpRight size={18} aria-hidden />}
                  >
                    <Money value={data.earnings.eligibleSales} className={styles.largeMoney} />
                    {data.earnings.salesByBrand ? (
                      <BarChart items={data.earnings.salesByBrand} />
                    ) : (
                      <DataState state="unavailable" message="ยังไม่มีข้อมูลยอดขายแยกตามแบรนด์" />
                    )}
                    <div className={styles.cardBottom}>
                      <span>แยกตามแบรนด์</span>
                      <span>Eligible sales</span>
                    </div>
                    <p className="small muted">ใช้เป็นฐานคำนวณรายได้ ไม่ใช่ยอดเงินที่จะได้รับ</p>
                  </Card>
                  <PayoutSummary
                    data={data}
                    basePath={transactionsBasePath}
                    returnTo={earningsHref(overviewBasePath, data, filters)}
                  />
                  <Card
                    className={styles.trend}
                    title="Every clip counts"
                    description="คอมมิชชันยืนยันตามวันที่เกิดรายได้ รวมรายการปรับปรุง"
                  >
                    <div className={styles.trendSummary}>
                      <Money value={data.earnings.confirmed} />
                      <span>
                        <Video size={15} aria-hidden />
                        {data.earnings.contentCount ?? '—'} คลิปที่สร้างรายได้
                      </span>
                    </div>
                    {data.earnings.confirmed === null ? (
                      <DataState state="unavailable" message="ยังไม่มีข้อมูลคอมมิชชันรายวัน" />
                    ) : (
                      <TrendChart points={data.earnings.trend} coverage={data.earnings.coverage} />
                    )}
                    {data.earnings.trend.length > 0 && (
                      <details>
                        <summary>ดูตัวเลขรายวัน</summary>
                        <div className={styles.daily}>
                          {data.earnings.trend.map((point) => (
                            <div key={point.date}>
                              <span>{point.date}</span>
                              <Money value={point.amount} />
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </Card>
                </div>
                <div className={styles.lower}>
                  <TopContent data={data} filters={filters} contentBasePath={contentBasePath} />
                  <EarningMix data={data} />
                </div>
              </div>
            </>
          </>
        )
      )}
      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title="Export report">
        <p>
          การดาวน์โหลดรายงานจะเปิดพร้อมหน้ารายการจ่ายเงิน
          ขณะนี้ยังไม่มีไฟล์รายงานที่สร้างจากข้อมูลจริง
        </p>
        <Button onClick={() => setExportOpen(false)}>กลับไปดูภาพรวม</Button>
      </Dialog>
    </>
  );
}
