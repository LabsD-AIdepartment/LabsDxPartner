import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { getAdOrderSummary } from '@/features/content/ad-order-summary';
import { PartnerAdPerformance } from '@/contracts/partner-ad-performance';
import { ExactDecimal, formatExactDecimal } from '@/contracts/platform-metrics';
import type { Period } from '@/contracts/common';

type Performance = z.infer<typeof PartnerAdPerformance>;
type PeriodValue = z.infer<typeof Period>;
type Metric = Performance['metrics'][number];

// A realistic selected window (matches the clip-3 hero: one complete weekly reporting period).
const period: PeriodValue = {
  from: '2026-09-01T00:00:00+07:00',
  toExclusive: '2026-09-08T00:00:00+07:00',
  timezone: 'Asia/Bangkok',
};

const ordersMetric = (value: string | null): Metric => ({
  schemaVersion: 2,
  key: 'platform_orders',
  value,
  unit: 'count',
  currency: null,
  definition: 'จำนวนออเดอร์จากโฆษณาแพลตฟอร์ม',
  unavailableReason: value === null ? 'ต้นทางไม่ได้ส่งค่านี้' : null,
  aggregation: 'sum-disjoint',
});

const valueMetric = (value: string | null, currency: string = 'THB'): Metric => ({
  schemaVersion: 2,
  key: 'platform_value',
  value,
  unit: 'money',
  currency,
  definition: 'ยอดสั่งซื้อจากโฆษณาแพลตฟอร์ม',
  unavailableReason: value === null ? 'ต้นทางไม่ได้ส่งค่านี้' : null,
  aggregation: 'sum-disjoint',
});

// Build a valid PartnerAdPerformance for the selected window with the given metrics/overrides.
const performance = (overrides: Partial<Performance> = {}): Performance => ({
  schemaVersion: 2,
  source: 'Facebook',
  definition: null,
  period,
  coverage: { status: 'complete', periods: [period] },
  fetchedAt: '2026-09-08T01:00:00+07:00',
  dataThrough: '2026-09-08T00:00:00+07:00',
  state: 'ready',
  reasons: [],
  metrics: [ordersMetric('51'), valueMetric('57820')],
  series: [],
  ...overrides,
});

// Guard the fixtures themselves: everything the helper "displays" must be a valid contract object.
const assertValid = (p: Performance) => expect(PartnerAdPerformance.safeParse(p).success).toBe(true);

