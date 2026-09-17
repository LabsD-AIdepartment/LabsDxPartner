'use client';
import {
  DatasetBoundary,
  DatasetQueryRefresh,
  useOptionalDemoSession,
} from './demo-dataset/DatasetBoundary';
import { resolveWithdrawalRequestRef } from './demo-dataset/alias';
import { PreviewTools } from './PreviewTools';
import { PreviewNotifications } from './PreviewNotifications';
import { usePreviewAccountSettings, accountManagementPreviewHref } from './AccountSettingsPreview';
import { useEffect, useMemo, useState } from 'react';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';
import { useRouter } from 'next/navigation';
import { PartnerShell } from '@/features/shell/PartnerShell';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { StatementList } from '@/features/transactions/StatementList';
import { StatementDetail } from '@/features/transactions/StatementDetail';
import { safeTransactionReturn, transactionHref } from '@/features/transactions/model';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { WithdrawalHistoryExperience } from '@/features/withdrawals/WithdrawalHistoryExperience';
import { WithdrawalWallet } from '@/features/withdrawals/WithdrawalWallet';
import { previewScopeFor, readWithdrawalLane } from './withdrawals/navigation';
import { useWithdrawalRuntime } from './withdrawals/WithdrawalRuntimeBridge';
import { WithdrawalPreviewControls } from './withdrawals/WithdrawalPreviewControls';
import {
  changeWithdrawalPreviewScope,
  readWithdrawalHistoryFilters,
  useWithdrawalPreviewLocation,
  withdrawalHistoryHref,
  withdrawalPeriodsHref,
  withdrawalNavigationSearch,
  withWithdrawalPreviewScope,
  staffWithdrawalHref,
} from './withdrawals/WithdrawalPreviewNavigation';
import {
  createTransactionTransport,
  createSampleDocuments,
  type TransactionMode,
  type DocumentMode,
} from './transaction-transport';
import { usePreviewPayment } from './preview-payment';
import { readyScenario } from './scenarios/ready';
import { readReportContext, reportNavigationHrefs } from '@/shared/routing/report-context';
import styles from './access-preview.module.css';
import withdrawalStyles from './withdrawal-preview.module.css';
const scope = { userId: 'preview-user', partnerId: 'preview-partner', permissionRevision: '1' };
export function TransactionsPreview({
  segments = [],
  search = '',
}: {
  segments?: string[];
  search?: string;
}) {
  const location = useWithdrawalPreviewLocation(search, '/transactions-preview');
  const lane = readWithdrawalLane(withdrawalNavigationSearch(location.search));
  const normalizeWallet =
    lane.scenario === 'partner-demo' && (segments.length > 0 || lane.view !== 'withdrawals');
  const walletParams = new URLSearchParams(withdrawalNavigationSearch(location.search));
  if (normalizeWallet) {
    walletParams.set('view', 'withdrawals');
    walletParams.delete('request');
    walletParams.delete('status');
  }
  const walletLocation = normalizeWallet
    ? { ...location, search: walletParams.toString() }
    : location;
  const router = useRouter();
  const { resolveHref } = useApplicationPresentation();
  useEffect(() => {
    if (lane.scenario !== 'partner-demo' || (!segments.length && lane.view === 'withdrawals'))
      return;
    const params = new URLSearchParams(withdrawalNavigationSearch(location.search));
    params.set('view', 'withdrawals');
    params.delete('request');
    params.delete('status');
    router.replace(resolveHref(`/transactions-preview?${params.toString()}`));
  }, [lane.scenario, lane.view, segments.join('/'), location.search, router]);
  // Old partner-demo statement bookmarks land in Wallet; underlying accounting routes stay intact.
  const content =
    lane.scenario === 'partner-demo' || (!segments[0] && lane.view === 'withdrawals') ? (
      <WithdrawalTransactionsPreview location={walletLocation} />
    ) : (
      <LegacyTransactionsPreview segments={segments} search={location.search} />
    );
  return lane.scenario === 'partner-demo' ? (
    <DatasetBoundary key={lane.identity} identities={[lane.identity]}>
      {content}
    </DatasetBoundary>
  ) : (
    content
  );
}

