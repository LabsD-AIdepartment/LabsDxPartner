'use client';
import { partnerFilters } from '@/shared/config/partner-features';
import { PlatformSalesChart } from './PlatformSalesChart';
import { PageTitleActions } from '@/shared/ui/PageTitleActions';
import { ActionArrow } from '@/shared/ui/ActionArrow';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { OverviewReportInput } from './report-export';
import forms from '@/shared/ui/forms.module.css';
import { useQuery } from '@tanstack/react-query';
import { type QueryScope, partnerKey } from '@/shared/query/keys';
import { changeMeta } from '@/shared/query/invalidate-changes';
import { FilterBar, type FilterValue } from '@/shared/ui/FilterBar';
import { DataState } from '@/shared/ui/DataState';
import { overviewPageStatus } from './overview-status';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { DialogActions } from '@/shared/ui/DialogActions';
import { Money } from '@/shared/ui/Money';
import { useWeeklyEarnings, WeeklyEarningsView } from './WeeklyEarningsChart';
import { EarningsSummary, type PartnerPresentation } from './EarningsSummary';
import { EarningMix } from './EarningMix';
import { PayoutSummary } from './PayoutSummary';
import { TopContent } from './TopContent';
import {
  earningsHref,
  defaultOverviewFilters,
  loadOverview,
  validateFilters,
  type OverviewTransport,
} from './model';
import styles from './overview.module.css';
import { SourceUnavailableError } from '@/shared/query/source-unavailable';
import { UnavailableOverview } from './UnavailableOverview';
import { CoverageNotice } from '@/shared/ui/CoverageNotice';
import { AccessLost } from '@/shared/query/revision-watcher';
import { LinkButton } from '@/shared/ui/LinkButton';
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
type ReportReview = {
  input: OverviewReportInput;
  source: OverviewReportInput['data'];
  identity: string;
};

