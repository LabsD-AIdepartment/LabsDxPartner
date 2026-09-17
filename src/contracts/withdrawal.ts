import { z } from 'zod';
import { Id, Instant, Minor, Money } from './common';

// W01-A: minimal typed withdrawal-balance contracts only.
// Scope, quote, request and status contracts beyond the withdrawable balance are
// intentionally deferred: their readiness/tax/payer/beneficiary policies are unknown
// (see docs/implementation/withdrawal-payment-plan.md §11–12). Nothing here invents a
// tax rate, maturity rule or provider choice.

// A non-negative satang string, derived from the shared `Minor` so the canonical format
// and 40-character limit remain defined once in common.ts. `Minor` already permits a
// leading '-'; reserved and held amounts are magnitudes that must never be negative, so
// this tighter form only adds the sign restriction on top of the shared base.
export const NonNegativeMinor = Minor.refine((v) => !v.startsWith('-'), {
  message: 'satang magnitude must not be negative',
});
// Derived from the shared `Money` shape (strict THB object) by overriding only `minor`.
// The `currency` literal and object strictness stay authoritative in common.ts; this does
// not restate the money shape.
export const NonNegativeMoney = Money.extend({ minor: NonNegativeMinor });
export type NonNegativeMoneyValue = z.infer<typeof NonNegativeMoney>;

// `released` and `settled` are signed nets: released entitlement can be corrected below
// zero, and settled obligation carries confirmed reversals. `Money` (signed `Minor`)
// represents them. `reserved` and `held` are disjoint non-negative holds.
export type SignedMoneyValue = z.infer<typeof Money>;

// Balances are keyed per partner + paying entity + currency. `payerId` is a scope key
// from the approved plan, not present in the existing schema yet; it carries no policy.
export const BalanceScope = z.strictObject({
  partnerId: Id,
  payerId: Id,
  currency: z.literal('THB'),
});
export type BalanceScopeValue = z.infer<typeof BalanceScope>;

// A discriminated snapshot so "unknown" is never collapsed to a known zero.
//  - `known`   carries every signed/non-negative amount and the derived available/deficit.
//  - `unavailable` carries reasons only (e.g. missing source/profile) and no amounts.
export const KnownBalanceSnapshot = z.strictObject({
  state: z.literal('known'),
  scope: BalanceScope,
  revision: Id,
  asOf: Instant,
  released: Money,
  settled: Money,
  reserved: NonNegativeMoney,
  held: NonNegativeMoney,
  // rawAvailable retains the signed shortfall; available is max(0, rawAvailable);
  // deficit is the non-negative shortfall magnitude. Both sides of a negative balance
  // stay visible so a debt is never silently cleared to zero.
  rawAvailable: Money,
  available: NonNegativeMoney,
  deficit: NonNegativeMoney,
});
export type KnownBalanceSnapshotValue = z.infer<typeof KnownBalanceSnapshot>;

export const UnavailableBalanceSnapshot = z.strictObject({
  state: z.literal('unavailable'),
  scope: BalanceScope,
  asOf: Instant,
  reasons: z.array(z.string().min(1).max(300)).min(1).max(30),
});
export type UnavailableBalanceSnapshotValue = z.infer<typeof UnavailableBalanceSnapshot>;

export const BalanceSnapshot = z.discriminatedUnion('state', [
  KnownBalanceSnapshot,
  UnavailableBalanceSnapshot,
]);
export type BalanceSnapshotValue = z.infer<typeof BalanceSnapshot>;
