import { Money, type MoneyValue } from '@/contracts/common';
import type { OverviewValue } from '@/contracts/overview';

// The named sales platforms the overview UI renders as sales bars, in display order. `web` is the
// "web marketplace" source enum. `unattributed` is NOT a named platform — it is the honest residual
// bucket for sales the payload never mapped to a platform (e.g. current-period estimated sales that
// are in the window headline but not yet in the confirmed daily attribution).
const NAMED = ['facebook', 'shopee', 'tiktok', 'lazada', 'web'] as const;
type NamedPlatform = (typeof NAMED)[number];

const LABEL: Record<NamedPlatform | 'unattributed', string> = {
  facebook: 'Facebook',
  shopee: 'Shopee',
  tiktok: 'TikTok',
  lazada: 'Lazada',
  web: 'Webmarketplace',
  unattributed: 'ยังไม่ระบุแพลตฟอร์ม',
};

const isNamed = (platform: string): platform is NamedPlatform =>
  (NAMED as readonly string[]).includes(platform);

// BigInt only after a regex validation, so a malformed `minor` ("1.5", "x", "") surfaces as null
// instead of throwing. A missing money is also null.
const asMinor = (money: MoneyValue | null | undefined): bigint | null =>
  money && Money.safeParse(money).success ? BigInt(money.minor) : null;

const thb = (minor: bigint): MoneyValue => ({ currency: 'THB', minor: minor.toString() });

/**
 * SALES-by-platform bars for the overview, derived purely from the already-validated earnings value.
 *
 * The window headline is `eligibleSales` (current-inclusive; may include estimated sales). Named
 * platform amounts come only from the confirmed daily `salesByPlatform` allocations, summed with
 * exact BigInt and signed values preserved. Everything in the headline not mapped to a named
 * platform — the confirmed-vs-window gap, days without a breakdown, and explicit `unattributed`
 * daily entries — rolls into a single `unattributed` residual bucket, so the bars reconcile exactly
 * to the headline (a 690k headline never renders only its 550k confirmed breakdown). The residual
 * is shown whenever it is non-zero, including a signed negative value that the source itself
 * declared (e.g. a cancellation booked as `unattributed: -20`).
 *
 * Known vs unknown is preserved. A known headline that maps to nothing to show returns `[]` (an
 * empty-but-known list), while an unknown headline (`eligibleSales` null) returns null.
 *
 * The one hard inconsistency is when the source's own KNOWN daily sales exceed the headline
 * (`knownDailyTotal > headline`): the confirmed detail cannot fit inside the window it claims to
 * describe, so we refuse to invent a negative residual and return null. This is deliberately gated
 * on the total known daily sales — not on named-vs-headline — because a declared signed
 * `unattributed` correction can legitimately push a single named platform above the headline while
 * the daily sums still reconcile (that is a verified correction, not an unexplained excess). When
 * there is no daily detail at all, a negative headline stands on its own as a known signed total.
 *
 * Also returns null for malformed / duplicate / mismatched daily inputs. A named bucket appears
 * only when that platform's coverage is genuinely known (it appears in at least one daily
 * breakdown), so a platform that was simply never reported is omitted rather than shown as a
 * misleading zero.
 */
export function platformSalesItems(
  earnings: OverviewValue['earnings'],
): { label: string; value: MoneyValue }[] | null {
  const headline = asMinor(earnings.eligibleSales);
  if (headline === null) return null;

  // Only platforms with known coverage get an entry; a genuine net of 0 still counts as coverage.
  const named = new Map<NamedPlatform, bigint>();
  // Sum of every day whose sales are known (breakdown or not). Declared `unattributed` entries land
  // here via `point.sales` but never in `named`, so this total is what distinguishes a verified
  // signed correction from an unexplained named excess.
  let knownDailyTotal = 0n;
  let hasKnownDaily = false;
  for (const point of earnings.trend) {
    const breakdown = point.salesByPlatform;
    const daily = asMinor(point.sales);

    if (breakdown == null) {
      // No attribution this day; its known sales still count toward the daily total (so a negative
      // residual stays explainable), while an unknown/absent daily figure is simply skipped.
      if (daily !== null) {
        knownDailyTotal += daily;
        hasKnownDaily = true;
      }
      continue;
    }

    if (daily === null) return null; // A breakdown without a trustworthy daily sales is malformed.
    knownDailyTotal += daily;
    hasKnownDaily = true;

    let sum = 0n;
    const seen = new Set<string>();
    for (const entry of breakdown) {
      if (seen.has(entry.platform)) return null; // Duplicate platform within a day.
      seen.add(entry.platform);
      const value = asMinor(entry.sales);
      if (value === null) return null; // Malformed money in the detail.
      sum += value;
      if (isNamed(entry.platform))
        named.set(entry.platform, (named.get(entry.platform) ?? 0n) + value);
    }
    if (sum !== daily) return null; // Breakdown must sum exactly to the daily sales.
  }

  // Confirmed/known daily sales cannot exceed the current-inclusive window they belong to. When they
  // do (and there is daily detail), the residual would be an invented negative remainder — refuse.
  if (hasKnownDaily && knownDailyTotal > headline) return null;

  let namedTotal = 0n;
  for (const value of named.values()) namedTotal += value;

  // Residual = headline minus named; may be signed. Shown whenever non-zero, so a source-declared
  // negative correction is preserved and the bars always sum exactly to the headline.
  const unattributed = headline - namedTotal;

  const items: { label: string; value: MoneyValue }[] = [];
  for (const platform of NAMED)
    if (named.has(platform)) items.push({ label: LABEL[platform], value: thb(named.get(platform)!) });
  if (unattributed !== 0n) items.push({ label: LABEL.unattributed, value: thb(unattributed) });

  // Known headline with nothing to render is a known-empty list, not an unavailable (null) result.
  return items;
}
