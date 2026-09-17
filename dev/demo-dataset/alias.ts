// Development-only navigation alias (D169). A withdrawal's stored `requestRef` doubles as the URL
// `request` deep-link key. When the seeded reference scheme changes (e.g. g4's legacy
// `partner-demo-a-wr-pending-1` code → g5's realistic numeric reference), a bookmarked old URL must
// still open the SAME request. The withdrawal row.id keeps its stable legacy value across generations,
// so this pure resolver maps an old row-id URL to the CURRENTLY stored requestRef — scoped strictly to
// the one already-loaded dataset (active identity/generation), never a fuzzy cross-scope guess.
//
// Pure and browser-safe: it reads only the dataset's own withdrawal rows and imports no product/native
// code, no DB, no React. It does NOT rewrite copy or invent references; it only translates a navigation
// key to the value the store already holds.

import type { DatasetRecords } from './dataset';

/**
 * Resolve a URL `request` reference to the withdrawal reference currently stored in `dataset`.
 *
 *  - `null` → `null` (no deep link).
 *  - A ref that already matches a stored `withdrawal.requestRef` → returned UNCHANGED (current numeric
 *    references, and g4 legacy references where requestRef === row.id, both pass straight through).
 *  - Otherwise a ref that exactly matches a stored `withdrawal.id` (the stable legacy row id, e.g. an
 *    old bookmarked `partner-demo-a-wr-pending-1`) → resolved to THAT row's current `requestRef`.
 *  - Anything else (unknown ref, or an id that belongs to another identity/scope) → returned UNCHANGED,
 *    so it falls through to the normal not-found path. No cross-dataset lookup, no fuzzy matching.
 */
export function resolveWithdrawalRequestRef(
  requestRef: string | null,
  dataset: DatasetRecords | null | undefined,
): string | null {
  if (requestRef === null || !dataset) return requestRef;
  const rows = dataset.withdrawals;
  if (rows.some((w) => w.requestRef === requestRef)) return requestRef;
  const byId = rows.find((w) => w.id === requestRef);
  return byId ? byId.requestRef : requestRef;
}
