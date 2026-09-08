'use client';
import type { ReactNode } from 'react';
import { LayoutGrid, Video, Wallet } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { ThemeToggle } from './ThemeToggle';
import { Navigation, type Menu } from './Navigation';
import styles from './shell.module.css';
export function AppShell({
  active,
  onNavigate,
  title,
  accent,
  subtitle,
  notifications,
  avatar,
  footerNote,
  children,
}: {
  active: Menu;
  onNavigate: (menu: Menu) => void;
  title: string;
  accent: string;
  subtitle: string;
  notifications: ReactNode;
  avatar?: string;
  footerNote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.workspace}>
      <a className="skip-link" href="#main-content">
        ข้ามไปยังเนื้อหา
      </a>
      <header className={styles.header}>
        <a className={styles.logo} href="#main-content">
          Labs D x Partner
        </a>
        <Navigation active={active} onNavigate={onNavigate} />
        <div className={styles.controls}>
          <ThemeToggle />
          {notifications}
          {avatar && <img className={styles.avatar} src={avatar} alt="ภาพโปรไฟล์" />}
        </div>
      </header>
      <aside className={styles.rail} aria-label="ทางลัด">
        {(
          [
            { menu: 'overview', Icon: LayoutGrid, label: 'Overview' },
            { menu: 'content', Icon: Video, label: 'My content' },
            { menu: 'transactions', Icon: Wallet, label: 'Transactions' },
          ] as const
        ).map(({ menu, Icon, label }) => (
          <Button
            key={menu}
            icon
            aria-label={label}
            variant={active === menu ? 'primary' : 'secondary'}
            onClick={() => onNavigate(menu)}
          >
            <Icon size={18} />
          </Button>
        ))}
      </aside>
      <main id="main-content" className={styles.main}>
        <h1 className={styles.title}>
          {title} <span>{accent}</span>
        </h1>
        <p className={styles.subtitle}>{subtitle}</p>
        {children}
        <footer className={styles.footer}>
          <span>LABS D × PARTNER / Your creativity, rewarded</span>
          {footerNote && <span>{footerNote}</span>}
        </footer>
      </main>
      <div className={styles.mobileNav}>
        <Navigation active={active} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
