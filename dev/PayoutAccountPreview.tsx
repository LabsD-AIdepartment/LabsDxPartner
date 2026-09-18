'use client';
import {
  DatasetBoundary,
  DatasetQueryRefresh,
  useOptionalDemoSession,
} from './demo-dataset/DatasetBoundary';
import { PreviewTools } from './PreviewTools';
import { useMemo } from 'react';
import { AppShell } from '@/features/shell/AppShell';
import { readReportContext, reportNavigationHrefs } from '@/shared/routing/report-context';
import { PayoutBeneficiaryExperience } from '@/features/withdrawals/PayoutBeneficiaryExperience';
import { withdrawalScopeKey } from '@/features/withdrawals/model';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { DataState } from '@/shared/ui/DataState';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { BackLink } from '@/shared/ui/BackLink';
import { PageTitleActions } from '@/shared/ui/PageTitleActions';
import { useMobileHeaderActions } from '@/shared/ui/MobileHeaderActions';
import { PreviewNotifications } from './PreviewNotifications';
import { usePreviewAccountSettings } from './AccountSettingsPreview';
import { useWithdrawalRuntime } from './withdrawals/WithdrawalRuntimeBridge';
import { PayoutBeneficiaryPreviewControls } from './withdrawals/PayoutBeneficiaryPreviewControls';
import {
  previewScopeFor,
  readPayoutLane,
  withdrawalLaneHref,
  isPreviewIdentity,
  isScenarioName,
} from './withdrawals/navigation';
import {
  changeWithdrawalPreviewScope,
  staffPartnerSummaryHref,
  staffWithdrawalHref,
  useWithdrawalPreviewLocation,
} from './withdrawals/WithdrawalPreviewNavigation';
import { SCENARIO_NAMES } from './withdrawals/scenarios';
import toolbar from './access-preview.module.css';
import layout from '@/shared/ui/forms.module.css';

export function PayoutAccountPreview({ search = '' }: { search?: string }) {
  const location = useWithdrawalPreviewLocation(search, '/account-preview');
  const lane = readPayoutLane(location.search);
  const content = <PayoutAccountPreviewContent location={location} />;
  return lane.scenario === 'partner-demo' ? (
    <DatasetBoundary key={lane.identity} identities={[lane.identity]}>
      {content}
    </DatasetBoundary>
  ) : (
    content
  );
}

/** Account-page composition of the same scoped beneficiary runtime and editor. */
export function EmbeddedPayoutAccount({ search = '' }: { search?: string }) {
  const lane = readPayoutLane(search);
  const content = <EmbeddedPayoutContent search={search} />;
  return lane.scenario === 'partner-demo' ? (
    <DatasetBoundary key={lane.identity} identities={[lane.identity]}>
      {content}
    </DatasetBoundary>
  ) : (
    content
  );
}
function EmbeddedPayoutContent({ search }: { search: string }) {
  const lane = readPayoutLane(search);
  const session = useOptionalDemoSession(lane.identity, lane.scenario === 'partner-demo');
  const scope = useMemo(
    () => session?.scope ?? previewScopeFor(lane.scenario, lane.identity),
    [lane.scenario, lane.identity, session],
  );
  const { runtime, version } = useWithdrawalRuntime(scope, session?.runtime);
  return (
    <IsolatedQueryProvider identity={withdrawalScopeKey(scope)}>
      <DatasetQueryRefresh session={session} />
      {runtime?.controller.view().persistenceWarning && (
        <p role="status">{runtime.controller.view().persistenceWarning}</p>
      )}
      {runtime ? (
        <PayoutBeneficiaryExperience
          scope={scope}
          transport={runtime.transport}
          refreshKey={version}
          resetKey={runtime.controller.epoch()}
        />
      ) : (
        <DataState state="loading" />
      )}
    </IsolatedQueryProvider>
  );
}

