'use client';
import { bindPitchStorage } from './pitch-storage';
import { useEffect, useState } from 'react';
import { Session, type SessionValue } from '@/contracts/session';
import type { PartnerScreen } from '@/features/partner-application/types';
import { PartnerApplication } from '@/features/partner-application/PartnerApplication';
import { readReportContext } from '@/shared/routing/report-context';
import { ApplicationPresentationContext } from '@/shared/routing/ApplicationPresentation';
import { pitchHref } from '@/features/pitch/routes';
import { ProfileMenu } from '@/features/shell/ProfileMenu';
import { DataState } from '@/shared/ui/DataState';
import { WithdrawalPreview } from './WithdrawalPreview';
import { ContentPreview } from './ContentPreview';
import { TransactionsPreview } from './TransactionsPreview';
import { PayoutAccountPreview } from './PayoutAccountPreview';

export function PitchApplication({
  session,
  screen,
  search,
  showConnectedAds = false,
}: {
  session: SessionValue;
  screen: PartnerScreen;
  search: string;
  showConnectedAds?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    async function verify() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch('/api/partner/session', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: request.signal,
        });
        if (response.status === 401) {
          if (!disposed && !request.signal.aborted) {
            setReady(false);
            window.location.replace('/login');
          }
          return;
        }
        if (!response.ok) throw new Error('Session unavailable');
        const next = Session.parse(await response.json());
        const member = next.memberships.find((m) => m.partnerId === session.activePartnerId);
        if (
          next.access !== 'active' ||
          next.userId !== session.userId ||
          next.activePartnerId !== session.activePartnerId ||
          !member ||
          !['view_earnings', 'view_content', 'view_statements', 'view_ad_spend'].every((c) =>
            member.capabilities.includes(c as 'view_earnings'),
          )
        ) {
          window.location.replace('/login');
          return;
        }
        if (!disposed && !request.signal.aborted) {
          bindPitchStorage(session.userId, session.activePartnerId!);
          setReady(true);
          setError(false);
        }
      } catch {
        if (!disposed && !request.signal.aborted) {
          setReady(false);
          setError(true);
        }
      }
    }
    const visibility = () => {
      setReady(false);
      if (document.hidden) controller?.abort();
      else void verify();
    };
    void verify();
    const timer = setInterval(() => {
      if (!document.hidden) void verify();
    }, 30_000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', visibility);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', visibility);
    };
  }, [session.userId, session.activePartnerId]);
  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('Logout failed');
      window.location.assign('/login');
    } catch {
      setError(true);
      setReady(false);
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <DataState
        state={error ? 'error' : 'loading'}
        message={
          error ? 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ กรุณาโหลดหน้าใหม่' : 'กำลังตรวจสอบการเข้าสู่ระบบ…'
        }
      />
    );
  const segments =
    screen.kind === 'clip'
      ? [screen.contentId]
      : screen.kind === 'ad'
        ? [screen.contentId, 'ads', screen.adId]
        : [];
  return (
    <ApplicationPresentationContext.Provider
      value={{
        resolveHref: pitchHref,
        sampleData: true,
        connectedAds: true,
        showConnectedAds,
        accountMenu: (
          <ProfileMenu
            accountHref="/account"
            avatar="/media/celebrity-avatar.png"
            onLogout={() => void logout()}
            busy={busy}
          />
        ),
        footerNote: 'ข้อมูลตัวอย่างสำหรับนำเสนอ · ไม่มีการโอนเงินจริง',
      }}
    >
      {screen.kind === 'overview' ? (
        <WithdrawalPreview search={search} />
      ) : ['content', 'clip', 'ad'].includes(screen.kind) ? (
        <ContentPreview search={search} segments={['partner-demo', 'a', ...segments]} />
      ) : ['transactions', 'statement'].includes(screen.kind) ? (
        <TransactionsPreview
          search={search}
          segments={screen.kind === 'statement' ? [screen.statementId] : []}
        />
      ) : new URLSearchParams(search).get('view') === 'payout' ? (
        <PayoutAccountPreview search={search} />
      ) : (
        <PartnerApplication
          initialSession={session}
          screen={screen}
          initialContext={readReportContext(new URLSearchParams(search))}
          payoutAccountHref="/account?view=payout"
        />
      )}
    </ApplicationPresentationContext.Provider>
  );
}
