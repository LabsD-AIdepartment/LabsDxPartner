import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { AdSnapshotBinding } from '@/contracts/ad-performance-snapshot';

// SERVER-ONLY configuration for the dev ad-performance snapshot preview. Nothing here is
// NEXT_PUBLIC: the binding allowlist, the window and the snapshot directory are all resolved from
// the process environment on the server. The feature is OFF by default and only turns on when
// LABSD_AD_SNAPSHOT_ENABLED === '1'. A binding references a Facebook profile id (see facebook/config
// readFacebookProfiles) for credential resolution during refresh; the token itself is never read
// here and never leaves the refresh path.

/**
 * A single allowlisted preview binding: exactly which clip/ad/account/window may be previewed for a
 * given demo identity. `from`/`toExclusive` are inclusive-of-from local calendar dates in the ad
 * account timezone; the refresh path requests them as ONE full-period report so ratios are correct.
 */
export const AdSnapshotBindingConfig = z
  .strictObject({
    identity: AdSnapshotBinding.shape.identity,
    clipId: AdSnapshotBinding.shape.clipId,
    profileId: z.string().min(1).max(160),
    namespace: AdSnapshotBinding.shape.namespace,
    accountId: AdSnapshotBinding.shape.accountId,
    adId: AdSnapshotBinding.shape.adId,
    // expectedCreativeId is REQUIRED; expectedVideoId is optional (defaults to null when absent).
    expectedCreativeId: AdSnapshotBinding.shape.expectedCreativeId,
    expectedVideoId: z
      .string()
      .regex(/^\d{1,80}$/)
      .nullish()
      .transform((v) => v ?? null),
    currency: AdSnapshotBinding.shape.currency,
    timezone: AdSnapshotBinding.shape.timezone,
    from: z.iso.date(),
    toExclusive: z.iso.date(),
    canViewSpend: z.boolean().default(false),
  })
  .refine((v) => {
    const days = (Date.parse(v.toExclusive) - Date.parse(v.from)) / 86_400_000;
    // A bounded snapshot reader supporting up to 93 days (a single quarter aggregate), never 0/neg.
    return Number.isInteger(days) && days >= 1 && days <= 93;
  }, 'Snapshot window must be between 1 and 93 days');
export type AdSnapshotBindingConfigValue = z.infer<typeof AdSnapshotBindingConfig>;

const DEFAULT_DIR_RELATIVE = '.agent-work/20260917-ad-performance/snapshots';

/** True only when the operator has explicitly enabled the dev snapshot preview. Default: off. */
export function adSnapshotEnabled(env: Record<string, string | undefined>): boolean {
  return env.LABSD_AD_SNAPSHOT_ENABLED === '1';
}

/**
 * True only when the operator has explicitly opted into automatic local preview acquisition. Default:
 * off. When off, the dev endpoint keeps its exact configured-window, read-only behavior and never calls
 * the provider. This is independent of `adSnapshotEnabled`, which still gates the whole feature; auto
 * refresh only ever runs for an already-enabled, already-verified binding.
 */
export function adSnapshotAutoRefreshEnabled(env: Record<string, string | undefined>): boolean {
  return env.LABSD_AD_SNAPSHOT_AUTO_REFRESH === '1';
}

/** Parse + validate the binding allowlist. Works even while the preview is disabled (for operators). */
export function parseAdSnapshotBindings(raw: string | undefined): AdSnapshotBindingConfigValue[] {
  if (!raw || raw.length > 64_000)
    throw new Error('Ad snapshot binding configuration is missing or too large');
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('Invalid ad snapshot binding configuration');
  }
  const parsed = z.array(AdSnapshotBindingConfig).min(1).max(100).safeParse(input);
  if (!parsed.success) throw new Error('Invalid ad snapshot binding configuration');
  const bindings = parsed.data;
  if (
    new Set(bindings.map((b) => JSON.stringify([b.identity, b.clipId]))).size !== bindings.length ||
    new Set(bindings.map((b) => JSON.stringify([b.identity, b.namespace, b.accountId, b.adId]))).size !== bindings.length
  )
    throw new Error('Duplicate ad snapshot binding');
  return bindings;
}

/** The active binding allowlist: empty unless the feature is enabled. Never resolves any secret. */
export function readAdSnapshotBindings(
  env: Record<string, string | undefined>,
): AdSnapshotBindingConfigValue[] {
  if (!adSnapshotEnabled(env)) return [];
  return parseAdSnapshotBindings(env.LABSD_AD_SNAPSHOT_BINDINGS);
}

/** The one binding for a demo identity + clip, or null. Identity/clip come only from server config. */
export function findAdSnapshotBinding(
  bindings: readonly AdSnapshotBindingConfigValue[],
  identity: string,
  clipId: string,
): AdSnapshotBindingConfigValue | null {
  return bindings.find((b) => b.identity === identity && b.clipId === clipId) ?? null;
}

/** The project-local snapshot directory. An override must stay inside the project directory. */
export function adSnapshotDir(env: Record<string, string | undefined>): string {
  const override = env.LABSD_AD_SNAPSHOT_DIR;
  const cwd = process.cwd();
  if (override && override.length > 0) {
    const resolved = resolve(cwd, override);
    if (resolved !== cwd && !resolved.startsWith(cwd + sep))
      throw new Error(`ad-snapshot: LABSD_AD_SNAPSHOT_DIR must resolve inside the project: ${resolved}`);
    return resolved;
  }
  return resolve(cwd, DEFAULT_DIR_RELATIVE);
}

/** Deterministic, path-safe file name for a binding's snapshot. Inputs are already strict-validated. */
export function adSnapshotFileName(binding: {
  identity: string;
  clipId: string;
}): string {
  const clip = binding.clipId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${binding.identity}__${clip}.json`;
}

/**
 * Deterministic, path-safe file name for a WINDOW-SPECIFIC snapshot (auto-refresh cache). It embeds the
 * requested from/to ISO dates so a non-configured window is cached separately and never overwrites the
 * legacy base file (adSnapshotFileName). The result matches the store `SAFE_NAME` allowlist (leading
 * lowercase-alnum, then `__`, then only `[A-Za-z0-9_-]`, ending `.json`) and cannot traverse: the date
 * inputs are sanitized to digits/`-` only. Callers pass already-validated ISO dates.
 */
export function adSnapshotWindowFileName(
  binding: { identity: string; clipId: string },
  from: string,
  toExclusive: string,
): string {
  const clip = binding.clipId.replace(/[^A-Za-z0-9_-]/g, '_');
  const safeDate = (d: string) => d.replace(/[^0-9-]/g, '_');
  return `${binding.identity}__${clip}__${safeDate(from)}__${safeDate(toExclusive)}.json`;
}

/**
 * Build a requested-window binding from an already-verified configured binding, keeping every verified
 * ad/account/creative/video/currency/timezone/permission dimension UNCHANGED and only substituting the
 * requested `from`/`toExclusive`. Re-running the strict schema validates that the requested dates are
 * real ISO calendar dates with an integer duration of 1..93 days; anything else throws. This never
 * decouples the selected window silently — the returned binding drives a provider read for the EXACT
 * requested window.
 */
export function deriveRequestedWindowBinding(
  binding: AdSnapshotBindingConfigValue,
  from: string,
  toExclusive: string,
): AdSnapshotBindingConfigValue {
  return AdSnapshotBindingConfig.parse({ ...binding, from, toExclusive });
}