function WithdrawalTransactionsPreview({
  location,
}: {
  location: ReturnType<typeof useWithdrawalPreviewLocation>;
}) {
  const lane = readWithdrawalLane(withdrawalNavigationSearch(location.search));
  const session = useOptionalDemoSession(lane.identity, lane.scenario === 'partner-demo');
  const scope = useMemo(
    () => session?.scope ?? previewScopeFor(lane.scenario, lane.identity),
    [lane.scenario, lane.identity, session],
  );
  const { runtime, version } = useWithdrawalRuntime(scope, session?.runtime);
  const accountSettings = usePreviewAccountSettings(scope, lane.identity);
  const [resetKey, setResetKey] = useState(0);
  // Dev navigation alias: translate an old bookmarked deep link (URL `request` = a stable withdrawal
  // row id, e.g. `partner-demo-a-wr-pending-1`) to the reference currently stored for THIS identity's
  // dataset (a numeric g5 reference once activated), scoped to the loaded dataset only. Current stored
  // references pass through unchanged; nothing outside this dataset is ever resolved.
  const requestRef = useMemo(
    () => resolveWithdrawalRequestRef(lane.requestRef, session?.dataset ?? null),
    [lane.requestRef, session],
  );
  const filters = readWithdrawalHistoryFilters(location.search);
  const params = new URLSearchParams(location.search);
  const returnTo = safeTransactionReturn(
    params.get('returnTo') ?? withWithdrawalPreviewScope('/withdrawal-preview', lane),
    true,
  );
  const summaryHref =
    returnTo.split('?')[0] === '/withdrawal-preview'
      ? withWithdrawalPreviewScope(returnTo, lane)
      : withWithdrawalPreviewScope('/withdrawal-preview', lane);
  params.set('returnTo', returnTo);
  const navigationSearch = params.toString();
  const historyHref = withdrawalHistoryHref(navigationSearch, filters);
  const periodsHref = withdrawalPeriodsHref(navigationSearch, filters);
  const linkedDemo = lane.scenario === 'partner-demo';
  const contentHref = linkedDemo
    ? reportNavigationHrefs(readReportContext(new URLSearchParams(summaryHref.split('?')[1])), {
        overview: summaryHref,
        content: `/content-preview/partner-demo/${lane.identity}`,
        transactions: '/transactions-preview',
      }).content
    : '/content-preview';
  return (
    <>
      <WithdrawalPreviewControls
        runtime={runtime}
        selection={lane}
        withdrawals
        requestRef={requestRef}
        onSelectionChange={(selection) =>
          location.replace(changeWithdrawalPreviewScope(location.search, selection))
        }
        onReset={() => setResetKey((key) => key + 1)}
      />
      <PartnerShell
        active="transactions"
        notifications={
          <PreviewNotifications
            key={JSON.stringify(scope)}
            preferences={accountSettings.snapshot?.preferences}
            state={accountSettings.status}
            statementHref={(id) =>
              linkedDemo ? historyHref : transactionHref('/transactions-preview', id, summaryHref)
            }
          />
        }
        accountHref={accountManagementPreviewHref({ ...lane, returnTo: summaryHref })}
        avatar="/media/celebrity-avatar.png"
        hrefs={{ overview: summaryHref, content: contentHref, transactions: historyHref }}
        footerNote={linkedDemo ? undefined : 'ตัวอย่างประวัติการถอนเงิน · ข้อมูลจำลอง'}
      >
        <nav className={withdrawalStyles.laneNav} aria-label="หน้าธุรกรรม">
          {requestRef && !linkedDemo && (
            <LinkButton className={withdrawalStyles.detailLaneLink} href={historyHref}>
              คำขอถอนเงิน
            </LinkButton>
          )}
          {requestRef && !linkedDemo && (
            <LinkButton className={withdrawalStyles.detailLaneLink} href={periodsHref}>
              ใบสรุปงวดเดิม
            </LinkButton>
          )}
          <PreviewTools>
            <LinkButton href={staffWithdrawalHref(navigationSearch, { requestRef })}>
              เจ้าหน้าที่จำลอง
            </LinkButton>
          </PreviewTools>
          {returnTo !== summaryHref && <LinkButton href={returnTo}>กลับรายงานเดิม</LinkButton>}
        </nav>
        {runtime?.controller.view().persistenceWarning && (
          <p role="status" className={withdrawalStyles.warning}>
            {runtime.controller.view().persistenceWarning}
          </p>
        )}
        {!runtime ? (
          <p role="status">กำลังเตรียมข้อมูลจำลอง…</p>
        ) : (
          <ScopedQueryProvider scope={scope}>
            <DatasetQueryRefresh session={session} />
            {linkedDemo ? (
              <WithdrawalWallet
                key={resetKey}
                scope={scope}
                transport={runtime.transport}
                requestRef={requestRef}
                refreshKey={version}
                filters={filters}
                onFiltersChange={(next) =>
                  location.replace(withdrawalHistoryHref(navigationSearch, next).split('?')[1])
                }
                requestHref={(ref) => withdrawalHistoryHref(navigationSearch, filters, ref)}
                backHref={historyHref}
              />
            ) : (
              <WithdrawalHistoryExperience
                key={resetKey}
                scope={scope}
                transport={runtime.transport}
                requestRef={requestRef}
                refreshKey={version}
                filters={filters}
                onFiltersChange={(next) =>
                  location.replace(withdrawalHistoryHref(navigationSearch, next).split('?')[1])
                }
                requestHref={(ref) => withdrawalHistoryHref(navigationSearch, filters, ref)}
                backHref={historyHref}
                balanceAction={<LinkButton href={periodsHref}>ใบสรุปงวดเดิม</LinkButton>}
                periodHref={(statementId) =>
                  withdrawalPeriodsHref(navigationSearch, filters, statementId)
                }
              />
            )}
          </ScopedQueryProvider>
        )}
      </PartnerShell>
    </>
  );
}

