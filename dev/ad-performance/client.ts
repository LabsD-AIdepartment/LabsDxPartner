import { PartnerAdPerformance } from '@/contracts/partner-ad-performance';
import type { z } from 'zod';

// Browser-safe client for the dev ad-performance snapshot endpoint. It sends ONLY identity+clip+
// from+to (which the server matches against its own binding allowlist) and returns validated
// Celeb-safe performance, or null. Any failure — disabled feature, missing snapshot, network error,
// invalid payload — resolves to null so the financial data is NEVER blocked or broken by it. It is
// cancel/race safe: an aborted request resolves to null and its late payload is ignored.
//
// It is also TIME-bounded: a stalled/never-resolving connection must not block the already-computed
// financial detail indefinitely, so the request carries a short internal timeout (3s) combined with
// the caller's abort signal. Either firing resolves this overlay to null and leaves the financial
// detail untouched.

export type AdPerformanceValue = z.infer<typeof PartnerAdPerformance>;

const OVERLAY_TIMEOUT_MS = 3_000;

export async function loadAdPerformance(
  request: { identity: string; clipId: string; from: string; toExclusive: string },
  signal: AbortSignal,
): Promise<AdPerformanceValue | null> {
  const query = new URLSearchParams({
    identity: request.identity,
    clip: request.clipId,
    from: request.from,
    to: request.toExclusive,
  });
  // Bound the request so a stalled connection cannot block the financial detail. AbortSignal.any lets
  // the caller's abort still win the race (parent-abort guard is preserved: an aborted caller yields
  // null just the same), while the timeout guarantees a bounded resolution.
  const timeout = AbortSignal.timeout(OVERLAY_TIMEOUT_MS);
  const requestSignal = AbortSignal.any([signal, timeout]);
  try {
    const response = await fetch(`/api/dev/ad-performance?${query}`, {
      signal: requestSignal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    if (signal.aborted || timeout.aborted) return null;
    if (!raw || typeof raw !== 'object' || !('performance' in raw)) return null;
    const parsed = PartnerAdPerformance.safeParse((raw as { performance: unknown }).performance);
    if (!parsed.success) return null;
    // Client-side defense-in-depth: the server already validates, but only attach a payload whose
    // period matches what we requested, so a mismatched (e.g. cached/foreign) window is never shown.
    // The server projects the requested calendar dates to local-midnight Bangkok instants.
    if (
      parsed.data.period.from !== request.from + 'T00:00:00+07:00' ||
      parsed.data.period.toExclusive !== request.toExclusive + 'T00:00:00+07:00'
    )
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}
