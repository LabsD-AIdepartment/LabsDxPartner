import { SourceUnavailableError } from '@/shared/query/source-unavailable';
import type { ReactNode } from 'react';
import { DataState } from '@/shared/ui/DataState';
import { LinkButton } from '@/shared/ui/LinkButton';
import { timestamp, dateLabel } from '@/shared/ui/format-date';
import { ContentError } from './model';
import { Text } from '@/shared/ui/Text';
import styles from './content.module.css';
import { AccessLost } from '@/shared/query/revision-watcher';
import { CoverageNotice } from '@/shared/ui/CoverageNotice';
import type { z } from 'zod';
import type { PeriodCoverage } from '@/contracts/coverage';
export function ContentState({
  pending,
  error,
  retry,
  latestHref,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => void;
  latestHref: string;
}) {
  if (error instanceof AccessLost)
    return (
      <>
        <DataState
          state="error"
          message="สิทธิ์เข้าถึงข้อมูลเปลี่ยนแล้ว กรุณาเข้าสู่ระบบอีกครั้ง"
        />
        <LinkButton href="/login">ไปหน้าเข้าสู่ระบบ</LinkButton>
      </>
    );
  if (error instanceof SourceUnavailableError)
    return <DataState state="unavailable" message={error.message} />;
  if (pending) return <DataState state="loading" />;
  if (error instanceof ContentError && error.code === 'generation_changed')
    return (
      <div className={styles.notice}>
        <DataState state="stale" message={error.message} />
        <LinkButton href={latestHref}>เปิดภาพรวมล่าสุด</LinkButton>
      </div>
    );
  if (error)
    return (
      <DataState
        state="error"
        message={
          error instanceof ContentError ? error.message : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง'
        }
        onRetry={retry}
      />
    );
  return null;
}
export function DataEnvelope({
  data,
  children,
  showFreshness = true,
}: {
  data: {
    dataState: 'ready' | 'partial' | 'stale' | 'unavailable';
    reasons: string[];
    dataThrough: string | null;
    generatedAt: string;
    period: { from: string; toExclusive: string };
    coverage?: z.infer<typeof PeriodCoverage>;
  };
  children: ReactNode;
  showFreshness?: boolean;
}) {
  return (
    <>
      {showFreshness && (
        <div className={styles.freshness}>
          <Text as="span" variant="caption" tone="muted">
            ช่วงรายได้ {dateLabel(data.period.from)} – ก่อน {dateLabel(data.period.toExclusive)}
          </Text>
          <Text as="span" variant="caption" tone="muted">
            ข้อมูลถึง {timestamp(data.dataThrough)}
          </Text>
        </div>
      )}
      {data.dataState !== 'ready' && (
        <DataState state={data.dataState} message={data.reasons.join(' · ') || undefined} />
      )}
      {data.coverage && <CoverageNotice coverage={data.coverage} />}
      {data.dataState !== 'unavailable' && children}
    </>
  );
}
