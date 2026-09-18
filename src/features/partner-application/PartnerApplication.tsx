'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Session, type SessionValue } from '@/contracts/session';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { ChangeWatcher } from '@/shared/query/ChangeWatcher';
import { loadChanges } from '@/shared/query/changes-http';
import { nativeVideoRead } from '@/features/shop-video/transport';
import { contentHttp } from '@/features/content/http';
import { NotificationCenter } from '@/features/notifications/NotificationCenter';
import { ProfileMenu } from '@/features/shell/ProfileMenu';
import { PartnerShell, partnerHrefs } from '@/features/shell/PartnerShell';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { overviewHttp } from '@/features/overview/http';
import { ContentList } from '@/features/content/ContentList';
import { ContentDetail } from '@/features/content/ContentDetail';
import { AdDetail } from '@/features/content/AdDetail';
import { StatementList } from '@/features/transactions/StatementList';
import { StatementDetail } from '@/features/transactions/StatementDetail';
import { transactionHttp, statementDocumentHttp } from '@/features/transactions/http';
import { DataState } from '@/shared/ui/DataState';
import { LinkButton } from '@/shared/ui/LinkButton';
import {
  changeReportFilters,
  reportNavigationHrefs,
  reportHref,
  type ReportContext,
} from '@/shared/routing/report-context';
import { useReportState } from '@/shared/routing/useReportState';
import { CredentialAccount } from './CredentialAccount';
import { AccountPage } from '@/features/account/AccountPage';
import { accountHttp } from '@/features/account/http';
import { AccountContacts } from '@/features/account/AccountContacts';
import { contactHttp } from '@/features/account/contact-http';
import { AccountIdentityCard } from '@/features/account/AccountIdentityCard';
import type { PartnerScreen } from './types';
import forms from '@/shared/ui/forms.module.css';

