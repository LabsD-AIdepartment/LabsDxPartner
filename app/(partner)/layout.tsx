import type { ReactNode } from 'react';
// Every leaf resolves current identity and memberships before composing the shared shell.
export const dynamic = 'force-dynamic';
export default function PartnerLayout({ children }: { children: ReactNode }) {
  return children;
}
