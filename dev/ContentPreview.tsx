'use client';
import {
  DatasetBoundary,
  DatasetQueryRefresh,
  useOptionalDemoSession,
} from './demo-dataset/DatasetBoundary';
import { PreviewTools } from './PreviewTools';
import { previewVideoRead } from './shop-video-transport';
import { useMemo, useState } from 'react';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';
import { useRouter } from 'next/navigation';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { PartnerShell } from '@/features/shell/PartnerShell';
import { ContentList } from '@/features/content/ContentList';
import { ContentDetail } from '@/features/content/ContentDetail';
import { AdDetail } from '@/features/content/AdDetail';
import { readReportContext, reportNavigationHrefs } from '@/shared/routing/report-context';
import { useReportState } from '@/shared/routing/useReportState';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { usePreviewAccountSettings, accountManagementPreviewHref } from './AccountSettingsPreview';
import { noticeAllowed } from '@/features/account/settings-model';
import { readyScenario } from './scenarios/ready';
import { createContentTransport, type ContentMode } from './content-transport';
import { isPreviewIdentity, previewScopeFor, withdrawalLaneHref } from './withdrawals/navigation';
import styles from './access-preview.module.css';
const legacyScope = {
  userId: 'preview-user',
  partnerId: 'preview-partner',
  permissionRevision: '1',
};
export function ContentPreview({
  segments = [],
  search = '',
}: {
  segments?: string[];
  search?: string;
}) {
  const demoIdentity =
    segments[0] === 'partner-demo' && isPreviewIdentity(segments[1]) ? segments[1] : null;
  const content = <ContentPreviewContent segments={segments} search={search} />;
  return demoIdentity ? (
    <DatasetBoundary key={demoIdentity} identities={[demoIdentity]}>
      {content}
    </DatasetBoundary>
  ) : (
    content
  );
}

function ContentPreviewContent({ segments, search }: { segments: string[]; search: string }) {
  const demoIdentity =
    segments[0] === 'partner-demo' && isPreviewIdentity(segments[1]) ? segments[1] : null;
  const session = useOptionalDemoSession(demoIdentity ?? 'a', Boolean(demoIdentity));
  const routeSegments = demoIdentity ? segments.slice(2) : segments;
  const routes = demoIdentity
    ? {
        content: `/content-preview/partner-demo/${demoIdentity}`,
        overview: `/withdrawal-preview?scenario=partner-demo&identity=${demoIdentity}`,
      }
    : { content: '/content-preview', overview: '/overview-preview' };
  const scope =
    session?.scope ?? (demoIdentity ? previewScopeFor('partner-demo', demoIdentity) : legacyScope);
  const [selectedMode, setMode] = useState<ContentMode>('ready');
  const mode = demoIdentity ? 'partner-demo' : selectedMode;
  const [spend, setSpend] = useState(false);
  const [notices, setNotices] = useState(() => readyScenario().notifications);
  const router = useRouter();
  const { resolveHref } = useApplicationPresentation();
  const reportParams = new URLSearchParams(search);
  if (demoIdentity && !reportParams.has('from') && !reportParams.has('toExclusive'))
    reportParams.set('toExclusive', '2026-10-01');
  const [context, changeContext] = useReportState(
    readReportContext(reportParams),
    JSON.stringify([scope, spend, segments]),
    routes.content,
  );
  const transport = useMemo(
    () => session?.content ?? createContentTransport(mode),
    [mode, session],
  );
  const props = {
    scope: demoIdentity ? scope : { ...scope, permissionRevision: spend ? '2' : '1' },
    context,
    transport,
    routes,
    canViewAdSpend: demoIdentity ? false : spend,
    shopVideoTransport: mode === 'platform-v2' ? previewVideoRead : undefined,
  };
  const accountSettings = usePreviewAccountSettings(props.scope, demoIdentity ?? 'a');
  const navigation = reportNavigationHrefs(context, {
    ...routes,
    transactions: '/transactions-preview',
  });
  const demoLane = demoIdentity
    ? { scenario: 'partner-demo' as const, identity: demoIdentity, returnTo: navigation.overview }
    : null;
  const transactionsHref = demoLane
    ? withdrawalLaneHref('/transactions-preview', { ...demoLane, view: 'withdrawals' })
    : navigation.transactions;
  return (
    <>
      {!demoIdentity && (
        <PreviewTools toolbar>
          <aside className={styles.toolbar} aria-label="ชุดตรวจคลิป">
            <strong>Content journey preview</strong>
            <span>ข้อมูลจำลอง · ไม่มีข้อมูลพาร์ทเนอร์จริง</span>
            <label>
              สถานการณ์คลิป{' '}
              <select value={mode} onChange={(e) => setMode(e.target.value as ContentMode)}>
                {[
                  'ready',
                  'platform-v2',
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
        </PreviewTools>
      )}
      <PartnerShell
        accountHref={demoLane ? accountManagementPreviewHref(demoLane) : '/account-preview'}
        active="content"
        avatar="/media/celebrity-avatar.png"
        hrefs={{ ...navigation, transactions: transactionsHref }}
        footerNote={demoIdentity ? undefined : 'ตัวอย่างคลิป · ข้อมูลจำลอง'}
        notifications={
          <NotificationButton
            key={JSON.stringify(props.scope)}
            state={accountSettings.status}
            data={
              accountSettings.snapshot
                ? noticeAllowed('releases', accountSettings.snapshot.preferences)
                  ? notices
                  : { ...notices, items: [], unseenCount: 0 }
                : null
            }
            onSeen={(id) =>
              setNotices((old) => {
                const items = old.items.map((x) => (x.id === id ? { ...x, seen: true } : x));
                return { ...old, items, unseenCount: items.filter((x) => !x.seen).length };
              })
            }
            onOpenStatement={() =>
              router.push(resolveHref(demoIdentity ? transactionsHref : '/transactions-preview'))
            }
          />
        }
      >
        <ScopedQueryProvider key={`${mode}-${spend}`} scope={props.scope}>
          <DatasetQueryRefresh session={session} />
          {routeSegments.length === 3 ? (
            <AdDetail
              key={routeSegments.join('/') + search}
              {...props}
              contentId={routeSegments[0]}
              adId={routeSegments[2]}
            />
          ) : routeSegments.length === 1 ? (
            <ContentDetail
              key={routeSegments[0] + search}
              {...props}
              contentId={routeSegments[0]}
            />
          ) : (
            <ContentList
              {...props}
              brands={['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova']}
              onChange={changeContext}
            />
          )}
        </ScopedQueryProvider>
      </PartnerShell>
    </>
  );
}
