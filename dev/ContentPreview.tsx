'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { PartnerShell } from '@/features/shell/PartnerShell';
import { ContentList } from '@/features/content/ContentList';
import { ContentDetail } from '@/features/content/ContentDetail';
import { AdDetail } from '@/features/content/AdDetail';
import { readReportContext, reportHref, reportSearch } from '@/shared/routing/report-context';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { readyScenario } from './scenarios/ready';
import { createContentTransport, type ContentMode } from './content-transport';
import styles from './access-preview.module.css';
const scope = { userId: 'preview-user', partnerId: 'preview-partner', permissionRevision: '1' };
const routes = { content: '/content-preview', overview: '/overview-preview' };
export function ContentPreview({
  segments = [],
  search = '',
}: {
  segments?: string[];
  search?: string;
}) {
  const [mode, setMode] = useState<ContentMode>('ready');
  const [spend, setSpend] = useState(false);
  const [notices, setNotices] = useState(() => readyScenario().notifications);
  const router = useRouter();
  const context = readReportContext(new URLSearchParams(search));
  const transport = useMemo(() => createContentTransport(mode), [mode]);
  const props = {
    scope: { ...scope, permissionRevision: spend ? '2' : '1' },
    context,
    transport,
    routes,
    canViewAdSpend: spend,
  };
  return (
    <>
      <aside className={styles.toolbar} aria-label="ชุดตรวจคลิป">
        <strong>Content journey preview</strong>
        <span>ข้อมูลจำลอง · ไม่มีข้อมูลพาร์ทเนอร์จริง</span>
        <label>
          สถานการณ์คลิป{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as ContentMode)}>
            {[
              'ready',
              'empty',
              'partial',
              'stale',
              'unavailable',
              'adjustments',
              'removed',
              'error',
              'loading',
              'generation-changed',
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={spend} onChange={(e) => setSpend(e.target.checked)} />
          จำลองสิทธิ์ดูค่าโฆษณา
        </label>
      </aside>
      <PartnerShell
        active="content"
        avatar="/media/celebrity-avatar.png"
        hrefs={{
          overview: reportHref(routes.overview, context),
          content: reportHref(routes.content, context),
          transactions:
            '/transactions-preview?' +
            new URLSearchParams({ returnTo: reportHref(routes.content, context) }),
        }}
        footerNote="ตัวอย่างคลิป · ข้อมูลจำลอง"
        notifications={
          <NotificationButton
            data={notices}
            onSeen={(id) =>
              setNotices((old) => {
                const items = old.items.map((x) => (x.id === id ? { ...x, seen: true } : x));
                return { ...old, items, unseenCount: items.filter((x) => !x.seen).length };
              })
            }
            onOpenStatement={() => router.push('/transactions-preview')}
          />
        }
      >
        <ScopedQueryProvider key={`${mode}-${spend}`} scope={props.scope}>
          {segments.length === 3 ? (
            <AdDetail
              key={segments.join('/') + search}
              {...props}
              contentId={segments[0]}
              adId={segments[2]}
            />
          ) : segments.length === 1 ? (
            <ContentDetail key={segments[0] + search} {...props} contentId={segments[0]} />
          ) : (
            <ContentList
              key={reportSearch(context)}
              {...props}
              brands={['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova']}
              onChange={(c) => router.push(reportHref(routes.content, c), { scroll: false })}
            />
          )}
        </ScopedQueryProvider>
      </PartnerShell>
    </>
  );
}
