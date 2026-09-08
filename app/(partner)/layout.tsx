import type { ReactNode } from 'react';
// No identity or private data is loaded by this layout. Every leaf is deny-only
// until A03 connects verified sessions; the shared visual shell is PartnerShell.
export const dynamic = 'force-dynamic';
export default function PartnerLayout({ children }: { children: ReactNode }) {
  return children;
}
