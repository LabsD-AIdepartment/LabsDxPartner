'use client';
import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import type { Menu } from './Navigation';
export const partnerHrefs: Record<Menu, string> = {
  overview: '/overview',
  content: '/content',
  transactions: '/transactions',
};
const headings: Record<Menu, [string, string, string]> = {
  overview: [
    'Your content',
    'Your impact',
    'ทุกคอนเทนต์มีคุณค่า ติดตามผลงานและรายได้ของคุณได้ที่เดียว',
  ],
  content: ['Create Share', 'Get rewarded', 'ดูผลงานและรายละเอียดของแต่ละคลิป'],
  transactions: ['Your earnings', 'Made clear', 'ตรวจสอบรอบจ่ายและรายละเอียดคอมมิชชันของคุณ'],
};
export function PartnerShell({
  active,
  children,
  hrefs = partnerHrefs,
  notifications = null,
  footerNote,
  avatar,
}: {
  active: Menu;
  children: ReactNode;
  hrefs?: Record<Menu, string>;
  notifications?: ReactNode;
  footerNote?: ReactNode;
  avatar?: string;
}) {
  const [title, accent, subtitle] = headings[active];
  return (
    <AppShell
      active={active}
      hrefs={hrefs}
      title={title}
      accent={accent}
      subtitle={subtitle}
      notifications={notifications}
      footerNote={footerNote}
      avatar={avatar}
    >
      {children}
    </AppShell>
  );
}
