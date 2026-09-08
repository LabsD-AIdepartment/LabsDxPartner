import type { MoneyValue } from '@/contracts/common';
import { formatMinor } from './format-money';
import styles from './ui.module.css';
export function Money({
  value,
  omitZeroFraction = true,
  className = '',
  reason = 'ยังไม่มีข้อมูลจำนวนเงิน',
}: {
  value: MoneyValue | null;
  omitZeroFraction?: boolean;
  className?: string;
  reason?: string;
}) {
  return (
    <span
      className={`${styles.money} ${value === null ? styles.unknown : ''} ${className}`}
      aria-label={value === null ? reason : undefined}
    >
      {value === null ? '—' : formatMinor(value.minor, omitZeroFraction)}
    </span>
  );
}
