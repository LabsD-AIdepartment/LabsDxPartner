'use client';
import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import type { Menu } from './Navigation';
import type { PageHeadingVisibility } from './PageHeading';
export const partnerHrefs: Record<Menu, string> = {
  overview: '/overview',
  content: '/content',
  transactions: '/transactions',
};
const headings: Record<Menu, [string, string, string?]> = {
  overview: ['Your content', 'Your impact'],
  content: ['Create Share', 'Get rewarded'],
  transactions: ['Your earnings', 'Made clear'],
};
export function PartnerShell({
  active,
  children,
  hrefs = partnerHrefs,
  notifications = null,
  footerNote,
  avatar,
  accountHref,
  accountMenu,
  headingVisibility,
}: {
  active: Menu | null;
  children: ReactNode;
  hrefs?: Record<Menu, string>;
  notifications?: ReactNode;
  footerNote?: ReactNode;
  avatar?: string;
  accountHref?: string;
  accountMenu?: ReactNode;
  headingVisibility?: Partial<PageHeadingVisibility>;
}) {
  const [title, accent, subtitle] =
    active === null
      ? ['Your account', 'Your partnership', 'บัญชี ข้อตกลง และความช่วยเหลือของคุณ']
      : headings[active];
  return (
    <AppShell
      active={active}
      hrefs={hrefs}
      title={title}
      accent={accent}
      subtitle={subtitle}
      headingVisibility={headingVisibility}
      notifications={notifications}
      footerNote={footerNote}
      avatar={avatar}
      accountHref={accountHref}
      accountMenu={accountMenu}
    >
      {children}
    </AppShell>
  );
}
