'use client';
import { PreviewTools } from './PreviewTools';
import {
  readReportContext,
  changeReportFilters,
  reportNavigationHrefs,
} from '@/shared/routing/report-context';
import { useReportState } from '@/shared/routing/useReportState';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PartnerShell } from '@/features/shell/PartnerShell';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { invalidateChanges } from '@/shared/query/invalidate-changes';
import { Button } from '@/shared/ui/Button';
import { createOverviewTransport, type OverviewScenario } from './overview-transport';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { readyScenario } from './scenarios/ready';
import { usePreviewPayment } from './preview-payment';
import styles from './access-preview.module.css';
const scope = { userId: 'preview-user', partnerId: 'preview-partner', permissionRevision: '1' };
export function OverviewPreview({ search = '' }: { search?: string }) {
  const [report, changeReport] = useReportState(
    { ...readReportContext(new URLSearchParams(search)), origin: 'overview' },
    JSON.stringify(scope),
    '/overview-preview',
  );
  const [mode, setMode] = useState<OverviewScenario | 'loading' | 'error'>('ready');
  const [paid, setPaid] = usePreviewPayment();
  const [notices, setNotices] = useState(() => readyScenario().notifications);
  const transport = useMemo(() => createOverviewTransport(mode, paid), [mode, paid]);
  return (
    <>
      <PreviewTools toolbar>
        <aside className={styles.toolbar} aria-label="ชุดตรวจ Overview">
          <strong>Overview journey preview</strong>
          <span>ข้อมูลจำลอง · ไม่มีข้อมูลพาร์ทเนอร์จริง</span>
          <label>
            สถานการณ์ภาพรวม{' '}
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              {[
                'ready',
                'empty',
                'partial',
                'partial-period',
                'confirmed-only',
                'stale',
                'unavailable',
                'adjustments',
                'loading',
                'error',
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <Button onClick={() => setPaid(!paid)}>
            {paid ? 'คืนสถานะก่อนจ่าย' : 'จำลองบันทึกจ่าย 10,000 บาท'}
          </Button>
        </aside>
      </PreviewTools>
      <PartnerShell
        accountHref="/account-preview"
        active="overview"
        hrefs={reportNavigationHrefs(report, {
          overview: '/overview-preview',
          content: '/content-preview',
          transactions: '/transactions-preview',
        })}
        footerNote="ตัวอย่าง Overview · ข้อมูลจำลอง"
        avatar="/media/celebrity-avatar.png"
        notifications={
          <NotificationButton
            data={notices}
            onSeen={(id) =>
              setNotices((current) => {
                const items = current.items.map((item) =>
                  item.id === id ? { ...item, seen: true } : item,
                );
                return {
                  ...current,
                  items,
                  unseenCount: items.filter((item) => !item.seen).length,
                };
              })
            }
            onOpenStatement={() => {
              window.location.href = '/transactions-preview';
            }}
          />
        }
      >
        <ScopedQueryProvider key={mode} scope={scope}>
          <OverviewPage
            key={search}
            contentBasePath="/content-preview"
            transactionsBasePath="/transactions-preview"
            overviewBasePath="/overview-preview"
            initialFilters={{
              from: report.from,
              toExclusive: report.toExclusive,
              brand: report.brand,
            }}
            controlledFilters={{
              value: { from: report.from, toExclusive: report.toExclusive, brand: report.brand },
              onChange: (value) =>
                changeReport({
                  ...changeReportFilters(report, value),
                  origin: 'overview',
                }),
            }}
            transport={transport}
            scope={scope}
            brands={['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova']}
            partner={{
              name: 'มดดำ คชาภา',
              greeting: 'คุณมดดำ',
              role: 'Celebrity partner',
              portrait: '/media/celebrity-thumbnail.png',
              avatar: '/media/celebrity-avatar.png',
            }}
          />
          <RefreshOnPayment paid={paid} />
        </ScopedQueryProvider>
      </PartnerShell>
    </>
  );
}

function RefreshOnPayment({ paid }: { paid: boolean }) {
  const client = useQueryClient();
  const previous = useRef(paid);
  useEffect(() => {
    if (previous.current === paid) return;
    previous.current = paid;
    void invalidateChanges(client, scope, ['settlements']);
  }, [paid, client]);
  return null;
}
