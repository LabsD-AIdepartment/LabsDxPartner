'use client';
import { partnerFilters } from '@/shared/config/partner-features';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Text } from '@/shared/ui/Text';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { FilterBar } from '@/shared/ui/FilterBar';
import { PageTitleActions } from '@/shared/ui/PageTitleActions';
import { DataState } from '@/shared/ui/DataState';
import { Dialog } from '@/shared/ui/Dialog';
import { DialogActions } from '@/shared/ui/DialogActions';
import {
  changeReportFilters,
  reportHref,
  validContentFilters,
  type ReportContext,
} from '@/shared/routing/report-context';
import { ContentCard } from './ContentCard';
import { useContentLibrary } from './useContent';
import { ContentState, DataEnvelope } from './ContentState';
import type { ContentProps } from './types';
import styles from './content.module.css';

const SEARCH_DEBOUNCE_MS = 250;

export function ContentList(
  props: ContentProps & {
    brands: string[];
    onChange: (c: ReportContext) => void;
  },
) {
  const { routes, onChange } = props;
  const c = partnerFilters({ ...props.context, cursor: null, history: [] });
  const [search, setSearch] = useState(c.q);
  const [composing, setComposing] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searchExpanded) searchInput.current?.focus();
  }, [searchExpanded]);
  function closeSearch() {
    const trigger = searchTrigger.current;
    if (!trigger || getComputedStyle(trigger).display === 'none') return;
    setSearchExpanded(false);
    trigger.focus();
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => setSearch(props.context.q), [props.context.q]);
  useEffect(() => {
    if (composing || search.trim() === props.context.q) return;
    const timer = setTimeout(() => {
      onChange(changeReportFilters(props.context, { q: search.trim() }));
    }, SEARCH_DEBOUNCE_MS);
    searchTimer.current = timer;
    return () => clearTimeout(timer);
  }, [search, composing, props.context, onChange]);
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
      <PageTitleActions fallbackClassName={styles.filters}>
        <FilterBar
          compact
          value={c}
          brands={data?.brands ?? props.brands}
          onChange={(v) => onChange(changeReportFilters(c, v))}
          onExport={() => setExportOpen(true)}
        />
      </PageTitleActions>
      <Card className={styles.libraryCard}>
        <div className={styles.libraryHeader}>
          <Text as="h2" variant="cardTitle">
            Your content library
          </Text>
          <Button
            icon
            ref={searchTrigger}
            className={styles.searchTrigger}
            aria-label={search.trim() ? `ค้นหาคลิป: ${search.trim()}` : 'เปิดช่องค้นหาคลิป'}
            aria-expanded={searchExpanded}
            aria-controls="content-search-form"
            onClick={() => {
              if (searchExpanded) closeSearch();
              else setSearchExpanded(true);
            }}
          >
            <Search size={20} aria-hidden />
            {search.trim() && <span className={styles.searchActive} aria-hidden />}
          </Button>
          <form
            id="content-search-form"
            className={styles.search}
            data-expanded={searchExpanded}
            onKeyDown={(event) => {
              if (
                event.key === 'Escape' &&
                searchExpanded &&
                !composing &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                closeSearch();
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              if (composing) return;
              clearTimeout(searchTimer.current);
              onChange(changeReportFilters(c, { q: search.trim() }));
            }}
          >
            <div>
              <input
                ref={searchInput}
                id="content-search"
                aria-label="ค้นหาคลิปหรือแบรนด์"
                type="search"
                maxLength={160}
                value={search}
                onFocus={() => setSearchExpanded(true)}
                onChange={(e) => setSearch(e.target.value)}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                placeholder="ชื่อคลิปหรือแบรนด์"
              />
              {search && (
                <Button
                  icon
                  aria-label="ล้างคำค้น"
                  onClick={() => {
                    setSearch('');
                    searchInput.current?.focus();
                  }}
                >
                  <X size={18} aria-hidden />
                </Button>
              )}
              <Button type="submit">
                <Search size={16} />
                ค้นหา
              </Button>
            </div>
          </form>
        </div>
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
        {data && query.isFetching && !query.isFetchingNextPage && !query.error && (
          <p className="small muted" role="status">
            กำลังอัปเดตข้อมูล…
          </p>
        )}
        {data && !query.error && (
          <DataEnvelope data={data} showFreshness={false}>
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
              <DataState state="empty" message="ไม่พบคลิปที่ตรงกับคำค้นหรือแบรนด์ที่เลือก" />
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
      <Dialog
        density="compact"
        title="Export report"
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      >
        <p>การดาวน์โหลดรายงานจะเปิดพร้อมหน้ารายการจ่ายเงิน ขณะนี้ยังไม่มีไฟล์รายงานจากข้อมูลจริง</p>
        <DialogActions>
          <Button onClick={() => setExportOpen(false)}>กลับไปดูคลิป</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
