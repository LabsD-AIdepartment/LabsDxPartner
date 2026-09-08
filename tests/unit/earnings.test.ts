import { describe, expect, it } from 'vitest';
import {
  commission,
  allocatePeriod,
  cumulativeDeltas,
  sumMinor,
} from '@/server/modules/earnings/calculate';
import { formatMinor } from '@/shared/ui/format-money';

describe('agreed entitlement arithmetic in satang', () => {
  it('deducts a refund once in the eligible base', () =>
    expect(commission(100000n - 10000n - 20000n, 100000)).toBe(7000n));
  it('uses half-away-from-zero on each line', () => {
    expect([5n, 5n, 5n].map((x) => commission(x, 100000))).toEqual([1n, 1n, 1n]);
    expect(commission(-5n, 100000)).toBe(-1n);
    expect(commission(0n, 100000)).toBe(0n);
  });
  it('allocates a rounded period exactly with stable source-ID ties', () => {
    const result = allocatePeriod(
      [
        { id: 'c', base: 5n },
        { id: 'a', base: 5n },
        { id: 'b', base: 5n },
      ],
      100000,
    );
    expect(result).toEqual({ a: 1n, b: 1n, c: 0n });
    expect(sumMinor(Object.values(result))).toBe(2n);
  });
  it('conserves negative and mixed-sign rounded groups', () => {
    expect(
      sumMinor(
        Object.values(
          allocatePeriod(
            [
              { id: 'a', base: -5n },
              { id: 'b', base: -5n },
              { id: 'c', base: -5n },
            ],
            100000,
          ),
        ),
      ),
    ).toBe(-2n);
    expect(
      allocatePeriod(
        [
          { id: 'a', base: 15n },
          { id: 'b', base: -5n },
        ],
        100000,
      ),
    ).toEqual({ a: 2n, b: -1n });
  });
  it('books only the cumulative correction and reverses the original allocation', () => {
    expect(cumulativeDeltas({ a: 7000n }, { a: 6500n })).toEqual({ a: -500n });
    expect(cumulativeDeltas({ a: 6500n }, { a: 6500n })).toEqual({ a: 0n });
    expect(cumulativeDeltas({ a: 1n, b: 1n, c: 0n }, { a: 0n, b: 0n, c: 0n })).toEqual({
      a: -1n,
      b: -1n,
      c: 0n,
    });
  });
  it('rejects duplicate logical IDs, unsafe rates and mismatched correction members', () => {
    expect(() =>
      allocatePeriod(
        [
          { id: 'a', base: 5n },
          { id: 'a', base: 5n },
        ],
        100000,
      ),
    ).toThrow();
    for (const rate of [-1, 1000001, 0.1, Infinity, NaN])
      expect(() => commission(5n, rate)).toThrow();
    expect(() => cumulativeDeltas({ a: 1n }, { b: 1n })).toThrow();
  });
  it('remains exact beyond the Number safe integer boundary', () => {
    expect(commission(900719925474099300n, 100000)).toBe(90071992547409930n);
    expect(formatMinor('900719925474099301')).toBe('฿9,007,199,254,740,993.01');
    expect(formatMinor('-5')).toBe('-฿0.05');
  });
  it('keeps fees out of sales and distinguishes cash from settled obligation', () => {
    expect(sumMinor([7000n, 3000n])).toBe(10000n);
    expect(sumMinor([10000n, 7000n, -2000n, -(5800n + 200n)])).toBe(9000n);
  });
});
