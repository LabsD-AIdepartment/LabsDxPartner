'use client';
// D168 — OPTIONAL presentation capability: reveal a beneficiary's FULL synthetic account number in the
// withdrawal summary eye toggle. This is a purely presentational, dev/demo-only capability layered ON
// TOP of the unchanged `withdrawal-journey.ts` contract (whose MaskedBeneficiary stays masked and models
// NO full number). The full number lives ONLY as this hook's on-demand return value — never in the DTO,
// a controller snapshot, history, CSV, or any production default.
//
// Fail-closed by construction: with no provider, a non-`known` beneficiary, no exact match, or an
// ambiguous match, the hook returns null. Matching requires ALL four masked-beneficiary identity fields
// (displayName + bankName + maskedAccount + version) to line up with exactly one supplied entry, so a
// beneficiary edit (which bumps `version`) or a different account can never surface a stale number.
//
// This file imports ONLY the public contract type. It never imports a `dev/**` module (no feature→dev
// dependency); the dev DatasetBoundary is what injects entries built from its validated demo database.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PayoutBeneficiaryValue } from '@/contracts/withdrawal-journey';

/**
 * An explicit, exact reveal entry: the full synthetic (fictitious) account number bound to ALL FOUR
 * identity fields of a masked beneficiary. `version` MUST equal the `version` the summary beneficiary
 * carries, so a config edit that bumps the version stops matching (fail-closed re-mask).
 */
export interface BeneficiaryAccountRevealEntry {
  readonly displayName: string;
  readonly bankName: string;
  readonly maskedAccount: string;
  readonly version: string;
  /** Full FICTITIOUS number for a synthetic demo bank — never a real customer's account. */
  readonly fullAccount: string;
}

interface RevealValue {
  /** Stable identity token; changes on dataset/generation/provider/reset identity change. */
  readonly identityKey: string;
  readonly entries: readonly BeneficiaryAccountRevealEntry[];
}

const BeneficiaryAccountRevealContext = createContext<RevealValue | null>(null);

// A deterministic, injective content signature over the entry tuples: `JSON.stringify` of explicit
// field arrays. Entry fields are unrestricted strings, so a delimiter-join could let two different
// tuples collide; JSON encoding quotes/escapes every field, so distinct entries always differ here.
const entrySignature = (entries: readonly BeneficiaryAccountRevealEntry[]): string =>
  JSON.stringify(
    entries.map((e) => [e.displayName, e.bankName, e.maskedAccount, e.version, e.fullAccount]),
  );

/**
 * Supplies the exact reveal entries for the active validated dataset(s). `identityKey` is the STABLE
 * identity token: the UI uses `useBeneficiaryRevealIdentityKey()` as a React `key` so the eye state
 * remounts (re-masks) whenever identity changes. The context value is memoised on `identityKey` + the
 * entry content signature, so unrelated re-renders never churn it.
 */
export function BeneficiaryAccountRevealProvider({
  identityKey,
  entries,
  children,
}: {
  identityKey: string;
  entries: readonly BeneficiaryAccountRevealEntry[];
  children: ReactNode;
}) {
  const signature = entrySignature(entries);
  const value = useMemo<RevealValue>(
    () => ({ identityKey, entries: entries.map((e) => ({ ...e })) }),
    // `signature` fully captures entry content; `identityKey` is the stable remount token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identityKey, signature],
  );
  return (
    <BeneficiaryAccountRevealContext.Provider value={value}>
      {children}
    </BeneficiaryAccountRevealContext.Provider>
  );
}

/**
 * Resolve the full synthetic account number for the CURRENT summary beneficiary, or null. Returns null
 * unless a provider is mounted, the beneficiary is `known`, and EXACTLY ONE supplied entry matches all
 * four identity fields with a single distinct full number (no match / ambiguous ⇒ null).
 */
export function useBeneficiaryAccountNumber(beneficiary: PayoutBeneficiaryValue): string | null {
  const ctx = useContext(BeneficiaryAccountRevealContext);
  // Only a `known` beneficiary carries the identity fields; everything else fails closed.
  const known = beneficiary.state === 'known' ? beneficiary : null;
  const displayName = known?.displayName ?? null;
  const bankName = known?.bankName ?? null;
  const maskedAccount = known?.maskedAccount ?? null;
  const version = known?.version ?? null;
  return useMemo(() => {
    if (!ctx || displayName === null) return null;
    const distinct = new Set(
      ctx.entries
        .filter(
          (e) =>
            e.displayName === displayName &&
            e.bankName === bankName &&
            e.maskedAccount === maskedAccount &&
            e.version === version,
        )
        .map((e) => e.fullAccount),
    );
    return distinct.size === 1 ? [...distinct][0] : null;
  }, [ctx, displayName, bankName, maskedAccount, version]);
}

/**
 * The stable identity descriptor for the mounted provider (or null when none). The UI uses it as a
 * React `key` on the eye/toggle subtree so a dataset/generation/provider/reset identity change remounts
 * and re-masks the reveal synchronously.
 */
export function useBeneficiaryRevealIdentityKey(): string | null {
  return useContext(BeneficiaryAccountRevealContext)?.identityKey ?? null;
}
