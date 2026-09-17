import { describe, expect, it } from 'vitest';
import {
  computeWithdrawable,
  knownBalance,
  unavailableBalance,
  type BalanceComponentsMoney,
} from '@/server/modules/withdrawals/balance';
import {
  BalanceScope,
  BalanceSnapshot,
  NonNegativeMinor,
  NonNegativeMoney,
} from '@/contracts/withdrawal';
import type { MoneyValue } from '@/contracts/common';

const scope = { partnerId: 'partner-1', payerId: 'labsd-th', currency: 'THB' as const };
const asOf = '2026-09-14T00:00:00+07:00';
const thb = (minor: string): MoneyValue => ({ currency: 'THB', minor });
const components = (over: Partial<Record<keyof BalanceComponentsMoney, string>>) => ({
  released: thb(over.released ?? '0'),
  settled: thb(over.settled ?? '0'),
  reserved: thb(over.reserved ?? '0'),
  held: thb(over.held ?? '0'),
});

describe('pure withdrawable balance in satang', () => {
  it('subtracts settled, reserved and held from released (example pack #1)', () => {
    expect(
      computeWithdrawable({
        released: 1000000n,
        settled: 200000n,
        reserved: 300000n,
        held: 100000n,
      }),
    ).toEqual({ rawAvailable: 400000n, available: 400000n, deficit: 0n });
  });

  it('retains a signed deficit after a negative correction and shows available 0 (example pack #2)', () => {
    expect(
      computeWithdrawable({ released: 100000n, settled: 200000n, reserved: 0n, held: 0n }),
    ).toEqual({ rawAvailable: -100000n, available: 0n, deficit: 100000n });
  });

  it('does not double-count when a reservation is consumed into a settlement (example pack #3)', () => {
    const beforeSettlement = computeWithdrawable({
      released: 1000000n,
      settled: 0n,
      reserved: 400000n,
      held: 0n,
    });
    const afterSettlement = computeWithdrawable({
      released: 1000000n,
      settled: 400000n,
      reserved: 0n,
      held: 0n,
    });
    expect(beforeSettlement.available).toBe(600000n);
    expect(afterSettlement.available).toBe(600000n);
    expect(afterSettlement.deficit).toBe(0n);
  });

  it('keeps a known zero balance distinct from unavailable', () => {
    expect(computeWithdrawable({ released: 0n, settled: 0n, reserved: 0n, held: 0n })).toEqual({
      rawAvailable: 0n,
      available: 0n,
      deficit: 0n,
    });
  });

  it('stays exact beyond Number.MAX_SAFE_INTEGER', () => {
    const released = 9007199254740993000n; // > 2^53
    expect(computeWithdrawable({ released, settled: 1n, reserved: 0n, held: 0n })).toEqual({
      rawAvailable: released - 1n,
      available: released - 1n,
      deficit: 0n,
    });
  });

  it('accepts signed settled from confirmed reversals but rejects negative reserved or held', () => {
    // A confirmed reversal makes net settled negative, which raises the available amount.
    expect(
      computeWithdrawable({ released: 1000000n, settled: -50000n, reserved: 0n, held: 0n })
        .available,
    ).toBe(1050000n);
    expect(() =>
      computeWithdrawable({ released: 0n, settled: 0n, reserved: -1n, held: 0n }),
    ).toThrow(/Reserved/);
    expect(() =>
      computeWithdrawable({ released: 0n, settled: 0n, reserved: 0n, held: -1n }),
    ).toThrow(/Held/);
  });

  it('does not mutate its input components', () => {
    const input = { released: 1000000n, settled: 200000n, reserved: 300000n, held: 100000n };
    const before = { ...input };
    computeWithdrawable(input);
    expect(input).toEqual(before);
  });
});

