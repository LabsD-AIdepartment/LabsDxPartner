import type { MoneyValue } from '@/contracts/common';
import { minorOf, thb } from '@/server/modules/earnings/money';
import {
  BalanceScope,
  type BalanceScopeValue,
  type KnownBalanceSnapshotValue,
  KnownBalanceSnapshot,
  NonNegativeMoney,
  UnavailableBalanceSnapshot,
  type UnavailableBalanceSnapshotValue,
} from '@/contracts/withdrawal';

// Pure exact withdrawable-balance arithmetic in satang (BigInt). No I/O, no policy.
// Formula (docs/implementation/withdrawal-payment-plan.md §3):
//   rawAvailable = released - settled - reserved - held
//   available    = max(0, rawAvailable)
//   deficit      = max(0, -rawAvailable)
// `released` and `settled` are signed nets (corrections, confirmed reversals).
// `reserved` and `held` are non-negative holds that the CALLER must keep disjoint; this
// function does not detect or enforce non-overlap, it simply subtracts both magnitudes.
// Separately, consuming a reservation into a settlement (reserved -x, settled +x) leaves
// `available` unchanged, so the same entitlement is not deducted twice.

export interface BalanceComponentsMinor {
  released: bigint;
  settled: bigint;
  reserved: bigint;
  held: bigint;
}
export interface WithdrawableMinor {
  rawAvailable: bigint;
  available: bigint;
  deficit: bigint;
}

export function computeWithdrawable(components: BalanceComponentsMinor): WithdrawableMinor {
  const { released, settled, reserved, held } = components;
  if (reserved < 0n) throw new Error('Reserved amount must not be negative');
  if (held < 0n) throw new Error('Held amount must not be negative');
  const rawAvailable = released - settled - reserved - held;
  return {
    rawAvailable,
    available: rawAvailable > 0n ? rawAvailable : 0n,
    deficit: rawAvailable < 0n ? -rawAvailable : 0n,
  };
}

// Typed money components for a known snapshot. `released`/`settled` are signed `Money`;
// `reserved`/`held` are non-negative magnitudes validated as `NonNegativeMoney` at the
// contract boundary before any arithmetic runs (see knownBalance below).
export interface BalanceComponentsMoney {
  released: MoneyValue;
  settled: MoneyValue;
  reserved: MoneyValue;
  held: MoneyValue;
}

// Reject combining amounts of a different currency than the scope. Balances of distinct
// currencies must never be summed into one available figure.
function assertScopeCurrency(scope: BalanceScopeValue, components: BalanceComponentsMoney): void {
  for (const [name, value] of Object.entries(components) as [string, MoneyValue][])
    if (value.currency !== scope.currency)
      throw new Error(
        `Component ${name} currency ${value.currency} does not match scope currency ${scope.currency}`,
      );
}

export function knownBalance(input: {
  scope: BalanceScopeValue;
  revision: string;
  asOf: string;
  components: BalanceComponentsMoney;
}): KnownBalanceSnapshotValue {
  const scope = BalanceScope.parse(input.scope);
  assertScopeCurrency(scope, input.components);
  // Validate the non-negative holds through the shared contract BEFORE arithmetic, so a
  // signed or malformed reserved/held is rejected by NonNegativeMoney at the boundary
  // (not only by computeWithdrawable's runtime guard). released/settled stay signed Money.
  const reserved = NonNegativeMoney.parse(input.components.reserved);
  const held = NonNegativeMoney.parse(input.components.held);
  const derived = computeWithdrawable({
    released: minorOf(input.components.released),
    settled: minorOf(input.components.settled),
    reserved: BigInt(reserved.minor),
    held: BigInt(held.minor),
  });
  // Fail closed on output: a valid-input result whose magnitude exceeds the shared Minor
  // width is rejected here by KnownBalanceSnapshot's Money fields, never truncated.
  return KnownBalanceSnapshot.parse({
    state: 'known',
    scope,
    revision: input.revision,
    asOf: input.asOf,
    released: input.components.released,
    settled: input.components.settled,
    reserved,
    held,
    rawAvailable: thb(derived.rawAvailable),
    available: thb(derived.available),
    deficit: thb(derived.deficit),
  });
}

// Missing source/profile or other unknown inputs produce an explicit unavailable
// snapshot with reasons — never a fabricated zero balance.
export function unavailableBalance(input: {
  scope: BalanceScopeValue;
  asOf: string;
  reasons: readonly string[];
}): UnavailableBalanceSnapshotValue {
  return UnavailableBalanceSnapshot.parse({
    state: 'unavailable',
    scope: BalanceScope.parse(input.scope),
    asOf: input.asOf,
    reasons: input.reasons,
  });
}
