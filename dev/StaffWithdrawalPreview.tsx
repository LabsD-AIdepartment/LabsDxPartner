'use client';
import {
  DatasetBoundary,
  DatasetQueryRefresh,
  useOptionalDemoSession,
} from './demo-dataset/DatasetBoundary';
import { PreviewTools } from './PreviewTools';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StaffShell } from '@/features/operations/StaffShell';
import { StaffWithdrawalWorkspace } from '@/features/withdrawals/StaffWithdrawalWorkspace';
import { StaffWithdrawalPeriods } from '@/features/withdrawals/StaffWithdrawalPeriods';
import { PayoutBeneficiaryExperience } from '@/features/withdrawals/PayoutBeneficiaryExperience';
import { PayoutBeneficiaryPreviewControls } from './withdrawals/PayoutBeneficiaryPreviewControls';
import { WithdrawalGatewayCard } from '@/features/withdrawals/WithdrawalGatewayCard';
import {
  loadWithdrawalPeriods,
  withdrawalGatewayStatus,
  withdrawalKeys,
  withdrawalScopeKey,
  WithdrawalResponseError,
} from '@/features/withdrawals/model';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { DataState } from '@/shared/ui/DataState';
import { LinkButton } from '@/shared/ui/LinkButton';
import layout from '@/shared/ui/forms.module.css';
import {
  readStaffRequestLane,
  staffPartnerRoster,
  withdrawalLaneHref,
  type PreviewIdentity,
} from './withdrawals/navigation';
import { useWithdrawalRuntime } from './withdrawals/WithdrawalRuntimeBridge';
import { StaffWithdrawalPreviewControls } from './withdrawals/StaffWithdrawalPreviewControls';
import {
  changeWithdrawalPreviewScope,
  readStaffWithdrawalFilters,
  staffPartnerSummaryHref,
  staffWithdrawalHref,
  useWithdrawalPreviewLocation,
} from './withdrawals/WithdrawalPreviewNavigation';
import type { WithdrawalRuntime } from './withdrawals/transport';
import styles from './withdrawal-preview.module.css';

export function StaffWithdrawalPreview({
  view,
  search = '',
}: {
  view: 'requests' | 'periods';
  search?: string;
}) {
  const location = useWithdrawalPreviewLocation(search, `/ops-preview/${view}`);
  const lane = readStaffRequestLane(location.search);
  const content = <StaffWithdrawalPreviewContent view={view} location={location} />;
  return lane.scenario === 'partner-demo' ? (
    <DatasetBoundary identities={['a', 'b']}>{content}</DatasetBoundary>
  ) : (
    content
  );
}

function StaffWithdrawalPreviewContent({
  view,
  location,
}: {
  view: 'requests' | 'periods';
  location: ReturnType<typeof useWithdrawalPreviewLocation>;
}) {
  const lane = readStaffRequestLane(location.search);
  const sessionA = useOptionalDemoSession('a', lane.scenario === 'partner-demo');
  const sessionB = useOptionalDemoSession('b', lane.scenario === 'partner-demo');
  const choices = useMemo(() => staffPartnerRoster(lane.scenario), [lane.scenario]);
  // The actual authorized preview roster is exactly A/B; hooks have a fixed order.
  const a = useWithdrawalRuntime(sessionA?.scope ?? choices[0].scope, sessionA?.runtime);
  const b = useWithdrawalRuntime(sessionB?.scope ?? choices[1].scope, sessionB?.runtime);
  if (!a.runtime || !b.runtime)
    return <DataState state="loading" message="กำลังเตรียมข้อมูลเจ้าหน้าที่จำลอง…" />;
  return (
    <IsolatedQueryProvider
      identity={[
        'staff-withdrawal-preview',
        ...withdrawalScopeKey(a.runtime.controller.currentScope()),
        ...withdrawalScopeKey(b.runtime.controller.currentScope()),
      ]}
    >
      <DatasetQueryRefresh session={sessionA} />
      <DatasetQueryRefresh session={sessionB} />
      <ReadyStaffPreview
        view={view}
        search={location.search}
        replace={location.replace}
        runtimes={[a.runtime, b.runtime]}
        versions={[a.version, b.version]}
      />
    </IsolatedQueryProvider>
  );
}