describe('non-negative money derived from shared Minor/Money', () => {
  it('accepts canonical non-negative satang strings', () => {
    expect(NonNegativeMinor.parse('0')).toBe('0');
    expect(NonNegativeMinor.parse('1000000')).toBe('1000000');
  });

  it('rejects a negative magnitude', () => {
    expect(() => NonNegativeMinor.parse('-1')).toThrow();
    expect(() => NonNegativeMinor.parse('-0')).toThrow();
  });

  it('rejects non-canonical formats using the shared Minor authority', () => {
    for (const bad of ['01', '+1', ' 1', '1.5', '', '1e3', '1_000'])
      expect(() => NonNegativeMinor.parse(bad)).toThrow();
  });

  it('enforces the shared 40-character length limit', () => {
    expect(NonNegativeMinor.parse('9'.repeat(40))).toBe('9'.repeat(40));
    expect(() => NonNegativeMinor.parse('9'.repeat(41))).toThrow();
  });

  it('keeps the strict THB money shape from shared Money', () => {
    expect(NonNegativeMoney.parse({ currency: 'THB', minor: '5' })).toEqual({
      currency: 'THB',
      minor: '5',
    });
    expect(() => NonNegativeMoney.parse({ currency: 'THB', minor: '-5' })).toThrow();
    expect(() => NonNegativeMoney.parse({ currency: 'USD', minor: '5' })).toThrow();
    // strictObject authority is preserved through the derivation: no extra keys.
    expect(() => NonNegativeMoney.parse({ currency: 'THB', minor: '5', extra: 1 })).toThrow();
  });
});

