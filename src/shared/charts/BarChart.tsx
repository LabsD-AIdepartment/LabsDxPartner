import type { CSSProperties } from 'react';
import type { MoneyValue } from '@/contracts/common';
import { formatMinor } from '@/shared/ui/format-money';
import { displayRatio } from './display-ratio';
import { DataState } from '@/shared/ui/DataState';
import styles from './chart.module.css';
/** Exact decimal compact labels: never round or coerce financial values to Number. */
function compactAmount(minor: string) {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const unit =
    absolute >= 100000000000n
      ? { scale: 100000000000n, digits: 11, suffix: 'b' }
      : absolute >= 100000000n
        ? { scale: 100000000n, digits: 8, suffix: 'm' }
        : absolute >= 100000n
          ? { scale: 100000n, digits: 5, suffix: 'k' }
          : null;
  if (!unit) return formatMinor(minor, true).replace('฿', '');
  const fraction = (absolute % unit.scale).toString().padStart(unit.digits, '0').replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${absolute / unit.scale}${fraction ? '.' + fraction : ''}${unit.suffix}`;
}

export function BarChart({ items }: { items: readonly { label: string; value: MoneyValue }[] }) {
  if (!items.length) return <DataState state="empty" />;
  const max = items.reduce((a, x) => (BigInt(x.value.minor) > a ? BigInt(x.value.minor) : a), 1n);
  return (
    <div className={styles.barContainer}>
      <div
        className={styles.bars}
        role="img"
        aria-label={items.map((x) => `${x.label}: ${formatMinor(x.value.minor)}`).join(', ')}
      >
        {items.map((item) => (
          <div className={styles.barItem} key={item.label}>
            <span className={styles.barLabel} title={item.label}>
              {item.label}
            </span>
            <span className={styles.barValue} title={formatMinor(item.value.minor)}>
              {compactAmount(item.value.minor)}
            </span>
            <div className={styles.barTrack}>
              <div
                className={styles.bar}
                style={
                  {
                    '--bar-size': `${Math.max(0, displayRatio(BigInt(item.value.minor), max)) * 100}%`,
                  } as CSSProperties
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
