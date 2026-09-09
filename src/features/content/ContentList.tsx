'use client';
import { useEffect, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { FilterBar } from '@/shared/ui/FilterBar';
import { DataState } from '@/shared/ui/DataState';
import { Dialog } from '@/shared/ui/Dialog';
import {
  changeReportFilters,
  initialReportContext,
  reportHref,
  validContentFilters,
  type ReportContext,
} from '@/shared/routing/report-context';
import { ContentCard } from './ContentCard';
import { useContentLibrary } from './useContent';
import { ContentState, DataEnvelope } from './ContentState';
import type { ContentProps } from './types';
import styles from './content.module.css';
export function ContentList(
  props: ContentProps & {
    brands: string[];
    onChange: (c: ReportContext) => void;
    resetContext?: ReportContext;
  },
) {
  const { routes, onChange } = props;
  const c = { ...props.context, cursor: null, history: [] };
  const [search, setSearch] = useState(c.q);
  const [exportOpen, setExportOpen] = useState(false);
  const query = useContentLibrary(props.transport, { scope: props.scope, context: c });
  const data = query.data?.pages[0];
  const clips =
    query.data?.pages.flatMap((page) =>
      page.dataState === 'unavailable' ? [] : page.data.items,
    ) ?? [];
  useEffect(() => {
    if (query.hasNextPage && !query.isFetching && !query.error) void query.fetchNextPage();
  }, [query.hasNextPage, query.isFetching, query.error, query.fetchNextPage]);
  const selected = data ? { ...c, generation: data.generation } : c;
  return (
    <>
      <div className={styles.filters}>
        <FilterBar
          value={c}
          brands={props.brands}
          onChange={(v) => onChange(changeReportFilters(c, v))}
          onReset={() => {
            setSearch('');
            onChange({
              ...(props.resetContext ?? initialReportContext),
              q: '',
              brand: null,
              cursor: null,
              history: [],
              generation: null,
            });
          }}
          onExport={() => setExportOpen(true)}
          actions={
            <Button
              icon
              aria-label="อัปเดตคลังคลิป"
              disabled={query.isFetching || !validContentFilters(c)}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={18} />
            </Button>
          }
        />
      </div>
      <Card className={styles.libraryCard} title="Your content library">
        <form
          className={styles.search}
          onSubmit={(e) => {
            e.preventDefault();
            onChange(changeReportFilters(c, { q: search.trim() }));
          }}
        >
          <div>
            <input
              id="content-search"
              aria-label="ค้นหาคลิปหรือแบรนด์"
              type="search"
              maxLength={160}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ชื่อคลิปหรือแบรนด์"
            />
            <Button type="submit">
              <Search size={16} />
              ค้นหา
            </Button>
          </div>
        </form>
        {!validContentFilters(c) ? (
          <DataState
            state="error"
            message="เลือกช่วงวันที่ 1–366 วัน และคำค้นไม่เกิน 160 ตัวอักษร"
          />
        ) : (
          <ContentState
            pending={query.isPending}
            error={query.error}
            retry={() => void query.refetch()}
            latestHref={reportHref(routes.overview, { ...c, generation: null })}
          />
        )}
        {data && !query.error && (
          <DataEnvelope data={data} showFreshness={false}>
            <p className={styles.meta}>
              {data.data.totalCount === null ? 'รายการคลิป' : `${data.data.totalCount} คลิป`} ·
              รายได้ตามวันที่เกิดรายการ ไม่ใช่ยอดตลอดอายุคลิป
            </p>
            {clips.length ? (
              <div className={styles.library}>
                {clips.map((clip) => (
                  <ContentCard
                    key={clip.id}
                    clip={clip}
                    href={reportHref(`${routes.content}/${encodeURIComponent(clip.id)}`, {
                      ...selected,
                      origin: 'content',
                    })}
                  />
                ))}
              </div>
            ) : (
              <DataState state="empty" message="ไม่พบคลิปในช่วงเวลาและตัวกรองนี้" />
            )}
            {query.isFetchingNextPage && (
              <DataState state="loading" message="กำลังโหลดคลิปเพิ่มเติม" />
            )}
            {query.data?.pages
              .slice(1)
              .filter((page) => page.dataState !== 'ready')
              .map((page, index) => (
                <DataState
                  key={index}
                  state={page.dataState}
                  message={page.reasons.join(' · ') || undefined}
                />
              ))}
          </DataEnvelope>
        )}
      </Card>
      <Dialog title="Export report" open={exportOpen} onClose={() => setExportOpen(false)}>
        <p>การดาวน์โหลดรายงานจะเปิดพร้อมหน้ารายการจ่ายเงิน ขณะนี้ยังไม่มีไฟล์รายงานจากข้อมูลจริง</p>
        <Button onClick={() => setExportOpen(false)}>กลับไปดูคลิป</Button>
      </Dialog>
    </>
  );
}
