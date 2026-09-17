'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Card } from '@/shared/ui/Card';
import { BackLink } from '@/shared/ui/BackLink';
import { PageTitleActions } from '@/shared/ui/PageTitleActions';
import { DataState } from '@/shared/ui/DataState';
import { AppShell } from '@/features/shell/AppShell';
import { readReportContext, reportNavigationHrefs } from '@/shared/routing/report-context';
import { AccountPage } from '@/features/account/AccountPage';
import { AccountSettings } from '@/features/account/AccountSettings';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { scopeKey } from '@/shared/query/keys';
import { PayoutAccountPreview } from './PayoutAccountPreview';
import { PreviewNotifications } from './PreviewNotifications';
import { usePreviewAccountSettings } from './AccountSettingsPreview';
import { DatasetBoundary, useOptionalDemoSession } from './demo-dataset/DatasetBoundary';
import {
  payoutPreviewHref,
  previewScopeFor,
  readPayoutLane,
  withdrawalLaneHref,
} from './withdrawals/navigation';
import { staffPartnerSummaryHref } from './withdrawals/WithdrawalPreviewNavigation';
import { createScopedAccountTransport } from './account-settings-account-transport';

export function AccountPreview({ search = '' }: { search?: string }) {
  if (new URLSearchParams(search).get('view') === 'payout')
    return <PayoutAccountPreview search={search} />;
  const lane = readPayoutLane(search);
  return lane.scenario === 'partner-demo' ? (
    <DatasetBoundary key={lane.identity} identities={[lane.identity]}>
      <ManagedAccountPreview search={search} />
    </DatasetBoundary>
  ) : (
    <ManagedAccountPreview search={search} />
  );
}
function ManagedAccountPreview({ search }: { search: string }) {
  const lane = readPayoutLane(search);
  const session = useOptionalDemoSession(lane.identity, lane.scenario === 'partner-demo');
  const authority = session?.scope ?? previewScopeFor(lane.scenario, lane.identity);
  const settings = usePreviewAccountSettings(authority, lane.identity);
  const scope = settings.scope;
  const metadata = useMemo(
    () =>
      createScopedAccountTransport({
        scope,
        metadata: {
          userId: scope.userId,
          displayName: `พาร์ตเนอร์ ${lane.identity.toUpperCase()}`,
          username: `partner.${lane.identity}`,
          agreement: null,
          termsSummary: null,
          supportUrl: null,
        },
      }),
    [scope.userId, scope.partnerId, scope.permissionRevision, lane.identity],
  );
  const router = useRouter();
  const summaryHref = staffPartnerSummaryHref(search);
  const navigation = reportNavigationHrefs(
    readReportContext(new URLSearchParams(summaryHref.split('?')[1])),
    {
      overview: '/withdrawal-preview',
      content: session ? `/content-preview/partner-demo/${lane.identity}` : '/content-preview',
      transactions: '/transactions-preview',
    },
  );
  const historyHref = withdrawalLaneHref('/transactions-preview', {
    ...lane,
    view: 'withdrawals',
    requestRef: null,
    returnTo: summaryHref,
  });
  const params = new URLSearchParams(search);
  params.delete('view');
  params.set('scenario', lane.scenario);
  params.set('identity', lane.identity);
  params.set('returnTo', summaryHref);
  const accountHref = `/account-preview?${params.toString()}`;
  const payoutHref = payoutPreviewHref('/account-preview', { ...lane, returnTo: summaryHref });
  return (
    <AppShell
      active={null}
      title="จัดการบัญชี"
      accent=""
      notifications={
        <PreviewNotifications
          key={JSON.stringify(scopeKey(scope))}
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
      <PageTitleActions>
        <BackLink href={summaryHref} label="กลับหน้าหลัก" compactOnMobile />
      </PageTitleActions>
      <IsolatedQueryProvider identity={scopeKey(scope)}>
        <AccountPage
          scope={scope}
          transport={metadata}
          onLogout={() => router.push('/access-preview')}
          reauthHref="/access-preview"
          credentials={
            settings.transport ? (
              <AccountSettings
                scope={scope}
                transport={settings.transport}
                showIdentity={false}
                onSnapshot={settings.onSnapshot}
                payout={
                  <Card title="บัญชีรับเงิน">
                    <LinkButton href={payoutHref}>ดู/แก้ไขบัญชีรับเงิน</LinkButton>
                  </Card>
                }
              />
            ) : (
              <DataState state="loading" />
            )
          }
        />
      </IsolatedQueryProvider>
    </AppShell>
  );
}
