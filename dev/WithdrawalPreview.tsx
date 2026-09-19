'use client';
import { createDailyChartFillTransport } from './daily-chart-fill-transport';
import {
  DatasetBoundary,
  DatasetQueryRefresh,
  useOptionalDemoSession,
} from './demo-dataset/DatasetBoundary';
import { PreviewTools } from './PreviewTools';
import { PreviewNotifications } from './PreviewNotifications';
import { usePreviewAccountSettings, accountManagementPreviewHref } from './AccountSettingsPreview';
import { transactionHref } from '@/features/transactions/model';
import { useMemo, useState } from 'react';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { PartnerShell } from '@/features/shell/PartnerShell';
import { WithdrawalExperience } from '@/features/withdrawals/WithdrawalExperience';
import { ScopedQueryProvider } from '@/shared/query/provider';
import {
  changeReportFilters,
  readReportContext,
  reportNavigationHrefs,
  reportHref,
  validContentFilters,
} from '@/shared/routing/report-context';
import { useReportState } from '@/shared/routing/useReportState';
import { LinkButton } from '@/shared/ui/LinkButton';
import { createOverviewTransport } from './overview-transport';
import { previewScopeFor, readWithdrawalLane, withdrawalLaneHref } from './withdrawals/navigation';
import { useWithdrawalRuntime } from './withdrawals/WithdrawalRuntimeBridge';
import { WithdrawalPreviewControls } from './withdrawals/WithdrawalPreviewControls';
import {
  changeWithdrawalPreviewScope,
  useWithdrawalPreviewLocation,
  withWithdrawalPreviewScope,
  staffWithdrawalHref,
} from './withdrawals/WithdrawalPreviewNavigation';
import styles from './withdrawal-preview.module.css';

/** Synthetic route composition only. Native Overview keeps its original payout component. */
export function WithdrawalPreview({
  search = '',
  dailyChartFillEnabled = false,
}: {
  search?: string;
  dailyChartFillEnabled?: boolean;
}) {
  const location = useWithdrawalPreviewLocation(search, '/withdrawal-preview');
  const lane = readWithdrawalLane(location.search);
  const content = (
    <WithdrawalPreviewContent location={location} dailyChartFillEnabled={dailyChartFillEnabled} />
  );
  return lane.scenario === 'partner-demo' ? (
    <DatasetBoundary key={lane.identity} identities={[lane.identity]}>
      {content}
    </DatasetBoundary>
  ) : (
    content
  );
}

