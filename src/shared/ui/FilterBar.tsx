'use client';
import type { ReactNode } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { Button } from './Button';
import styles from './ui.module.css';
export type FilterValue = { from: string; toExclusive: string; brand: string | null };
export function FilterBar({
  value,
  brands,
  onChange,
  onReset,
  onExport,
  actions,
}: {
  value: FilterValue;
  brands: string[];
  onChange: (value: FilterValue) => void;
  onReset: () => void;
  onExport: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.filterContainer}>
      <div className={styles.filter} aria-label="ตัวกรองข้อมูล">
        <label className={styles.field}>
          เริ่มวันที่
          <input
            className={styles.input}
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          ก่อนวันที่
          <input
            className={styles.input}
            type="date"
            value={value.toExclusive}
            onChange={(e) => onChange({ ...value, toExclusive: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          แบรนด์
          <select
            className={`${styles.input} ${styles.select}`}
            value={value.brand ?? ''}
            onChange={(e) => onChange({ ...value, brand: e.target.value || null })}
          >
            <option value="">All brands</option>
            {brands.map((brand) => (
              <option key={brand}>{brand}</option>
            ))}
          </select>
        </label>
        <Button className={styles.export} onClick={onExport}>
          <Download size={16} />
          Export report
        </Button>
        <div className={styles.filterActions}>
          <Button icon aria-label="รีเซ็ตตัวกรอง" onClick={onReset}>
            <RotateCcw size={18} />
          </Button>
          {actions}
        </div>
      </div>
    </div>
  );
}