function PayoutAccountPreviewContent({
  location,
}: {
  location: ReturnType<typeof useWithdrawalPreviewLocation>;
}) {
  const lane = readPayoutLane(location.search);
  const session = useOptionalDemoSession(lane.identity, lane.scenario === 'partner-demo');
  const scope = useMemo(
    () => session?.scope ?? previewScopeFor(lane.scenario, lane.identity),
    [lane.scenario, lane.identity, session],
  );
  const { runtime, version } = useWithdrawalRuntime(scope, session?.runtime);
  const summaryHref = staffPartnerSummaryHref(location.search);
  const navigation = reportNavigationHrefs(
    readReportContext(new URLSearchParams(summaryHref.split('?')[1])),
    {
      overview: '/withdrawal-preview',
      content: session ? `/content-preview/partner-demo/${lane.identity}` : '/content-preview',
      transactions: '/transactions-preview',
    },
  );
  const accountParams = new URLSearchParams(location.search);
  accountParams.delete('view');
  accountParams.set('scenario', lane.scenario);
  accountParams.set('identity', lane.identity);
  accountParams.set('returnTo', summaryHref);
  const accountHref = `/account-preview?${accountParams.toString()}`;
  const settings = usePreviewAccountSettings(scope, lane.identity);
  const historyHref = withdrawalLaneHref('/transactions-preview', {
    ...lane,
    view: 'withdrawals',
    requestRef: null,
    returnTo: summaryHref,
  });
  return (
    <IsolatedQueryProvider identity={withdrawalScopeKey(scope)}>
      <DatasetQueryRefresh session={session} />
      <PreviewTools toolbar>
        <aside className={toolbar.toolbar} aria-label="บัญชีรับเงินจำลอง DEV">
          <strong>Account journey preview</strong>
          <span>บัญชีรับเงินตัวอย่าง · ไม่มีการเชื่อมบัญชีจริง</span>
          <label>
            พาร์ตเนอร์ตัวอย่าง{' '}
            <select
              value={lane.identity}
              onChange={(event) => {
                if (isPreviewIdentity(event.target.value))
                  location.replace(
                    changeWithdrawalPreviewScope(location.search, {
                      ...lane,
                      identity: event.target.value,
                    }),
                  );
              }}
            >
              <option value="a">พาร์ตเนอร์ A</option>
              <option value="b">พาร์ตเนอร์ B</option>
            </select>
          </label>
          <label>
            สถานการณ์ตัวอย่าง{' '}
            <select
              value={lane.scenario}
              onChange={(event) => {
                if (isScenarioName(event.target.value))
                  location.replace(
                    changeWithdrawalPreviewScope(location.search, {
                      ...lane,
                      scenario: event.target.value,
                    }),
                  );
              }}
            >
              {SCENARIO_NAMES.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          {runtime && (
            <>
              <PayoutBeneficiaryPreviewControls
                key={JSON.stringify([...withdrawalScopeKey(scope), runtime.controller.epoch()])}
                runtime={runtime}
                version={version}
              />
              <Button
                onClick={() =>
                  runtime.controller.setReadError(!runtime.controller.view().readError)
                }
              >
                สลับข้อผิดพลาดการอ่านจำลอง
              </Button>
              <Button onClick={() => runtime.controller.reset()}>
                เริ่มข้อมูลจำลองขอบเขตนี้ใหม่
              </Button>
            </>
          )}
        </aside>
      </PreviewTools>
      <AppShell
        active={null}
        title="Payout account"
        accent=""
        notifications={
          <PreviewNotifications
            preferences={settings.snapshot?.preferences}
            state={settings.status}
            statementHref={() => historyHref}
          />
        }
        avatar="/media/celebrity-avatar.png"
        accountHref={accountHref}
        hrefs={{
          overview: summaryHref,
          content: navigation.content,
          transactions: historyHref,
        }}
      >
        <PayoutHeadingBack href={accountHref} />
        <div className={layout.form}>
          {runtime?.controller.view().persistenceWarning && (
            <p role="status">{runtime.controller.view().persistenceWarning}</p>
          )}
          <PreviewTools>
            <LinkButton href={staffWithdrawalHref(location.search, { view: 'periods' })}>
              ความพร้อมในหน้าเจ้าหน้าที่
            </LinkButton>
          </PreviewTools>
          {runtime ? (
            <PayoutBeneficiaryExperience
              action={<BackLink href={accountHref} label="กลับหน้าจัดการบัญชี" mobileOnly />}
              scope={scope}
              transport={runtime.transport}
              refreshKey={version}
              resetKey={runtime.controller.epoch()}
            />
          ) : (
            <DataState state="loading" />
          )}
        </div>
      </AppShell>
    </IsolatedQueryProvider>
  );
}

function PayoutHeadingBack({ href }: { href: string }) {
  const placement = useMobileHeaderActions();
  return placement?.mobile ? null : (
    <PageTitleActions>
      <BackLink href={href} label="กลับหน้าจัดการบัญชี" />
    </PageTitleActions>
  );
}
