import { describe, it, expect } from 'vitest';
import {
  PROHIBITED_CELEB_METRIC_KEYS,
  isProhibitedCelebMetricKey,
  isCelebSafeMetricKey,
  celebSafeMetricList,
} from '@/contracts/celeb-safe-metrics';

describe('celeb-safe metric policy', () => {
  it('always excludes prohibited audience counts regardless of spend permission', () => {
    for (const key of PROHIBITED_CELEB_METRIC_KEYS) {
      expect(isProhibitedCelebMetricKey(key)).toBe(true);
      expect(isCelebSafeMetricKey(key, { canViewSpend: false })).toBe(false);
      expect(isCelebSafeMetricKey(key, { canViewSpend: true })).toBe(false);
    }
    expect(PROHIBITED_CELEB_METRIC_KEYS).toEqual(['impressions', 'video_views', 'reach']);
  });

  it('gates spend on permission but keeps roas and derived economics always visible', () => {
    expect(isCelebSafeMetricKey('spend', { canViewSpend: false })).toBe(false);
    expect(isCelebSafeMetricKey('spend', { canViewSpend: true })).toBe(true);
    // link_clicks and the derived purchase_conversion_rate are owner-authorized Celeb-safe keys.
    for (const key of [
      'roas',
      'cpc',
      'ctr',
      'cpm',
      'cost_per_purchase',
      'purchase_conversion_rate',
      'link_clicks',
      'platform_orders',
      'platform_value',
    ]) {
      expect(isCelebSafeMetricKey(key, { canViewSpend: false })).toBe(true);
      expect(isProhibitedCelebMetricKey(key)).toBe(false);
    }
  });

  it('denies unknown/future keys by default (strict allowlist, not a denylist)', () => {
    for (const key of ['views', 'clicks', 'new_future_metric', 'frequency', '']) {
      expect(isCelebSafeMetricKey(key, { canViewSpend: false })).toBe(false);
      expect(isCelebSafeMetricKey(key, { canViewSpend: true })).toBe(false);
      expect(isProhibitedCelebMetricKey(key)).toBe(false);
    }
    for (const key of ['eligible_orders', 'eligible_sales']) {
      expect(isCelebSafeMetricKey(key, { canViewSpend: false })).toBe(true);
    }
  });

  it('filters a metric list purely without mutating the input', () => {
    const metrics = [
      { key: 'impressions' },
      { key: 'reach' },
      { key: 'spend' },
      { key: 'roas' },
      { key: 'ctr' },
    ];
    const safe = celebSafeMetricList(metrics, { canViewSpend: false });
    expect(safe.map((m) => m.key)).toEqual(['roas', 'ctr']);
    expect(celebSafeMetricList(metrics, { canViewSpend: true }).map((m) => m.key)).toEqual([
      'spend',
      'roas',
      'ctr',
    ]);
    expect(metrics).toHaveLength(5);
  });
});