function WithdrawalPreviewContent({
  location,
  dailyChartFillEnabled,
}: {
  location: ReturnType<typeof useWithdrawalPreviewLocation>;
  dailyChartFillEnabled: boolean;
}) {
  const lane = readWithdrawalLane(location.search);
  const session = useOptionalDemoSession(lane.identity, lane.scenario === 'partner-demo');
  const scope = useMemo(
    () => session?.scope ?? previewScopeFor(lane.scenario, lane.identity),
    [lane.scenario, lane.identity, session],
  );
  const { runtime, version } = useWithdrawalRuntime(scope, session?.runtime);
  const accountSettings = usePreviewAccountSettings(scope, lane.identity);
  const [resetKey, setResetKey] = useState(0);
  const linkedDemo = lane.scenario === 'partner-demo';
  const reportParams = new URLSearchParams(location.search);
  if (linkedDemo && !reportParams.has('from') && !reportParams.has('toExclusive'))
    reportParams.set('toExclusive', '2026-10-01');
  const [report, changeReport] = useReportState(
    { ...readReportContext(reportParams), origin: 'overview' },
    JSON.stringify(scope),
    '/withdrawal-preview',
  );
  const overviewTransport = useMemo(
    () => session?.overview ?? createOverviewTransport('ready'),
    [session],
  );
  const dailyFillTransport = useMemo(
    () => createDailyChartFillTransport(overviewTransport),
    [overviewTransport],
  );
  const contentBasePath = linkedDemo
    ? `/content-preview/partner-demo/${lane.identity}`
    : '/content-preview';
  const navigation = reportNavigationHrefs(report, {
    overview: '/withdrawal-preview',
    content: contentBasePath,
    transactions: '/transactions-preview',
  });
  const returnTo = withWithdrawalPreviewScope(navigation.overview, lane);
  const historyHref = withdrawalLaneHref('/transactions-preview', {
    ...lane,
    view: 'withdrawals',
    requestRef: null,
    returnTo,
  });
  const requestHref = (requestRef: string) =>
    withdrawalLaneHref('/transactions-preview', {
      ...lane,
      view: 'withdrawals',
      requestRef,
      returnTo,
    });
  const control = runtime?.controller.view();
  return (
    <>
      <WithdrawalPreviewControls
        runtime={runtime}
        selection={lane}
        onSelectionChange={(selection) =>
          location.replace(changeWithdrawalPreviewScope(location.search, selection))
        }
        onReset={() => setResetKey((key) => key + 1)}
      />
      <PartnerShell
        active="overview"
        notifications={
          <PreviewNotifications
            key={JSON.stringify(scope)}
            preferences={accountSettings.snapshot?.preferences}
            state={accountSettings.status}
            statementHref={(id) =>
              linkedDemo ? historyHref : transactionHref('/transactions-preview', id, returnTo)
            }
          />
        }
        accountHref={accountManagementPreviewHref({ ...lane, returnTo })}
        hrefs={{ ...navigation, overview: returnTo, transactions: historyHref }}
        avatar="/media/celebrity-avatar.png"
      >
        <PreviewTools>
          <nav className={styles.laneNav} aria-label="หน้าการถอนเงิน">
            <LinkButton href={historyHref}>ประวัติคำขอถอนเงิน</LinkButton>
            <LinkButton
              href={staffWithdrawalHref(
                new URLSearchParams({
                  scenario: lane.scenario,
                  identity: lane.identity,
                  returnTo,
                }).toString(),
              )}
            >
              เจ้าหน้าที่จำลอง
            </LinkButton>
          </nav>
        </PreviewTools>
        {!runtime ? (
          <p role="status">กำลังเตรียมข้อมูลจำลอง…</p>
        ) : (
          <ScopedQueryProvider scope={scope}>
            <DatasetQueryRefresh session={session} />
            <WithdrawalExperience
              historyHref={historyHref}
              key={resetKey}
              scope={scope}
              transport={runtime.transport}
              refreshKey={version}
              requestHref={requestHref}
            >
              {({ renderSummary, persistenceWarning }) => (
                <>
                  {(persistenceWarning || control?.persistenceWarning) && (
                    <p role="status" className={styles.warning}>
                      {persistenceWarning || control?.persistenceWarning}
                    </p>
                  )}
                  <OverviewPage
                    contentBasePath={contentBasePath}
                    transactionsBasePath="/transactions-preview"
                    overviewBasePath="/withdrawal-preview"
                    initialFilters={{
                      from: report.from,
                      toExclusive: report.toExclusive,
                      brand: report.brand,
                    }}
                    controlledFilters={{
                      value: {
                        from: report.from,
                        toExclusive: report.toExclusive,
                        brand: report.brand,
                      },
                      onChange: (value) => {
                        const next = {
                          ...changeReportFilters(report, value),
                          origin: 'overview' as const,
                        };
                        changeReport(next);
                        if (validContentFilters(next))
                          location.replace(
                            withWithdrawalPreviewScope(
                              reportHref('/withdrawal-preview', next),
                              lane,
                            ).split('?')[1],
                          );
                      },
                    }}
                    weeklyEarningsOverride={
                      dailyChartFillEnabled && linkedDemo && lane.identity === 'a'
                        ? {
                            transport: dailyFillTransport,
                            cacheKey: 'demo-daily-fill-v1',
                            refetchIntervalMs: 30_000,
                            notice: 'เติมรายวันอัตโนมัติสำหรับสาธิต',
                          }
                        : undefined
                    }
                    transport={overviewTransport}
                    scope={scope}
                    renderPayout={renderSummary}
                    brands={['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova']}
                    partner={{
                      name: 'มดดำ คชาภา',
                      greeting: 'คุณมดดำ',
                      role: 'Celebrity partner',
                      portrait: '/media/celebrity-thumbnail.png',
                      avatar: '/media/celebrity-avatar.png',
                    }}
                  />
                </>
              )}
            </WithdrawalExperience>
          </ScopedQueryProvider>
        )}
      </PartnerShell>
    </>
  );
}
