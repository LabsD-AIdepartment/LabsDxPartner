'use client';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMobileHeaderActions } from './MobileHeaderActions';
import { Download, RotateCcw } from 'lucide-react';
import { Button } from './Button';
import { DateRangePicker } from './DateRangePicker';
import { partnerBrandFilterEnabled, partnerFilters } from '@/shared/config/partner-features';
import styles from './ui.module.css';
export type FilterValue = { from: string; toExclusive: string; brand: string | null };
export function FilterBar({
  value,
  brands,
  onChange,
  onReset,
  onExport,
  exportDisabled = false,
  actions,
  compact = false,
}: {
  value: FilterValue;
  brands: string[];
  onChange: (value: FilterValue) => void;
  onReset?: () => void;
  onExport: () => void;
  exportDisabled?: boolean;
  actions?: ReactNode;
  compact?: boolean;
}) {
  const placement = useMobileHeaderActions();
  const profile = placement?.mobile ? placement.profile : null;
  const calendarTarget = placement?.mobile ? placement.calendarTarget : null;
  const relocated = !!profile && !!calendarTarget;
  const hasLocalControls = partnerBrandFilterEnabled() || !!onReset || !!actions;
  const exportButton = (
    <Button
      data-mobile-header-action="report-export"
      className={styles.export}
      onClick={() => {
        profile?.activate();
        onExport();
      }}
      disabled={exportDisabled}
    >
      <Download size={16} />
      Export report
    </Button>
  );
  return (
    <div
      data-mobile-relocated={relocated}
      data-local-controls={hasLocalControls}
      className={`${styles.filterContainer} ${compact ? styles.filterCompact : ''}`}
    >
      <div
        className={`${styles.filter} ${!onReset && !actions ? styles.filterWithoutActions : ''}`}
        aria-label="ตัวกรองข้อมูล"
      >
        <DateRangePicker
          triggerTarget={calendarTarget}
          value={value}
          onApply={(range) => onChange(partnerFilters({ ...value, ...range }))}
        />
        {partnerBrandFilterEnabled() && (
          <label className={styles.field}>
            แบรนด์
            <select
              className={`${styles.input} ${styles.select}`}
              value={value.brand ?? ''}
              onChange={(e) => onChange({ ...value, brand: e.target.value || null })}
            >
              <option value="">All brands</option>
              {value.brand && !brands.includes(value.brand) && (
                <option value={value.brand}>{value.brand} (ที่เลือก)</option>
              )}
              {brands.map((brand) => (
                <option key={brand}>{brand}</option>
              ))}
            </select>
          </label>
        )}
        {profile ? createPortal(exportButton, profile.actions) : exportButton}
        {(onReset || actions) && (
          <div className={styles.filterActions}>
            {onReset && (
              <Button icon aria-label="รีเซ็ตตัวกรอง" onClick={onReset}>
                <RotateCcw size={18} />
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