function LegacyTransactionsPreview({ segments, search }: { segments: string[]; search: string }) {
  const navigationSearch = withdrawalNavigationSearch(search);
  const lane = readWithdrawalLane(navigationSearch);
  const linkedDemo = lane.scenario === 'partner-demo';
  const session = useOptionalDemoSession(lane.identity, lane.scenario === 'partner-demo');
  const effectiveScope = session?.scope ?? scope;
  const [mode, setMode] = useState<TransactionMode>('ready'),
    [documentMode, setDocumentMode] = useState<DocumentMode>('ready');
  const [paid, setPaid] = usePreviewPayment();
  const router = useRouter();
  const { resolveHref } = useApplicationPresentation();
  const [notices, setNotices] = useState(() => readyScenario().notifications);
  const transport = useMemo(
    () => session?.transactions ?? createTransactionTransport(mode, paid),
    [session, mode, paid],
  );
  const documents = useMemo(
    () => session?.documents ?? createSampleDocuments(mode, paid, documentMode),
    [session, mode, paid, documentMode],
  );
  const returnTo = safeTransactionReturn(new URLSearchParams(search).get('returnTo'), true);
  const filters = readWithdrawalHistoryFilters(navigationSearch);
  const withdrawalHref = withdrawalHistoryHref(navigationSearch, filters);
  const periodsHref = withdrawalPeriodsHref(navigationSearch, filters);
  const summaryHref = linkedDemo
    ? withWithdrawalPreviewScope(
        returnTo.split('?')[0] === '/withdrawal-preview' ? returnTo : '/withdrawal-preview',
        lane,
      )
    : returnTo;
  const contentHref = linkedDemo
    ? reportNavigationHrefs(readReportContext(new URLSearchParams(summaryHref.split('?')[1])), {
        overview: summaryHref,
        content: `/content-preview/partner-demo/${lane.identity}`,
        transactions: '/transactions-preview',
      }).content
    : '/content-preview';
  const props = {
    scope: effectiveScope,
    transport,
    documents,
    basePath: '/transactions-preview',
    returnTo,
  };
  return (
    <>
      {!linkedDemo && (
        <PreviewTools toolbar>
          <aside className={styles.toolbar} aria-label="ชุดตรวจรอบจ่าย">
            <strong>Transactions journey preview</strong>
            <span>ข้อมูลและไฟล์ตัวอย่าง · ไม่ใช่เอกสารจริง</span>
            <label>
              สถานการณ์รอบจ่าย{' '}
              <select value={mode} onChange={(e) => setMode(e.target.value as TransactionMode)}>
                {[
                  'ready',
                  'empty',
                  'pending',
                  'paid',
                  'credit',
                  'adjustments',
                  'partial',
                  'stale',
                  'unavailable',
                  'loading',
                  'error',
                  'forbidden',
                  'not-found',
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              สถานะดาวน์โหลด{' '}
              <select
                value={documentMode}
                onChange={(e) => setDocumentMode(e.target.value as DocumentMode)}
              >
                {['ready', 'pending', 'error', 'forbidden', 'expired'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <Button onClick={() => setPaid(!paid)}>
              {paid ? 'คืนสถานะก่อนจ่าย' : 'จำลองบันทึกจ่าย 10,000 บาท'}
            </Button>
          </aside>
        </PreviewTools>
      )}
      <PartnerShell
        accountHref={
          linkedDemo
            ? accountManagementPreviewHref({ ...lane, returnTo: summaryHref })
            : '/account-preview'
        }
        active="transactions"
        avatar="/media/celebrity-avatar.png"
        hrefs={{
          overview:
            summaryHref.startsWith('/overview-preview') ||
            summaryHref.startsWith('/withdrawal-preview')
              ? summaryHref
              : '/overview-preview',
          content: contentHref,
          transactions: search ? periodsHref : '/transactions-preview',
        }}
        footerNote={linkedDemo ? undefined : 'ตัวอย่างรอบจ่าย · ข้อมูลจำลอง'}
        notifications={
          <NotificationButton
            data={notices}
            onSeen={(id) =>
              setNotices((old) => {
                const items = old.items.map((item) =>
                  item.id === id ? { ...item, seen: true } : item,
                );
                return { ...old, items, unseenCount: items.filter((item) => !item.seen).length };
              })
            }
            onOpenStatement={(id) =>
              router.push(resolveHref(transactionHref('/transactions-preview', id, returnTo)))
            }
          />
        }
      >
        <nav className={withdrawalStyles.laneNav} aria-label="หน้าธุรกรรม">
          <LinkButton href={withdrawalHref}>คำขอถอนเงิน</LinkButton>
          <LinkButton href={periodsHref} aria-current="page">
            ใบสรุปงวดเดิม
          </LinkButton>
        </nav>
        {!linkedDemo && (
          <p className={withdrawalStyles.laneDescription}>
            ใบสรุปงวดเดิมเป็นข้อมูลตัวอย่างแยกต่างหาก ยอดในหน้านี้ไม่ได้จัดสรรให้คำขอถอนเงิน
          </p>
        )}
        <ScopedQueryProvider key={`${mode}:${paid}:${documentMode}`} scope={effectiveScope}>
          <DatasetQueryRefresh session={session} />
          {segments[0] ? (
            <StatementDetail key={segments[0]} {...props} statementId={segments[0]} />
          ) : (
            <StatementList {...props} />
          )}
        </ScopedQueryProvider>
      </PartnerShell>
    </>
  );
}
