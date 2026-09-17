import type { HTMLAttributes } from 'react';
import styles from './ui.module.css';

/** A shared centered action row for compact dialogs; actions retain their own semantics. */
export function DialogActions({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`${styles.dialogActions} ${className}`} />;
}