function ReadyStaffPreview({
  view,
  search,
  replace,
  runtimes,
  versions,
}: {
  view: 'requests' | 'periods';
  search: string;
  replace: (search: string) => void;
  runtimes: readonly [WithdrawalRuntime, WithdrawalRuntime];
  versions: readonly [number, number];
}) {
  const lane = readStaffRequestLane(search);
  const roster = staffPartnerRoster(lane.scenario).map((entry, index) => ({
    id: entry.identity,
    label: entry.partnerLabel,
    scope: runtimes[index].controller.currentScope(),
    transport: runtimes[index].transport,
    refreshKey: versions[index],
  }));
  const selectedIndex = lane.identity === 'a' ? 0 : 1;
  const runtime = runtimes[selectedIndex];
  const scope = roster[selectedIndex].scope;
  const version = versions[selectedIndex];
  const requestRef = view === 'requests' ? lane.requestRef : null;
  const filters = readStaffWithdrawalFilters(search);
  const queueHref = staffWithdrawalHref(search);
  const periodsHref = staffWithdrawalHref(search, { view: 'periods' });
  const summaryHref = staffPartnerSummaryHref(search);
  const partnerRequestHref = withdrawalLaneHref('/transactions-preview', {
    ...lane,
    view: 'withdrawals',
    requestRef,
    returnTo: summaryHref,
  });
  const periodQuery = useQuery({
    queryKey: withdrawalKeys.periods(scope, String(version)),
    queryFn: ({ signal }) => loadWithdrawalPeriods(runtime.transport, { scope, signal }),
    enabled: view === 'periods',
    retry: false,
    staleTime: 0,
  });
  const periodData = !periodQuery.isError ? (periodQuery.data ?? null) : null;
  const periodState =
    periodQuery.error instanceof WithdrawalResponseError
      ? 'invalid'
      : periodQuery.isError
        ? 'read-error'
        : periodQuery.isFetching
          ? periodData
            ? 'stale'
            : 'loading'
          : periodData
            ? 'ready'
            : 'unavailable';
  return (
    <>
      <StaffWithdrawalPreviewControls
        key={JSON.stringify([...withdrawalScopeKey(scope), requestRef])}
        runtime={runtime}
        version={version}
        identity={lane.identity}
        scenario={lane.scenario}
        requestRef={requestRef}
        periods={view === 'periods'}
        beneficiaryControls={
          <PayoutBeneficiaryPreviewControls
            key={JSON.stringify([...withdrawalScopeKey(scope), runtime.controller.epoch()])}
            runtime={runtime}
            version={version}
          />
        }
        onSelectionChange={(selection) =>
          replace(
            changeWithdrawalPreviewScope(search, {
              identity: selection.identity,
              scenario: readStaffRequestLane(
                new URLSearchParams({ scenario: selection.scenario }).toString(),
              ).scenario,
            }),
          )
        }
      />
      <StaffShell
        view={view}
        basePath="/ops-preview"
        routes={{
          partners: '/ops-preview/partners',
          imports: '/ops-preview/imports',
          ads: '/ops-preview/ads',
          periods: periodsHref,
          requests: queueHref,
        }}
      >
        <PreviewTools>
          <nav className={styles.laneNav} aria-label="หน้าตัวอย่างพาร์ตเนอร์และเจ้าหน้าที่">
            <LinkButton href={summaryHref}>
              ยอดพร้อมถอนของพาร์ตเนอร์ {lane.identity.toUpperCase()}
            </LinkButton>
            <LinkButton href={partnerRequestHref}>
              {requestRef ? 'คำขอนี้ในหน้าพาร์ตเนอร์' : 'ประวัติคำขอของพาร์ตเนอร์'}
            </LinkButton>
            <LinkButton href={periodsHref + '#payout-readiness'}>บัญชีรับเงินปัจจุบัน</LinkButton>
            <LinkButton href="/ops-preview/periods">งวดตัวอย่างเดิม</LinkButton>
          </nav>
        </PreviewTools>
        {runtime.controller.view().persistenceWarning && (
          <p role="status" className={styles.warning}>
            {runtime.controller.view().persistenceWarning}
          </p>
        )}
        {view === 'requests' ? (
          <StaffWithdrawalWorkspace
            roster={roster}
            filters={filters}
            onFiltersChange={(next) =>
              replace(staffWithdrawalHref(search, { filters: next }).split('?')[1])
            }
            selection={requestRef ? { selectionId: lane.identity, requestRef } : null}
            requestHref={(identity, ref) =>
              staffWithdrawalHref(search, {
                identity: identity as PreviewIdentity,
                requestRef: ref,
              })
            }
            backHref={queueHref}
          />
        ) : (
          <div className={layout.stack}>
            <StaffWithdrawalPeriods
              periods={periodData}
              state={periodState}
              onRetry={() => void periodQuery.refetch()}
            />
            <WithdrawalGatewayCard gateway={withdrawalGatewayStatus()} />
          </div>
        )}
        {(view === 'periods' || requestRef) && (
          <section id="payout-readiness" className={layout.stack}>
            <PayoutBeneficiaryExperience
              scope={scope}
              transport={runtime.transport}
              refreshKey={version}
              resetKey={runtime.controller.epoch()}
              compact={view === 'requests'}
            />
          </section>
        )}
      </StaffShell>
    </>
  );
}
