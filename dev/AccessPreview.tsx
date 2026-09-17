'use client';
import { PreviewTools } from './PreviewTools';
import { useMemo, useState, type MouseEvent } from 'react';
import { PublicFrame } from '@/features/login/PublicFrame';
import { LoginPage } from '@/features/login/LoginPage';
import { InvitePage } from '@/features/login/InvitePage';
import { ResetPasswordPage } from '@/features/login/ResetPasswordPage';
import { CredentialEnvironmentProvider } from '@/features/login/CredentialEnvironment';
import type { Menu } from '@/features/shell/Navigation';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { readyScenario } from './scenarios/ready';
import { PartnerShell } from '@/features/shell/PartnerShell';
import { AccountPage } from '@/features/account/AccountPage';
import { CredentialAccount } from '@/features/partner-application/CredentialAccount';
import { createAccountTransport } from './account-transport';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { ContentList } from '@/features/content/ContentList';
import { ContentDetail } from '@/features/content/ContentDetail';
import { AdDetail } from '@/features/content/AdDetail';
import { StatementList } from '@/features/transactions/StatementList';
import { StatementDetail } from '@/features/transactions/StatementDetail';
import { readReportContext, reportHref } from '@/shared/routing/report-context';
import { createOverviewTransport } from './overview-transport';
import { createContentTransport } from './content-transport';
import { createTransactionTransport, createSampleDocuments } from './transaction-transport';
import { createCelebrityJourney } from './celebrity-journey';
import styles from './access-preview.module.css';
const scope = { userId: 'preview-user', partnerId: 'preview-partner', permissionRevision: '1' };
const brands = ['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova'];
const routes = {
  overview: '/access-preview/overview',
  content: '/access-preview/content',
  transactions: '/access-preview/transactions',
};