export function OverviewPage({
  scope,
  transport,
  brands,
  initialFilters = defaultOverviewFilters,
  partner,
  contentBasePath,
  transactionsBasePath,
  overviewBasePath = '/overview',
  controlledFilters,
  renderPayout,
  weeklyEarningsOverride,
}: {
  scope: QueryScope;
  transport: OverviewTransport;
  brands: string[];
  initialFilters?: FilterValue;
  partner?: PartnerPresentation;
  contentBasePath?: string;
  transactionsBasePath?: string;
  overviewBasePath?: string;
  controlledFilters?: { value: FilterValue; onChange: (value: FilterValue) => void };
  renderPayout?: (className: string) => ReactNode;
  /**
   * Opt-in, development-only sample feed for the Daily Clip Earnings weekly card only. Isolated by a
   * unique cache identity; it never affects the general Overview query, headline, export or payout.
   */
  weeklyEarningsOverride?: { transport: OverviewTransport; cacheKey: string; notice: string; refetchIntervalMs?: number };
}) {
  const [localFilters, setLocalFilters] = useState(initialFilters);
  const filters = partnerFilters(controlledFilters?.value ?? localFilters);
  const setFilters = controlledFilters?.onChange ?? setLocalFilters;
  const [report, setReport] = useState<ReportReview | null>(null);
  const [exportBusy, setExportBusy] = useState<'csv' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportJob = useRef<AbortController | null>(null);
  const valid = validateFilters(filters);
  const query = useQuery({
    meta: changeMeta('earnings', 'settlements', 'metrics'),
    queryKey: partnerKey(scope, 'earnings', 'overview', filters),
    queryFn: ({ signal }) => loadOverview(transport, { scope, filters, signal }),
    enabled: valid,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const weekly = useWeeklyEarnings(
    { scope, transport, brand: filters.brand, override: weeklyEarningsOverride },
    valid,
  );
  const revealed = useRef(false);
  const data = query.data;
  // On initial entry, cards/charts arrive together after concurrent reads settle.
  // Later week navigation stays inside its own card, without blanking the page.
  const waitingForCharts = !!data && !revealed.current && weekly.query.isPending;
  useEffect(() => {
    if (data && !weekly.query.isPending) revealed.current = true;
  }, [data, weekly.query.isPending]);
  const pageStatus = data ? overviewPageStatus(data) : null;
  const reportIdentity = JSON.stringify([scope, filters.from, filters.toExclusive, filters.brand]);
  const exportReady =
    valid &&
    query.isSuccess &&
    !query.isFetching &&
    !query.isError &&
    data?.dataState !== 'stale' &&
    data?.dataState !== 'unavailable';
  const reviewCurrent =
    !!report && exportReady && report.source === data && report.identity === reportIdentity;
  const latest = useRef({ identity: reportIdentity, data, ready: exportReady });
  latest.current = { identity: reportIdentity, data, ready: exportReady };
  useLayoutEffect(
    () => () => {
      exportJob.current?.abort();
      exportJob.current = null;
    },
    [],
  );
  useLayoutEffect(() => {
    if (report && !reviewCurrent) {
      exportJob.current?.abort();
      exportJob.current = null;
      setReport(null);
      setExportBusy(null);
      setExportError(null);
    }
  }, [report, reviewCurrent]);
  const closeReport = () => {
    exportJob.current?.abort();
    exportJob.current = null;
    setReport(null);
    setExportBusy(null);
    setExportError(null);
  };
  const download = async (format: 'csv' | 'pdf') => {
    if (!report || !reviewCurrent || exportJob.current) return;
    const current = report;
    const job = new AbortController();
    exportJob.current = job;
    setExportBusy(format);
    setExportError(null);
    try {
      const { downloadOverviewReport } = await import('./report-export');
      if (
        job.signal.aborted ||
        exportJob.current !== job ||
        !latest.current.ready ||
        latest.current.identity !== current.identity ||
        latest.current.data !== current.source
      )
        return;
      await downloadOverviewReport(current.input, format, job.signal);
      if (!job.signal.aborted && exportJob.current === job) setReport(null);
    } catch {
      if (!job.signal.aborted && exportJob.current === job)
        setExportError('ดาวน์โหลดรายงานไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      if (exportJob.current === job) {
        exportJob.current = null;
        setExportBusy(null);
      }
    }
  };
  if (query.error instanceof AccessLost)
    return (
      <>
        <DataState
          state="error"
          message="สิทธิ์เข้าถึงข้อมูลเปลี่ยนแล้ว กรุณาเข้าสู่ระบบอีกครั้ง"
        />
        <LinkButton href="/login">ไปหน้าเข้าสู่ระบบ</LinkButton>
      </>
    );
  const presentation = data?.profile
    ? {
        ...data.profile,
        greeting: data.profile.name.startsWith('คุณ')
          ? data.profile.name
          : `คุณ ${data.profile.name}`,
      }
    : partner;
  return (
    <>
      <PageTitleActions fallbackClassName={styles.toolbar}>
        <FilterBar
          compact
          value={filters}
          brands={data?.brands ?? brands}
          onChange={setFilters}
          exportDisabled={!exportReady}
          onExport={() => {
            if (!exportReady || !data) return;
            setReport({
              identity: reportIdentity,
              source: data,
              input: freezeSnapshot({
                data: structuredClone(data),
                filters: { ...filters },
                partnerName: presentation?.name ?? 'พาร์ทเนอร์',
              }),
            });
            setExportError(null);
          }}
        />
      </PageTitleActions>
      {!valid ? (
        <DataState
          state="error"
          message="เลือกช่วงวันที่ 1–366 วัน โดยวันสิ้นสุดต้องอยู่หลังวันเริ่มต้น"
        />
      ) : query.isPending || waitingForCharts ? (
        <DataState state="loading" />
      ) : query.error instanceof SourceUnavailableError && !data ? (
        <UnavailableOverview partner={presentation} />
      ) : query.isError && !data ? (
        <DataState state="error" onRetry={() => void query.refetch()} />
      ) : (
        data && (
          <>
            {query.isFetching && (
              <div className={styles.freshness} role="status">
                กำลังอัปเดตข้อมูล…
              </div>
            )}
            {query.isError && (
              <DataState
                state="stale"
                message="อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลครั้งล่าสุด"
                onRetry={() => void query.refetch()}
              />
            )}
            {pageStatus!.state !== 'ready' && (
              <DataState
                state={pageStatus!.state}
                message={pageStatus!.reasons.join(' · ') || undefined}
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
                    title="Clip Driven Sales"
                    description="ยอดขายจากคลิปของคุณ"
                    action={<ActionArrow />}
                  >
                    <Money value={data.earnings.eligibleSales} className={styles.largeMoney} />
                    <PlatformSalesChart earnings={data.earnings} />
                  </Card>
                  {renderPayout ? (
                    renderPayout(styles.payout)
                  ) : (
                    <PayoutSummary
                      data={data}
                      basePath={transactionsBasePath}
                      returnTo={earningsHref(overviewBasePath, data, filters)}
                    />
                  )}
                  <Card className={styles.trend}>
                    <WeeklyEarningsView model={weekly} />
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
      <Dialog density="compact" open={reviewCurrent} onClose={closeReport} title="Export report">
        <div className={forms.form} aria-busy={!!exportBusy}>
          <p>เลือกรูปแบบรายงาน</p>
          <DialogActions>
            <Button disabled={!reviewCurrent || !!exportBusy} onClick={() => void download('csv')}>
              ดาวน์โหลด CSV
            </Button>
            <Button disabled={!reviewCurrent || !!exportBusy} onClick={() => void download('pdf')}>
              ดาวน์โหลด PDF
            </Button>
          </DialogActions>
          {exportBusy && <p role="status">กำลังเตรียม {exportBusy.toUpperCase()}…</p>}
          {exportError && <p role="alert">{exportError}</p>}
        </div>
      </Dialog>
    </>
  );
}
