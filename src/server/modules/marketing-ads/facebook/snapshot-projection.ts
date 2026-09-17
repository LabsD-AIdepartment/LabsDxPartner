import { AdPerformanceSnapshot } from '@/contracts/ad-performance-snapshot';
import type { AdSnapshotBindingConfigValue } from './snapshot-config';
import { celebSafeAdPerformance, projectPerformance } from '../partner-performance';

// Project a validated persisted snapshot into the PUBLIC Celeb-safe PartnerAdPerformance. The entire
// snapshot is re-validated here (never trust the file on disk), and the stored binding is re-checked
// against the CURRENT server-config binding (identity/clip/window PLUS connection/profile/account/
// namespace/ad/currency/timezone/creative/video) before any projection. A persisted snapshot for the
// same clip/window but an OLD ad/account/creative/permission is therefore rejected rather than served
// — configuration is authoritative at request time. `spend` is gated on the CURRENT permission (an
// old snapshot's canViewSpend is never trusted); ROAS stays visible regardless.

export class AdSnapshotScopeError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export function projectAdSnapshot(
  rawSnapshot: unknown,
  request: { identity: string; clipId: string; from: string; toExclusive: string },
  current: AdSnapshotBindingConfigValue,
) {
  const snapshot = AdPerformanceSnapshot.parse(rawSnapshot);
  const { binding, requestedPeriod, report } = snapshot;
  if (binding.identity !== request.identity) throw new AdSnapshotScopeError('identity mismatch');
  if (binding.clipId !== request.clipId) throw new AdSnapshotScopeError('clip mismatch');
  // The stored binding must equal the CURRENT config binding on every fenced dimension. `connectionId`
  // is the profile id the snapshot was refreshed under; `canViewSpend` is intentionally NOT compared
  // here — the current permission is applied below, never the snapshot's.
  if (
    binding.namespace !== current.namespace ||
    binding.connectionId !== current.profileId ||
    binding.accountId !== current.accountId ||
    binding.adId !== current.adId ||
    binding.currency !== current.currency ||
    binding.timezone !== current.timezone ||
    binding.expectedCreativeId !== current.expectedCreativeId ||
    (binding.expectedVideoId ?? null) !== (current.expectedVideoId ?? null)
  )
    throw new AdSnapshotScopeError('binding mismatch');
  const period = {
    from: request.from + 'T00:00:00+07:00',
    toExclusive: request.toExclusive + 'T00:00:00+07:00',
    timezone: 'Asia/Bangkok' as const,
  };
  if (period.from !== requestedPeriod.from || period.toExclusive !== requestedPeriod.toExclusive)
    throw new AdSnapshotScopeError('window mismatch');
  const performance = celebSafeAdPerformance(
    projectPerformance(period, [report], current.canViewSpend),
    current.canViewSpend,
  );
  // The UI must not guess the origin platform/ad: label the source authoritatively as the Facebook
  // ad this snapshot is bound to. (Account/namespace/credential identities stay excluded.)
  return { ...performance, source: `Facebook · Ad ${binding.adId}`,
    // Full API response for the calendar range as observed now, not a closed-day total.
    // Keep dataThrough unknown: fetch time is not a provider completeness watermark.
    intraday: Date.parse(report.fetchedAt) < Date.parse(period.toExclusive),
  };
}