describe('typed known balance snapshot', () => {
  it('builds a parseable known snapshot with derived available and deficit', () => {
    const snapshot = knownBalance({
      scope,
      revision: 'rev-7',
      asOf,
      components: components({
        released: '1000000',
        settled: '200000',
        reserved: '300000',
        held: '100000',
      }),
    });
    expect(snapshot.state).toBe('known');
    expect(snapshot.available).toEqual(thb('400000'));
    expect(snapshot.rawAvailable).toEqual(thb('400000'));
    expect(snapshot.deficit).toEqual(thb('0'));
    // Round-trips through the shared contract union.
    expect(BalanceSnapshot.parse(snapshot)).toEqual(snapshot);
  });

  it('exposes rawAvailable negative while available stays zero for a deficit', () => {
    const snapshot = knownBalance({
      scope,
      revision: 'rev-8',
      asOf,
      components: components({ released: '100000', settled: '200000' }),
    });
    expect(snapshot.rawAvailable).toEqual(thb('-100000'));
    expect(snapshot.available).toEqual(thb('0'));
    expect(snapshot.deficit).toEqual(thb('100000'));
  });

  it('refuses to combine a component of a different currency', () => {
    expect(() =>
      knownBalance({
        scope,
        revision: 'rev-9',
        asOf,
        components: {
          ...components({ released: '1000000' }),
          // A non-THB component must never be folded into the available figure.
          settled: { currency: 'USD', minor: '1' } as unknown as MoneyValue,
        },
      }),
    ).toThrow(/currency/);
  });

  it('rejects a negative reserved amount at the contract boundary', () => {
    expect(() =>
      knownBalance({
        scope,
        revision: 'rev-10',
        asOf,
        // NonNegativeMoney forbids the '-' sign for reserved before arithmetic runs.
        components: { ...components({}), reserved: thb('-1') },
      }),
    ).toThrow();
  });

  it('rejects a negative held amount at the contract boundary', () => {
    expect(() =>
      knownBalance({
        scope,
        revision: 'rev-11',
        asOf,
        components: { ...components({}), held: thb('-1') },
      }),
    ).toThrow();
  });

  it('rejects malformed reserved satang strings at the boundary', () => {
    for (const bad of ['01', '1.5', '+1', ' 1'])
      expect(() =>
        knownBalance({
          scope,
          revision: 'rev-12',
          asOf,
          components: { ...components({}), reserved: { currency: 'THB', minor: bad } },
        }),
      ).toThrow();
  });

  it('handles a one-satang available amount through the snapshot union', () => {
    const snapshot = knownBalance({
      scope,
      revision: 'rev-13',
      asOf,
      components: components({ released: '1' }),
    });
    expect(snapshot.available).toEqual(thb('1'));
    expect(snapshot.rawAvailable).toEqual(thb('1'));
    expect(BalanceSnapshot.parse(snapshot)).toEqual(snapshot);
  });

  it('round-trips a >2^53 balance through JSON and the snapshot union exactly', () => {
    const snapshot = knownBalance({
      scope,
      revision: 'rev-14',
      asOf,
      // Released is greater than Number.MAX_SAFE_INTEGER; the satang string must survive
      // JSON without float rounding (2^53 = 9007199254740992).
      components: components({ released: '9007199254740993000', settled: '1' }),
    });
    expect(snapshot.available).toEqual(thb('9007199254740992999'));
    const roundTripped = BalanceSnapshot.parse(JSON.parse(JSON.stringify(snapshot)));
    expect(roundTripped).toEqual(snapshot);
    if (roundTripped.state === 'known')
      expect(roundTripped.available.minor).toBe('9007199254740992999');
  });

  it('retains a deficit from a signed-negative released net', () => {
    const snapshot = knownBalance({
      scope,
      revision: 'rev-15',
      asOf,
      components: components({ released: '-100000' }),
    });
    expect(snapshot.rawAvailable).toEqual(thb('-100000'));
    expect(snapshot.available).toEqual(thb('0'));
    expect(snapshot.deficit).toEqual(thb('100000'));
    expect(BalanceSnapshot.parse(snapshot)).toEqual(snapshot);
  });

  it('fails closed when a valid-input result exceeds the shared Minor width', () => {
    // released = 10^40 - 1 (40 digits), settled = -1 => rawAvailable = 10^40 (41 digits),
    // which no longer fits common.Minor.max(40). The builder must reject, not truncate.
    expect(() =>
      knownBalance({
        scope,
        revision: 'rev-16',
        asOf,
        components: components({ released: '9'.repeat(40), settled: '-1' }),
      }),
    ).toThrow();
    // The pure arithmetic itself stays exact (no throw, no truncation).
    const raw = computeWithdrawable({
      released: BigInt('9'.repeat(40)),
      settled: -1n,
      reserved: 0n,
      held: 0n,
    });
    expect(raw.rawAvailable).toBe(10n ** 40n);
  });

  it('keeps a known-zero snapshot distinct from unavailable through the union', () => {
    const zero = BalanceSnapshot.parse(
      knownBalance({ scope, revision: 'rev-17', asOf, components: components({}) }),
    );
    expect(zero.state).toBe('known');
    if (zero.state === 'known') expect(zero.available).toEqual(thb('0'));
    const missing = BalanceSnapshot.parse(unavailableBalance({ scope, asOf, reasons: ['no source'] }));
    expect(missing.state).toBe('unavailable');
    expect('available' in missing).toBe(false);
  });

  it('does not mutate its input components', () => {
    const input = {
      scope,
      revision: 'rev-18',
      asOf,
      components: components({
        released: '1000000',
        settled: '200000',
        reserved: '300000',
        held: '100000',
      }),
    };
    const before = structuredClone(input);
    knownBalance(input);
    expect(input).toEqual(before);
  });
});

describe('unavailable balance snapshot', () => {
  it('reports reasons instead of a fabricated zero when inputs are unknown', () => {
    const snapshot = unavailableBalance({
      scope,
      asOf,
      reasons: ['ยังไม่มีข้อมูลผู้จ่ายหรือโปรไฟล์ผู้รับสำหรับขอบเขตนี้'],
    });
    expect(snapshot.state).toBe('unavailable');
    expect('available' in snapshot).toBe(false);
    expect(BalanceSnapshot.parse(snapshot)).toEqual(snapshot);
  });

  it('requires at least one reason', () => {
    expect(() => unavailableBalance({ scope, asOf, reasons: [] })).toThrow();
  });
});

describe('balance scope', () => {
  it('keys balances by partner, payer and currency', () => {
    expect(BalanceScope.parse(scope)).toEqual(scope);
    expect(() => BalanceScope.parse({ partnerId: 'p', currency: 'THB' })).toThrow();
  });
});