describe('getAdOrderSummary', () => {
  it('derives the clip-3 hero: 51 ad orders and 57,820 THB → AOV 1133.73', () => {
    const p = performance();
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toEqual({
      orders: '51',
      aov: '1133.73',
      currency: 'THB',
      ordersReason: null,
      aovReason: null,
      sales: '57820',
      salesCurrency: 'THB',
      salesReason: null,
      stale: false,
    });
  });

  it('rounds half-up at the boundary without touching Number', () => {
    // 1 / 8 = 0.125 → third digit is exactly 5 → half-up to 0.13.
    const p = performance({ metrics: [ordersMetric('8'), valueMetric('1')] });
    assertValid(p);
    expect(getAdOrderSummary(p, period).aov).toBe('0.13');
  });

  it('keeps full source fraction precision (no pre-rounding of the raw value)', () => {
    // 57820.50 / 51 = 1133.735294... → 1133.74. Rounding the value to cents first is irrelevant here,
    // but the extra fraction digit must feed the division, not be discarded.
    const p = performance({ metrics: [ordersMetric('51'), valueMetric('57820.50')] });
    assertValid(p);
    expect(getAdOrderSummary(p, period).aov).toBe('1133.74');
  });

  it('carries sub-cent fractions into the half-up decision', () => {
    // 0.005 / 1 = 0.005 → half-up to 0.01 (the third decimal must not be dropped before rounding).
    const p = performance({ metrics: [ordersMetric('1'), valueMetric('0.005')] });
    assertValid(p);
    expect(getAdOrderSummary(p, period).aov).toBe('0.01');
  });

  it('handles counts and totals beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const big = '9007199254740993'; // 2^53 + 1
    const p = performance({ metrics: [ordersMetric(big), valueMetric(big)] });
    assertValid(p);
    const result = getAdOrderSummary(p, period);
    expect(result.orders).toBe(big); // returned as an exact string, never a lossy number
    expect(result.aov).toBe('1.00');
  });

  it('shows a genuine 0.00 AOV for a known zero value with positive orders', () => {
    const p = performance({ metrics: [ordersMetric('5'), valueMetric('0')] });
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toMatchObject({
      orders: '5',
      aov: '0.00',
      currency: 'THB',
      aovReason: null,
    });
  });

  it('shows orders 0 but no AOV when there are zero orders (no denominator)', () => {
    const p = performance({ metrics: [ordersMetric('0'), valueMetric('57820')] });
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toEqual({
      orders: '0',
      aov: null,
      currency: null,
      ordersReason: null,
      aovReason: 'ยังไม่มีออเดอร์สำหรับคำนวณ AOV',
      // Sales is independent of the order count: a known value still shows with zero orders.
      sales: '57820',
      salesCurrency: 'THB',
      salesReason: null,
      stale: false,
    });
  });

  it('treats an unknown count as unknown count AND unknown AOV', () => {
    const nulled = performance({ metrics: [ordersMetric(null), valueMetric('57820')] });
    assertValid(nulled);
    expect(getAdOrderSummary(nulled, period)).toEqual({
      orders: null,
      aov: null,
      currency: null,
      ordersReason: 'ยังไม่มีจำนวนออเดอร์',
      aovReason: 'ยังไม่มีจำนวนออเดอร์',
      // A known value stays visible even though the count (and therefore AOV) is unknown.
      sales: '57820',
      salesCurrency: 'THB',
      salesReason: null,
      stale: false,
    });

    // Missing metric entirely behaves identically.
    const missing = performance({ metrics: [valueMetric('57820')] });
    assertValid(missing);
    expect(getAdOrderSummary(missing, period).orders).toBeNull();
    expect(getAdOrderSummary(missing, period).ordersReason).toBe('ยังไม่มีจำนวนออเดอร์');
  });

  it('keeps a known count when the money value is missing or unknown (count is independent)', () => {
    const nulled = performance({ metrics: [ordersMetric('51'), valueMetric(null)] });
    assertValid(nulled);
    expect(getAdOrderSummary(nulled, period)).toEqual({
      orders: '51',
      aov: null,
      currency: null,
      ordersReason: null,
      aovReason: 'ยังไม่มียอดสั่งซื้อ',
      // No known value ⇒ sales is unknown too, with the same value-less reason.
      sales: null,
      salesCurrency: null,
      salesReason: 'ยังไม่มียอดสั่งซื้อ',
      stale: false,
    });

    const missing = performance({ metrics: [ordersMetric('51')] });
    assertValid(missing);
    expect(getAdOrderSummary(missing, period)).toMatchObject({
      orders: '51',
      aov: null,
      aovReason: 'ยังไม่มียอดสั่งซื้อ',
    });
  });

  it('returns both unknown when performance is missing', () => {
    expect(getAdOrderSummary(undefined, period)).toEqual({
      orders: null,
      aov: null,
      currency: null,
      ordersReason: 'ยังไม่มีข้อมูลโฆษณา',
      aovReason: 'ยังไม่มีข้อมูลโฆษณา',
      sales: null,
      salesCurrency: null,
      salesReason: 'ยังไม่มีข้อมูลโฆษณา',
      stale: false,
    });
  });

  it('returns both unknown for an unavailable report', () => {
    const p = performance({
      coverage: { status: 'unavailable', periods: [] },
      state: 'unavailable',
      metrics: [],
      fetchedAt: null,
      dataThrough: null,
      definition: null,
      reasons: ['ยังไม่มีรายงานโฆษณาที่ตรงกับช่วงวันที่เลือก'],
    });
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toMatchObject({
      orders: null,
      aov: null,
      ordersReason: 'ยังไม่มีข้อมูลโฆษณา',
      aovReason: 'ยังไม่มีข้อมูลโฆษณา',
      stale: false,
    });
  });

  it('refuses a partial WINDOW even when a count/value are present', () => {
    const covered: PeriodValue = { ...period, toExclusive: '2026-09-05T00:00:00+07:00' };
    const p = performance({
      coverage: { status: 'partial', periods: [covered] },
      state: 'partial',
      reasons: ['ข้อมูลโฆษณายังไม่ครบช่วงวันที่เลือก'],
    });
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toMatchObject({
      orders: null,
      aov: null,
      ordersReason: 'ข้อมูลยังไม่ครบช่วงวันที่เลือก',
      aovReason: 'ข้อมูลยังไม่ครบช่วงวันที่เลือก',
      stale: false,
    });
  });

  it('displays values for a COMPLETE window whose state is partial (other metrics may be absent)', () => {
    // Coverage is complete for the whole window; state 'partial' only means some OTHER metric is
    // missing. The order count / value present here are still authoritative and may display.
    const p = performance({ state: 'partial' });
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toMatchObject({
      orders: '51',
      aov: '1133.73',
      currency: 'THB',
      stale: false,
    });
  });

  it('rejects a report for a different reporting window', () => {
    const other: PeriodValue = {
      from: '2026-08-01T00:00:00+07:00',
      toExclusive: '2026-08-08T00:00:00+07:00',
      timezone: 'Asia/Bangkok',
    };
    const p = performance();
    assertValid(p);
    expect(getAdOrderSummary(p, other)).toMatchObject({
      orders: null,
      aov: null,
      ordersReason: 'ข้อมูลไม่ตรงกับช่วงวันที่เลือก',
      aovReason: 'ข้อมูลไม่ตรงกับช่วงวันที่เลือก',
    });
  });

  it('matches windows by instant boundaries, not raw strings', () => {
    // Same instants as `period` expressed as UTC — must be accepted, not treated as a wrong window.
    const equivalent: PeriodValue = {
      from: '2026-08-31T17:00:00Z',
      toExclusive: '2026-09-07T17:00:00Z',
      timezone: 'Asia/Bangkok',
    };
    const p = performance();
    assertValid(p);
    expect(getAdOrderSummary(p, equivalent)).toMatchObject({ orders: '51', aov: '1133.73' });
  });

  it('rejects the count AND AOV when platform_orders is duplicated (never summed)', () => {
    const p = performance({
      metrics: [ordersMetric('51'), ordersMetric('9'), valueMetric('57820')],
    });
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toMatchObject({
      orders: null,
      aov: null,
      ordersReason: 'ยังไม่มีจำนวนออเดอร์',
      aovReason: 'ยังไม่มีจำนวนออเดอร์',
    });
  });

  it('rejects only the AOV when platform_value is duplicated (count survives)', () => {
    const p = performance({
      metrics: [ordersMetric('51'), valueMetric('57820'), valueMetric('10')],
    });
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toMatchObject({
      orders: '51',
      aov: null,
      currency: null,
      aovReason: 'ยังไม่มียอดสั่งซื้อ',
    });
  });

  it('displays complete-but-stale facts with stale=true so the UI can mark them', () => {
    const p = performance({
      state: 'stale',
      reasons: ['การอัปเดตยังไม่สำเร็จ แสดงรายงานล่าสุดที่เก็บไว้'],
    });
    assertValid(p);
    expect(getAdOrderSummary(p, period)).toEqual({
      orders: '51',
      aov: '1133.73',
      currency: 'THB',
      ordersReason: null,
      aovReason: null,
      sales: '57820',
      salesCurrency: 'THB',
      salesReason: null,
      stale: true,
    });
  });

  it('never displays invalid raw input disguised as stale', () => {
    // A structurally invalid metric value must fail validation and read as no-data, not as a stale
    // "1133.73" leaking through from an unvalidated payload.
    const bad = {
      ...performance({ state: 'stale' }),
      metrics: [ordersMetric('51'), { ...valueMetric('57820'), value: 'not-a-number' }],
    } as unknown as Performance;
    expect(PartnerAdPerformance.safeParse(bad).success).toBe(false);
    expect(getAdOrderSummary(bad, period)).toMatchObject({
      orders: null,
      aov: null,
      ordersReason: 'ยังไม่มีข้อมูลโฆษณา',
      aovReason: 'ยังไม่มีข้อมูลโฆษณา',
      stale: false,
    });
  });

  it('does not mutate its inputs', () => {
    const p = performance();
    const snapshot = structuredClone(p);
    const periodSnapshot = structuredClone(period);
    getAdOrderSummary(p, period);
    expect(p).toEqual(snapshot);
    expect(period).toEqual(periodSnapshot);
  });

  it('is safe against a deeply frozen input', () => {
    const freezeDeep = <T>(value: T): T => {
      if (value && typeof value === 'object') {
        for (const v of Object.values(value)) freezeDeep(v);
        Object.freeze(value);
      }
      return value;
    };
    const p = freezeDeep(performance());
    expect(() => getAdOrderSummary(p, period)).not.toThrow();
    expect(getAdOrderSummary(p, period)).toMatchObject({ orders: '51', aov: '1133.73' });
  });

  it('preserves the contract bounds: 40 whole / 18 fraction still validate', () => {
    // A value at the wire bounds (40 integer digits, 18 fraction digits) over 1 order divides cleanly.
    const whole = '9'.repeat(40);
    const fraction = '0'.repeat(18);
    const p = performance({ metrics: [ordersMetric('1'), valueMetric(`${whole}.${fraction}`)] });
    assertValid(p);
    expect(getAdOrderSummary(p, period).aov).toBe(`${whole}.00`);
  });

  it('suppresses an AOV whose half-up rounding overflows the ExactDecimal bound (no formatter crash)', () => {
    // 40 nines .999 over 1 order rounds half-up to 41 integer digits → not a valid ExactDecimal.
    const overflow = '9'.repeat(40) + '.999';
    const p = performance({ metrics: [ordersMetric('1'), valueMetric(overflow)] });
    assertValid(p);
    const result = getAdOrderSummary(p, period);
    expect(result.orders).toBe('1'); // the known count still shows — not a no-orders state
    expect(result.ordersReason).toBeNull();
    expect(result.aov).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.aovReason).toBe('ยังไม่สามารถแสดงค่าเฉลี่ยออเดอร์');
    // The suppressed AOV means the hero never feeds an out-of-bounds value into the formatter.
    expect(() => formatExactDecimal(result.aov ?? '0', 2)).not.toThrow();
  });

  it('still displays a 40-digit value whose rounded AOV stays within the ExactDecimal bound', () => {
    const whole = '9'.repeat(40);
    const p = performance({ metrics: [ordersMetric('1'), valueMetric(whole)] });
    assertValid(p);
    const result = getAdOrderSummary(p, period);
    expect(result.aov).toBe(`${whole}.00`);
    expect(ExactDecimal.safeParse(result.aov!).success).toBe(true);
    expect(() => formatExactDecimal(result.aov!, 2)).not.toThrow();
  });

  it('rejects a report whose boundary differs below one millisecond (exact instants, not Date.parse)', () => {
    // .0000001Z and .0000002Z collapse to the same millisecond under Date.parse, but are distinct instants.
    const expected: PeriodValue = { ...period, toExclusive: '2026-09-08T00:00:00.0000001Z' };
    const actual: PeriodValue = { ...period, toExclusive: '2026-09-08T00:00:00.0000002Z' };
    const p = performance({ period: actual, coverage: { status: 'complete', periods: [actual] } });
    assertValid(p);
    expect(getAdOrderSummary(p, expected)).toMatchObject({
      orders: null,
      aov: null,
      ordersReason: 'ข้อมูลไม่ตรงกับช่วงวันที่เลือก',
      aovReason: 'ข้อมูลไม่ตรงกับช่วงวันที่เลือก',
    });
    // The pre-existing equivalent-timezone-offset instant test above still passes: same instants
    // expressed as UTC remain a match, so the exact-instant guard does not over-reject.
  });

  // --- sales: the ad-sourced order value pulled from the same platform_value metric ---
  describe('sales', () => {
    it('shows known sales even when the order count is missing (independent of orders/AOV)', () => {
      const p = performance({ metrics: [ordersMetric(null), valueMetric('57820')] });
      assertValid(p);
      const result = getAdOrderSummary(p, period);
      // Orders/AOV are unknown, but the sales value still surfaces verbatim.
      expect(result.orders).toBeNull();
      expect(result.aov).toBeNull();
      expect(result).toMatchObject({
        sales: '57820',
        salesCurrency: 'THB',
        salesReason: null,
      });
    });

    it('shows known sales even when the order count is missing entirely (no orders metric)', () => {
      const p = performance({ metrics: [valueMetric('57820')] });
      assertValid(p);
      expect(getAdOrderSummary(p, period)).toMatchObject({
        orders: null,
        sales: '57820',
        salesCurrency: 'THB',
        salesReason: null,
      });
    });

    it('keeps a raw sales value with full source precision (never rounded to cents)', () => {
      const p = performance({ metrics: [ordersMetric('51'), valueMetric('57820.123456')] });
      assertValid(p);
      expect(getAdOrderSummary(p, period).sales).toBe('57820.123456');
    });

    it('preserves an explicit zero sales value distinct from unknown', () => {
      const p = performance({ metrics: [ordersMetric('0'), valueMetric('0')] });
      assertValid(p);
      expect(getAdOrderSummary(p, period)).toMatchObject({
        sales: '0',
        salesCurrency: 'THB',
        salesReason: null,
      });
    });

    it('marks sales unknown (value-less reason) when the value is missing', () => {
      const p = performance({ metrics: [ordersMetric('51'), valueMetric(null)] });
      assertValid(p);
      expect(getAdOrderSummary(p, period)).toMatchObject({
        sales: null,
        salesCurrency: null,
        salesReason: 'ยังไม่มียอดสั่งซื้อ',
      });
    });

    it('marks sales unknown for the wrong reporting window', () => {
      const other: PeriodValue = {
        from: '2026-08-01T00:00:00+07:00',
        toExclusive: '2026-08-08T00:00:00+07:00',
        timezone: 'Asia/Bangkok',
      };
      const p = performance();
      assertValid(p);
      expect(getAdOrderSummary(p, other)).toMatchObject({
        sales: null,
        salesCurrency: null,
        salesReason: 'ข้อมูลไม่ตรงกับช่วงวันที่เลือก',
      });
    });

    it('refuses sales on a partial WINDOW even when the value is present', () => {
      const covered: PeriodValue = { ...period, toExclusive: '2026-09-05T00:00:00+07:00' };
      const p = performance({
        coverage: { status: 'partial', periods: [covered] },
        state: 'partial',
        reasons: ['ข้อมูลโฆษณายังไม่ครบช่วงวันที่เลือก'],
      });
      assertValid(p);
      expect(getAdOrderSummary(p, period)).toMatchObject({
        sales: null,
        salesCurrency: null,
        salesReason: 'ข้อมูลยังไม่ครบช่วงวันที่เลือก',
      });
    });

    it('refuses sales when platform_value is duplicated (never summed), even though it is the only source', () => {
      const p = performance({
        metrics: [ordersMetric('51'), valueMetric('57820'), valueMetric('10')],
      });
      assertValid(p);
      expect(getAdOrderSummary(p, period)).toMatchObject({
        sales: null,
        salesCurrency: null,
        salesReason: 'ยังไม่มียอดสั่งซื้อ',
      });
    });

    it('never leaks an invalid raw value as sales (validation, not display)', () => {
      const bad = {
        ...performance({ state: 'stale' }),
        metrics: [ordersMetric('51'), { ...valueMetric('57820'), value: 'not-a-number' }],
      } as unknown as Performance;
      expect(PartnerAdPerformance.safeParse(bad).success).toBe(false);
      expect(getAdOrderSummary(bad, period)).toMatchObject({
        sales: null,
        salesCurrency: null,
        salesReason: 'ยังไม่มีข้อมูลโฆษณา',
      });
    });

    it('displays complete-but-stale sales (stale flag lets the UI mark it as last-known)', () => {
      const p = performance({
        state: 'stale',
        reasons: ['การอัปเดตยังไม่สำเร็จ แสดงรายงานล่าสุดที่เก็บไว้'],
      });
      assertValid(p);
      expect(getAdOrderSummary(p, period)).toMatchObject({
        sales: '57820',
        salesCurrency: 'THB',
        salesReason: null,
        stale: true,
      });
    });

    it('agrees with AOV on the currency/value it read (single source of truth)', () => {
      const p = performance({ metrics: [ordersMetric('51'), valueMetric('57820')] });
      assertValid(p);
      const result = getAdOrderSummary(p, period);
      // Same money metric backs both; the AOV currency and sales currency cannot diverge.
      expect(result.sales).toBe('57820');
      expect(result.salesCurrency).toBe(result.currency);
      expect(result.salesCurrency).toBe('THB');
    });
  });
});
