import type { MoneyValue } from '@/contracts/common';
import { formatMinor } from '@/shared/ui/format-money';
import { displayRatio } from './display-ratio';
import { DataState } from '@/shared/ui/DataState';
import styles from './chart.module.css';
export function BarChart({ items }: { items: readonly { label: string; value: MoneyValue }[] }) {
  if (!items.length) return <DataState state="empty" />;
  const max = items.reduce((a, x) => (BigInt(x.value.minor) > a ? BigInt(x.value.minor) : a), 1n);
  return (
    <div
      className={styles.bars}
      role="img"
      aria-label={items.map((x) => `${x.label}: ${formatMinor(x.value.minor)}`).join(', ')}
    >
      {items.map((item, i) => (
        <div className={styles.barItem} key={item.label}>
          <div
            className={`${styles.bar} ${i === 0 ? styles.featured : ''}`}
            style={{ height: `${Math.max(0, displayRatio(BigInt(item.value.minor), max)) * 80}%` }}
          >
            {i === 0 && (
              <span className={styles.barValue}>
                {(BigInt(item.value.minor) / 100000n).toString()}k
              </span>
            )}
          </div>
          <span className={styles.barLabel}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