/** All credentials and session state die on reload. This component is excluded from production. */
export function AccessPreview(_props: { active?: Menu; initialActive?: boolean }) {
  const [journey] = useState(() => createCelebrityJourney());
  const [href, setHref] = useState('/welcome');
  const [token, setToken] = useState('');
  const [resetSequence, setResetSequence] = useState(0);
  const navigate = (next: string) => setHref(next.replace(/^\/access-preview(?=\/)/, ''));
  const environment = {
    request: journey.request,
    signIn: journey.signIn,
    navigate,
    token,
    clearLink: () => setToken(''),
  };
  const page = new URL(href, 'https://preview.invalid');
  const path = page.pathname;
  const privatePage = ['/overview', '/content', '/transactions', '/account'].some(
    (base) => path === base || path.startsWith(base + '/'),
  );
  const effectivePath = privatePage && !journey.authenticated ? '/login' : path;
  function intercept(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    const anchor = (event.target as Element).closest('a');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href);
    if (
      url.origin !== window.location.origin ||
      !/^\/(?:access-preview\/)?(overview|content|transactions|account|login)(\/|$)/.test(
        url.pathname,
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    navigate(url.pathname + url.search);
  }
  return (
    <CredentialEnvironmentProvider value={environment}>
      <div onClickCapture={intercept}>
        <PreviewTools toolbar>
          <aside className={styles.toolbar} aria-label="ทดลองเป็นดาราพาร์ทเนอร์">
            <strong>Celebrity mock journey</strong>
            <span>
              สมมุติคุณเป็นดารา · ข้อมูลจำลอง · ใช้รหัสทดลองเท่านั้น · รีโหลดแล้วเริ่มใหม่
            </span>
            {journey.username && (
              <Button
                onClick={() => {
                  journey.logout();
                  navigate('/login');
                }}
              >
                ออกจากระบบตัวอย่าง
              </Button>
            )}
            {journey.username && (
              <Button
                onClick={() => {
                  setToken(journey.issueReset());
                  setResetSequence((value) => value + 1);
                  navigate('/reset-password');
                }}
              >
                จำลองได้รับลิงก์ตั้งรหัสใหม่จากผู้ดูแล
              </Button>
            )}
          </aside>
        </PreviewTools>
        {effectivePath === '/welcome' ? (
          <PublicFrame>
            <h2>ดีลของคุณพร้อมแล้ว</h2>
            <Text>
              สมมุติว่าคุณตกลงร่วมงานกับ Labs D แล้ว และทีมส่งคำเชิญนี้ให้คุณตั้งบัญชีด้วยตัวเอง
            </Text>
            <Text>ดีลตัวอย่าง: Organic 10% และ Brand ads 3% ตามยอดขายที่เข้าเงื่อนไข</Text>
            <Text tone="muted">
              รูปประกอบเดิมใช้เป็นตัวแทนคุณในตัวอย่างนี้ ยอดและเอกสารทั้งหมดเป็นข้อมูลจำลอง
            </Text>
            <Button
              variant="primary"
              onClick={() => {
                setToken(journey.invitationToken);
                navigate('/invite');
              }}
            >
              เปิดคำเชิญและตั้งบัญชีของฉัน
            </Button>
          </PublicFrame>
        ) : effectivePath === '/invite' ? (
          <PublicFrame>
            <InvitePage />
          </PublicFrame>
        ) : effectivePath === '/reset-password' ? (
          <PublicFrame>
            <ResetPasswordPage key={resetSequence} />
          </PublicFrame>
        ) : effectivePath === '/login' ? (
          <PublicFrame variant="fluid">
            <LoginPage next="/overview" />
          </PublicFrame>
        ) : (
          <MockPartnerPages
            href={href}
            username={journey.username!}
            navigate={navigate}
            logout={() => {
              journey.logout();
              navigate('/login');
            }}
          />
        )}
      </div>
    </CredentialEnvironmentProvider>
  );
}
function MockPartnerPages({
  href,
  username,
  navigate,
  logout,
}: {
  href: string;
  username: string;
  navigate: (href: string) => void;
  logout: () => void;
}) {
  const url = new URL(href, 'https://preview.invalid');
  const [menu, id, , adId] = url.pathname.slice(1).split('/');
  const active: Menu = menu === 'content' || menu === 'transactions' ? menu : 'overview';
  const context = readReportContext(url.searchParams);
  const [notices, setNotices] = useState(() => readyScenario().notifications);
  const transport = useMemo(
    () => ({
      account: createAccountTransport('ready', username),
      overview: createOverviewTransport('ready'),
      content: createContentTransport('ready'),
      transactions: createTransactionTransport('ready', false),
      documents: createSampleDocuments('ready', false, 'ready'),
    }),
    [username],
  );
  const contentProps = {
    scope,
    context,
    transport: transport.content,
    routes,
    canViewAdSpend: false,
  };
  const statementProps = {
    scope,
    transport: transport.transactions,
    documents: transport.documents,
    basePath: routes.transactions,
    returnTo: url.searchParams.get('returnTo')?.startsWith('/content')
      ? routes.content
      : routes.overview,
  };
  return (
    <PartnerShell
      active={menu === 'account' ? null : active}
      accountHref="/access-preview/account"
      hrefs={routes}
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
          onOpenStatement={(id) => navigate(routes.transactions + '/' + encodeURIComponent(id))}
        />
      }
      avatar="/media/celebrity-avatar.png"
      footerNote="ข้อมูลและเอกสารตัวอย่าง · บัญชีจำลองของคุณ"
    >
      <ScopedQueryProvider scope={scope}>
        {menu === 'account' ? (
          <AccountPage
            scope={scope}
            transport={transport.account}
            onLogout={logout}
            reauthHref="/login"
            credentials={
              <CredentialAccount name={username} showIdentity={false} onChanged={logout} />
            }
          />
        ) : active === 'overview' ? (
          <OverviewPage
            transport={transport.overview}
            scope={scope}
            brands={brands}
            initialFilters={{
              from: context.from,
              toExclusive: context.toExclusive,
              brand: context.brand,
            }}
            contentBasePath={routes.content}
            transactionsBasePath={routes.transactions}
            overviewBasePath={routes.overview}
            partner={{
              name: username,
              greeting: `คุณ ${username}`,
              role: 'Celebrity partner',
              portrait: '/media/celebrity-thumbnail.png',
              avatar: '/media/celebrity-avatar.png',
            }}
          />
        ) : active === 'content' ? (
          adId ? (
            <AdDetail key={href} {...contentProps} contentId={id} adId={adId} />
          ) : id ? (
            <ContentDetail key={href} {...contentProps} contentId={id} />
          ) : (
            <ContentList
              key={href}
              {...contentProps}
              brands={brands}
              onChange={(c) => navigate(reportHref(routes.content, c))}
            />
          )
        ) : id ? (
          <StatementDetail key={href} {...statementProps} statementId={id} />
        ) : (
          <StatementList {...statementProps} />
        )}
      </ScopedQueryProvider>
    </PartnerShell>
  );
}
