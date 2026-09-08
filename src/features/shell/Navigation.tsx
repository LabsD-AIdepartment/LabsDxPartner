'use client';
import { LayoutGrid, Video, Wallet } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import styles from './shell.module.css';
export type Menu = 'overview' | 'content' | 'transactions';
export function Navigation({
  active,
  onNavigate,
}: {
  active: Menu;
  onNavigate: (menu: Menu) => void;
}) {
  return (
    <nav className={styles.nav} aria-label="เมนูหลัก">
      {(
        [
          { key: 'overview', label: 'Overview', Icon: LayoutGrid },
          { key: 'content', label: 'My content', Icon: Video },
          { key: 'transactions', label: 'Transactions', Icon: Wallet },
        ] as const
      ).map(({ key, label, Icon }) => (
        <Button
          key={key}
          variant={active === key ? 'primary' : 'secondary'}
          aria-current={active === key ? 'page' : undefined}
          onClick={() => onNavigate(key)}
        >
          <Icon size={16} />
          {label}
        </Button>
      ))}
    </nav>
  );
}
