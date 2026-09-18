'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Video } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Text } from '@/shared/ui/Text';
import { TextGroup } from '@/shared/ui/TextGroup';
import { DataState } from '@/shared/ui/DataState';
import { LinkButton } from '@/shared/ui/LinkButton';
import { TrendChart } from '@/shared/charts/TrendChart';
import { addDays } from '@/shared/ui/date-range';
import { type QueryScope, partnerKey } from '@/shared/query/keys';
import { changeMeta } from '@/shared/query/invalidate-changes';
import { AccessLost } from '@/shared/query/revision-watcher';
import { SourceUnavailableError } from '@/shared/query/source-unavailable';
import { partnerFilters } from '@/shared/config/partner-features';
import { loadOverview, type OverviewTransport } from './model';
import { DailyEarnings } from './DailyEarnings';
import { bangkokDate, earningsWeekRange, weeklyEarningsPoints } from './weekly-earnings';
import styles from './weekly-earnings.module.css';

function useBangkokToday() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const date = bangkokDate(new Date());
      setToday(date);
      clearTimeout(timer);
      const nextMidnight = Date.parse(`${addDays(date, 1)}T00:00:00+07:00`);
      timer = setTimeout(refresh, Math.max(100, nextMidnight - Date.now() + 100));
    };
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return today;
}

/**
 * Optional development-only sample feed for the weekly card. When present the card renders the
 * supplied sample transport under a UNIQUE cache identity (its `cacheKey` is appended to the query
 * key) so it can never reuse — or be reused by — a general Overview query for the same date/brand,
 * and it labels the card as sample data. The product default path leaves everything untouched.
 */
type WeeklyEarningsOverride = {
  transport: OverviewTransport;
  cacheKey: string;
  notice: string;
};
type Props = {
  scope: QueryScope;
  transport: OverviewTransport;
  brand: string | null;
  override?: WeeklyEarningsOverride;
};
function WeeklyHeader({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.header}>
      <TextGroup className={styles.heading}>
        <Text as="h2" variant="cardTitle">
          Daily Clip Earnings
        </Text>
        <Text variant="caption" tone="muted">
          คอมมิชชันที่ยืนยันแล้ว (บาท)
        </Text>
      </TextGroup>
      {children}
    </div>
  );
}
/** Begin this read alongside the page read, before cards mount. */
export function useWeeklyEarnings({ scope, transport, brand, override }: Props, enabled = true) {
  const today = useBangkokToday();
  const identity = JSON.stringify([scope, brand, override?.cacheKey ?? null, today]);
  const [selection, setSelection] = useState({ identity, weeksBack: 0 });
  const weeksBack = selection.identity === identity ? selection.weeksBack : 0;
  const week = earningsWeekRange(today ?? '0001-01-01', weeksBack);
  const filters = partnerFilters({ from: week.from, toExclusive: week.toExclusive, brand });
  const source = override?.transport ?? transport;
  const baseKey = partnerKey(scope, 'earnings', 'overview', filters);
  const query = useQuery({
    meta: changeMeta('earnings', 'settlements', 'metrics'),
    queryKey: override ? [...baseKey, 'weekly-sample', override.cacheKey] : baseKey,
    queryFn: ({ signal }) => loadOverview(source, { scope, filters, signal }),
    enabled: enabled && today !== null,
  });
  return {
    today,
    week,
    query,
    override,
    setWeeksBack: (value: number) => setSelection({ identity, weeksBack: value }),
  };
}
export function WeeklyEarningsChart(props: Props) {
  const model = useWeeklyEarnings(props);
  return <WeeklyEarningsView model={model} />;
}
export function WeeklyEarningsView({ model }: { model: ReturnType<typeof useWeeklyEarnings> }) {
  return (
    <div className={styles.weekly}>
      {model.today ? (
        <Week model={model} />
      ) : (
        <>
          <WeeklyHeader />
          <DataState state="loading" message="กำลังโหลดคอมมิชชันรายวัน" />
        </>
      )}
    </div>
  );
}
function Week({ model }: { model: ReturnType<typeof useWeeklyEarnings> }) {
  const { week, query, override, setWeeksBack } = model;
  const data = query.data;
  const label = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatRange(
    new Date(`${week.from}T12:00:00Z`),
    new Date(`${addDays(week.toExclusive, -1)}T12:00:00Z`),
  );
  if (query.error instanceof AccessLost)
    return (
      <>
        <WeeklyHeader />
        <DataState
          state="error"
          message="สิทธิ์เข้าถึงข้อมูลเปลี่ยนแล้ว กรุณาเข้าสู่ระบบอีกครั้ง"
        />
        <LinkButton href="/login">ไปหน้าเข้าสู่ระบบ</LinkButton>
      </>
    );
  const earnings = data?.earnings ?? {
    trend: [],
    coverage: { status: 'unavailable' as const, periods: [] },
  };
  const points = weeklyEarningsPoints(earnings, week);
  const unavailable =
    query.error instanceof SourceUnavailableError || data?.earnings.confirmed === null;
  return (
    <>
      <WeeklyHeader>
        <div className={styles.navigation}>
          <Button
            icon
            aria-label="7 วันก่อนหน้า"
            disabled={!week.hasPrevious}
            onClick={() => setWeeksBack(week.page + 1)}
          >
            <ChevronLeft size={18} aria-hidden />
          </Button>
          <span aria-live="polite" className={styles.range}>
            {label}
          </span>
          <Button
            icon
            aria-label="7 วันถัดไป"
            disabled={!week.hasNext}
            onClick={() => setWeeksBack(week.page - 1)}
          >
            <ChevronRight size={18} aria-hidden />
          </Button>
        </div>
      </WeeklyHeader>
      {override && (
        <p className={styles.sample} role="note">
          ข้อมูลตัวอย่าง — {override.notice}
        </p>
      )}
      {query.isPending ? (
        <DataState state="loading" message="กำลังโหลดคอมมิชชันรายวัน" />
      ) : (
        <>
          {unavailable ? (
            <DataState
              state="unavailable"
              message="ยังไม่มีข้อมูลคอมมิชชันรายวัน"
              onRetry={() => void query.refetch()}
            />
          ) : query.isError ? (
            <DataState
              state={data ? 'stale' : 'error'}
              message="โหลดคอมมิชชันรายวันไม่สำเร็จ"
              onRetry={() => void query.refetch()}
            />
          ) : data?.dataState === 'stale' ? (
            <DataState
              state="stale"
              message="แสดงคอมมิชชันรายวันครั้งล่าสุด"
              onRetry={() => void query.refetch()}
            />
          ) : null}
          {data?.earnings.contentCount != null && (
            <div className={styles.count}>
              <Video size={16} aria-hidden />
              {data.earnings.contentCount} คลิปที่สร้างรายได้
            </div>
          )}
          <TrendChart
            points={points}
            coverage={earnings.coverage}
            showAxisCaption={false}
            compactAmounts
            showEveryDate
          />
          {data && (
            <DailyEarnings
              key={`${week.from}/${week.toExclusive}/${data.earnings.generation}`}
              points={data.earnings.trend}
            />
          )}
        </>
      )}
    </>
  );
}
