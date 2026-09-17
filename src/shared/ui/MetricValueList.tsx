import type { ReactNode } from 'react';
import styles from './metric-value-list.module.css';
export function MetricValueList({ children }: { children: ReactNode }) {
  return <dl className={styles.values}>{children}</dl>;
}
