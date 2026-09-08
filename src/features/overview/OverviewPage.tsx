'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { type QueryScope, partnerKey } from '@/shared/query/keys';
import { FilterBar, type FilterValue } from '@/shared/ui/FilterBar';
import { DataState } from '@/shared/ui/DataState';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { Money } from '@/shared/ui/Money';
import { TrendChart } from '@/shared/charts/TrendChart';
import { EarningsSummary } from './EarningsSummary';
import { PayoutSummary } from './PayoutSummary';
import { TopContent } from './TopContent';
import {
  defaultOverviewFilters,
  loadOverview,
  validateFilters,
  timestamp,
  type OverviewTransport,
} from './model';
import styles from './overview.module.css';
export function OverviewPage({
  scope,
  transport,
  brands,
  initialFilters = defaultOverviewFilters,
}: {
  scope: QueryScope;
  transport: OverviewTransport;
  brands: string[];
  initialFilters?: FilterValue;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [exportOpen, setExportOpen] = useState(false);
  const valid = validateFilters(filters);
  const query = useQuery({
    queryKey: partnerKey(scope, 'earnings', 'overview', filters),
    queryFn: ({ signal }) => loadOverview(transport, { scope, filters, signal }),
    enabled: valid,
  });
  const data = query.data;
  return (
    <>
      <div className={styles.toolbar}>
        <FilterBar
          value={filters}
          brands={brands}
          onChange={setFilters}
          onReset={() => setFilters(initialFilters)}
          onExport={() => setExportOpen(true)}
        />
        <Button
          icon
          aria-label="อัปเดตข้อมูลภาพรวม"
          disabled={!valid || query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={18} aria-hidden />
        </Button>
      </div>
      {!valid ? (
        <DataState
          state="error"
          message="เลือกช่วงวันที่ 1–366 วัน โดยวันสิ้นสุดต้องอยู่หลังวันเริ่มต้น"
        />
      ) : query.isPending ? (
        <DataState state="loading" />
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
            {data.dataState !== 'unavailable' && (
              <>
                <div className={styles.grid}>
                  <EarningsSummary data={data} filters={filters} />
                  <Card
                    title="Sales in motion"
                    description="ยอดขายที่เข้าเงื่อนไขคอมมิชชันในช่วงที่เลือก"
                  >
                    <Money value={data.earnings.eligibleSales} className={styles.largeMoney} />
                    <p className="small muted">ใช้เป็นฐานคำนวณรายได้ ไม่ใช่ยอดเงินที่จะได้รับ</p>
                  </Card>
                  <PayoutSummary data={data} />
                  <Card
                    className={styles.trend}
                    title="Every clip counts"
                    description="คอมมิชชันยืนยันตามวันที่เกิดรายได้ รวมรายการปรับปรุง"
                  >
                    <TrendChart points={data.earnings.trend} />
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
                  </Card>
                </div>
                <TopContent data={data} filters={filters} />
              </>
            )}
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
