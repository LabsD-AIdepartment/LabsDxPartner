'use client';
import { LayoutGrid, Video, Wallet } from 'lucide-react';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Button } from '@/shared/ui/Button';
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
          { key: 'transactions', label: 'Transactions', Icon: Wallet },
        ] as const
      ).map(({ key, label, Icon }) =>
        hrefs ? (
          <LinkButton
            key={key}
            href={hrefs[key]}
            variant={active === key ? 'primary' : 'secondary'}
            aria-current={active === key ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden />
            {label}
          </LinkButton>
        ) : (
          <Button
            key={key}
            variant={active === key ? 'primary' : 'secondary'}
            aria-current={active === key ? 'page' : undefined}
            onClick={() => onNavigate?.(key)}
          >
            <Icon size={16} />
            {label}
          </Button>
        ),
      )}
    </nav>
  );
}