export function PartnerApplication({
  initialSession,
  screen,
  initialContext,
  payoutAccount,
  avatar,
}: {
  initialSession: SessionValue;
  screen: PartnerScreen;
  initialContext: ReportContext;
  payoutAccount?: ReactNode;
  avatar?: string;
}) {
  const [session, setSession] = useState(initialSession);
  const [state, setState] = useState<'ready' | 'checking' | 'changing' | 'error'>('checking');
  const [retry, setRetry] = useState(0);
  const mutating = useRef(false);
  const finish = useCallback(() => {
    mutating.current = true;
    setState('changing');
    window.location.assign('/login');
  }, []);
  useEffect(() => {
    let disposed = false,
      controller: AbortController | undefined;
    async function verify() {
      if (document.hidden || mutating.current) return;
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      try {
        const response = await fetch('/api/partner/session', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: current.signal,
        });
        if (disposed || current.signal.aborted || mutating.current) return;
        if (response.status === 401) {
          finish();
          return;
        }
        if (!response.ok) throw new Error('Session unavailable');
        const updated = Session.parse(await response.json());
        if (disposed || current.signal.aborted || mutating.current) return;
        setSession(updated);
        setState('ready');
      } catch {
        if (!disposed && !current.signal.aborted && !mutating.current) setState('error');
      }
    }
    const visibility = () => {
      if (mutating.current) return;
      setState('checking');
      if (document.hidden) controller?.abort();
      else void verify();
    };
    void verify();
    const timer = setInterval(() => void verify(), 30_000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', visibility);
    return () => {
      disposed = true;
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', visibility);
    };
  }, [retry, finish]);
  async function switchPartner(partnerId: string) {
    if (mutating.current) return;
    mutating.current = true;
    setState('changing');
    // Full navigation on success means no prior partner cache, cursor, or scope can survive.
    try {
      const response = await fetch('/api/partner/session', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partnerId }),
      });
      if (!response.ok) throw new Error('Switch failed');
      const next = Session.parse(await response.json());
      if (next.activePartnerId !== partnerId || next.userId !== session.userId)
        throw new Error('Scope mismatch');
      window.location.assign('/overview');
    } catch {
      mutating.current = false;
      setState('error');
    }
  }
  async function logout() {
    if (mutating.current) return;
    mutating.current = true;
    setState('changing');
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('Logout failed');
      finish();
    } catch {
      mutating.current = false;
      setState('error');
    }
  }
  const member = session.memberships.find((m) => m.partnerId === session.activePartnerId);
  const active = ['content', 'clip', 'ad'].includes(screen.kind)
    ? 'content'
    : ['transactions', 'statement'].includes(screen.kind)
      ? 'transactions'
      : 'overview';
  const capability =
    active === 'content'
      ? 'view_content'
      : active === 'transactions'
        ? 'view_statements'
        : 'view_earnings';
  const canView = screen.kind === 'account' || member?.capabilities.includes(capability);
  const scope = {
    userId: session.userId,
    partnerId: member?.partnerId ?? 'none',
    permissionRevision: member?.permissionRevision ?? 'none',
  };
  const [context, changeContext] = useReportState(
    {
      ...initialContext,
      origin:
        screen.kind === 'overview'
          ? 'overview'
          : screen.kind === 'content'
            ? 'content'
            : initialContext.origin,
    },
    JSON.stringify([scope, screen]),
    active === 'content' ? '/content' : active === 'transactions' ? '/transactions' : '/overview',
  );
  return (
    <ScopedQueryProvider scope={scope}>
      <PartnerShell
        active={screen.kind === 'account' ? null : active}
        hrefs={reportNavigationHrefs(context, partnerHrefs)}
        accountHref="/account"
        accountMenu={
          <ProfileMenu
            accountHref="/account"
            avatar={avatar}
            onLogout={() => void logout()}
            busy={state === 'changing'}
          >
            {session.memberships.length > 1 && (
              <label className={forms.field}>
                พาร์ทเนอร์
                <select
                  aria-label="เลือกพาร์ทเนอร์"
                  value={session.activePartnerId ?? ''}
                  disabled={state !== 'ready'}
                  onChange={(e) => void switchPartner(e.target.value)}
                >
                  {session.memberships.map((m) => (
                    <option key={m.partnerId} value={m.partnerId}>
                      {m.partnerName}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </ProfileMenu>
        }
        notifications={
          state === 'ready' &&
          session.access === 'active' &&
          member?.capabilities.includes('view_statements') ? (
            <NotificationCenter key={JSON.stringify(scope)} scope={scope} onAccessLost={finish} />
          ) : null
        }
      >
        {state === 'ready' &&
          session.access === 'active' &&
          member &&
          (canView || member.capabilities.includes('view_statements')) &&
          (screen.kind !== 'account' || member.capabilities.includes('view_statements')) && (
            <ChangeWatcher
              scope={{
                userId: session.userId,
                partnerId: member.partnerId,
                permissionRevision: member.permissionRevision,
              }}
              reconcileInitial
              load={(signal) =>
                loadChanges(
                  {
                    userId: session.userId,
                    partnerId: member.partnerId,
                    permissionRevision: member.permissionRevision,
                  },
                  member.capabilities.includes(capability) ? capability : 'view_statements',
                  signal,
                )
              }
              onAccessLost={() => {
                setState('checking');
                setRetry((value) => value + 1);
              }}
            />
          )}
        {state === 'error' ? (
          <DataState
            state="error"
            message="ตรวจสอบการเข้าถึงไม่สำเร็จ กรุณาลองใหม่"
            onRetry={() => {
              mutating.current = false;
              setState('checking');
              setRetry((v) => v + 1);
            }}
          />
        ) : state !== 'ready' ? (
          <DataState state="loading" />
        ) : screen.kind === 'account' ? (
          session.access === 'active' && member ? (
            <AccountPage
              scope={scope}
              transport={accountHttp}
              contacts={<AccountContacts scope={scope} transport={contactHttp} />}
              identity={
                <AccountIdentityCard scope={scope} transport={accountHttp} onChanged={finish} />
              }
              payoutAccount={payoutAccount}
              onLogout={finish}
            />
          ) : (
            <CredentialAccount name={session.displayName} onChanged={finish} />
          )
        ) : session.access !== 'active' || !member ? (
          <DataState
            state="unavailable"
            message={
              session.access === 'suspended'
                ? 'สิทธิ์เข้าถึงถูกระงับ กรุณาติดต่อผู้ดูแล Labs D'
                : 'บัญชีนี้ยังไม่มีสิทธิ์พาร์ทเนอร์ กรุณาติดต่อผู้ดูแล Labs D'
            }
          />
        ) : !canView ? (
          <DataState
            state="unavailable"
            message="บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลส่วนนี้ ติดต่อผู้ดูแล Labs D หากต้องการตรวจสอบสิทธิ์"
          />
        ) : (
          <>
            <PartnerFeatures
              key={`${session.userId}:${member.partnerId}:${member.permissionRevision}`}
              session={session}
              screen={screen}
              context={context}
              onContextChange={changeContext}
            />
          </>
        )}
      </PartnerShell>
    </ScopedQueryProvider>
  );
}
function PartnerFeatures({
  session,
  screen,
  context,
  onContextChange,
}: {
  session: SessionValue;
  screen: PartnerScreen;
  context: ReportContext;
  onContextChange: (context: ReportContext) => void;
}) {
  const member = session.memberships.find((m) => m.partnerId === session.activePartnerId)!;
  const scope = {
    userId: session.userId,
    partnerId: member.partnerId,
    permissionRevision: member.permissionRevision,
  };
  const content = {
    scope,
    context,
    routes: { content: '/content', overview: '/overview' },
    transport: contentHttp,
    shopVideoTransport: nativeVideoRead,
    canViewAdSpend: member.capabilities.includes('view_ad_spend'),
  };
  const transactions = {
    scope,
    transport: transactionHttp,
    documents: statementDocumentHttp,
    basePath: '/transactions',
    returnTo: reportHref(context.origin === 'overview' ? '/overview' : '/content', {
      ...context,
      generation: null,
      cursor: null,
      history: [],
    }),
  };
  switch (screen.kind) {
    case 'overview':
      return (
        <OverviewPage
          scope={scope}
          transport={overviewHttp}
          brands={[]}
          initialFilters={{
            from: context.from,
            toExclusive: context.toExclusive,
            brand: context.brand,
          }}
          controlledFilters={{
            value: { from: context.from, toExclusive: context.toExclusive, brand: context.brand },
            onChange: (value) =>
              onContextChange({
                ...changeReportFilters(context, value),
                origin: 'overview',
              }),
          }}
          partner={{
            name: member.partnerName,
            greeting: session.displayName,
            role: 'Partner',
            portrait: null,
            avatar: null,
          }}
        />
      );
    case 'content':
      return <ContentList {...content} brands={[]} onChange={onContextChange} />;
    case 'clip':
      return <ContentDetail {...content} contentId={screen.contentId} />;
    case 'ad':
      return <AdDetail {...content} contentId={screen.contentId} adId={screen.adId} />;
    case 'transactions':
      return <StatementList {...transactions} />;
    case 'statement':
      return <StatementDetail {...transactions} statementId={screen.statementId} />;
    case 'account':
      return null;
  }
}
