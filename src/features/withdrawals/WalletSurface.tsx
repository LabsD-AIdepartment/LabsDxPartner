import type { ComponentProps } from 'react';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import styles from './wallet-surface.module.css';

/** Shared wallet presentation; the caller retains all data, actions and financial state. */
export function WalletCard({
  compact = false,
  className = '',
  ...props
}: ComponentProps<typeof Card> & { compact?: boolean }) {
  return <Card {...props} className={`${compact ? '' : styles.surface} ${className}`} />;
}

export function WalletDialog({ className = '', ...props }: ComponentProps<typeof Dialog>) {
  return <Dialog {...props} className={`${styles.surface} ${styles.dialog} ${className}`} />;
}
