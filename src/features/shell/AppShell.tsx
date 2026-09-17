'use client';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';
import { useState, type ReactNode } from 'react';
import { PageTitleActionsTarget } from '@/shared/ui/PageTitleActions';
import {
  MobileHeaderActionsContext,
  useMobileHeaderActionsState,
} from '@/shared/ui/MobileHeaderActions';
import { LayoutGrid, Video, Wallet } from 'lucide-react';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Button } from '@/shared/ui/Button';
import { ThemeToggle } from './ThemeToggle';
import { Navigation, type Menu } from './Navigation';
import { Text } from '@/shared/ui/Text';
import styles from './shell.module.css';
import { ProfileMenu } from './ProfileMenu';
import { PageHeading, type PageHeadingVisibility } from './PageHeading';
export function AppShell({
  active,
  onNavigate,
  hrefs,
  title,
  accent,
  subtitle,
  headingVisibility,
  notifications,
  avatar,
  accountMenu,
  accountHref = '/account',
  footerNote,
  children,
}: {
  active: Menu | null;
  onNavigate?: (menu: Menu) => void;
  hrefs?: Record<Menu, string>;
  title: string;
  accent: string;
  subtitle?: string;
  headingVisibility?: Partial<PageHeadingVisibility>;
  notifications: ReactNode;
  avatar?: string;
  accountHref?: string;
  accountMenu?: ReactNode;
  footerNote?: ReactNode;
  children: ReactNode;
}) {
  const presentation = useApplicationPresentation();
  const [titleActions, setTitleActions] = useState<HTMLDivElement | null>(null);
  const mobileActions = useMobileHeaderActionsState();
  return (
    <MobileHeaderActionsContext.Provider value={mobileActions}>
      <div className={styles.workspace}>
        <a className="skip-link" href="#main-content">
          ข้ามไปยังเนื้อหา
        </a>
        <header className={styles.header}>
          <a className={styles.logo} href="#main-content">
            <span>Labs D</span> <span>x Partner</span>
          </a>
          <Navigation active={active} onNavigate={onNavigate} hrefs={hrefs} />
          <div className={styles.controls}>
            <div className={styles.mobileCalendar} ref={mobileActions.setCalendarTarget} />
            <ThemeToggle />
            {notifications}
            {accountMenu ?? presentation.accountMenu ?? <ProfileMenu accountHref={accountHref} avatar={avatar} />}
          </div>
        </header>
        <aside className={styles.rail} aria-label="ทางลัด">
          {(
            [
              { menu: 'overview', Icon: LayoutGrid, label: 'Overview' },
              { menu: 'content', Icon: Video, label: 'My content' },
              { menu: 'transactions', Icon: Wallet, label: 'Wallet' },
            ] as const
          ).map(({ menu, Icon, label }) =>
            hrefs ? (
              <LinkButton
                key={menu}
                href={hrefs[menu]}
                icon
                aria-label={label}
                aria-current={active === menu ? 'page' : undefined}
                variant={active === menu ? 'primary' : 'secondary'}
              >
                <Icon size={18} aria-hidden />
              </LinkButton>
            ) : (
              <Button
                key={menu}
                icon
                aria-label={label}
                variant={active === menu ? 'primary' : 'secondary'}
                onClick={() => onNavigate?.(menu)}
              >
                <Icon size={18} />
              </Button>
            ),
          )}
        </aside>
        <main id="main-content" className={styles.main}>
          <PageHeading
            title={title}
            accent={accent}
            subtitle={subtitle}
            visibility={headingVisibility}
            actionsRef={setTitleActions}
          />
          <PageTitleActionsTarget.Provider value={titleActions}>
            {children}
          </PageTitleActionsTarget.Provider>
        </main>
        <footer className={styles.footer}>
          <Text as="span" variant="caption">
            LABS D × PARTNER / Your creativity, rewarded
          </Text>
          {(footerNote ?? presentation.footerNote) && (
            <Text as="span" variant="caption">
              {footerNote ?? presentation.footerNote}
            </Text>
          )}
          <Text as="span" variant="caption" className={styles.footerCredit}>
            ® DIRE WOLVES TECHNOLOGY
          </Text>
        </footer>
        <div className={styles.mobileNav}>
          <Navigation active={active} onNavigate={onNavigate} hrefs={hrefs} />
        </div>
      </div>
    </MobileHeaderActionsContext.Provider>
  );
}
