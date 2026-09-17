'use client';
import { LayoutGrid, Video, Wallet } from 'lucide-react';
import Link from '@/shared/ui/AppLink';
import navigationStyles from './navigation.module.css';
import styles from './shell.module.css';
export type Menu = 'overview' | 'content' | 'transactions';
export function Navigation({
  active,
  onNavigate,
  hrefs,
}: {
  active: Menu | null;
  onNavigate?: (menu: Menu) => void;
  hrefs?: Record<Menu, string>;
}) {
  return (
    <nav className={styles.nav} aria-label="เมนูหลัก">
      {(
        [
          { key: 'overview', label: 'Overview', Icon: LayoutGrid },
          { key: 'content', label: 'My content', Icon: Video },
          { key: 'transactions', label: 'Wallet', Icon: Wallet },
        ] as const
      ).map(({ key, label, Icon }) =>
        hrefs ? (
          <Link
            key={key}
            href={hrefs[key]}
            className={navigationStyles.item}
            aria-current={active === key ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        ) : (
          <button
            type="button"
            key={key}
            className={navigationStyles.item}
            aria-current={active === key ? 'page' : undefined}
            onClick={() => onNavigate?.(key)}
          >
            <Icon size={16} aria-hidden />
            {label}
          </button>
        ),
      )}
    </nav>
  );
}
