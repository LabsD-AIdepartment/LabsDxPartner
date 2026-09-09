'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/features/shell/AppShell';
import { AccountPage } from '@/features/account/AccountPage';
import { ScopedQueryProvider } from '@/shared/query/provider';
import {
  accountScope,
  accountModes,
  createAccountTransport,
  type AccountMode,
} from './account-transport';
import styles from './access-preview.module.css';
export function AccountPreview() {
  const [mode, setMode] = useState<AccountMode>('ready');
  const transport = useMemo(() => createAccountTransport(mode), [mode]);
  const router = useRouter();
  return (
    <>
      <aside className={styles.toolbar}>
        <strong>Account journey preview</strong>
        <span>ข้อมูลจำลอง · ไม่มีการเชื่อมบัญชีจริง</span>
        <label>
          สถานการณ์บัญชี{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as AccountMode)}>
            {accountModes.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </aside>
      <AppShell
        active={null}
        title="Your account"
        accent=""
        subtitle="บัญชีและข้อตกลงของคุณ"
        notifications={null}
        avatar="/media/celebrity-avatar.png"
        accountHref="/account-preview"
        hrefs={{
          overview: '/overview-preview',
          content: '/content-preview',
          transactions: '/transactions-preview',
        }}
      >
        <ScopedQueryProvider key={mode} scope={accountScope}>
          <AccountPage
            scope={accountScope}
            transport={transport}
            onLogout={() => router.push('/login')}
          />
        </ScopedQueryProvider>
      </AppShell>
    </>
  );
}
