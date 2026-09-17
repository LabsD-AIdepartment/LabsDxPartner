import { z } from 'zod';
import { SourceIdentityV2 } from '@/contracts/platform-capabilities';
import {
  AdPerformanceSnapshot,
  type AdPerformanceSnapshotValue,
} from '@/contracts/ad-performance-snapshot';
import { readFacebookProfiles } from './config';
import { FacebookReadError } from './graph';
import {
  readAdSnapshotBindings,
  adSnapshotFileName,
  type AdSnapshotBindingConfigValue,
} from './snapshot-config';
import { createFacebookSnapshotReader } from './snapshot-reader';

// Operator-driven refresh: turn the configured binding allowlist into validated local snapshot files.
// It resolves the read-only Graph token ONLY from the profile's injected env reference (never logs or
// returns it) and writes a snapshot that (by contract) carries no credential and no prohibited count.
// This is a pure orchestrator over injected fetch/now/write so it is unit-testable without network.
//
// `buildAdSnapshot` is the single authority for acquiring ONE validated snapshot (used both by the
// operator loop below and by the dev auto-refresh coordinator, which passes a requested-window binding).
// It never writes — the caller decides the file name — so the requested-window cache never overwrites
// the operator's configured-window base file.

export type SnapshotWriter = (fileName: string, contents: string) => Promise<void>;
export type BuildSnapshotDeps = {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
};
export type RefreshDeps = BuildSnapshotDeps & {
  write: SnapshotWriter;
  log?: (message: string) => void;
};
export type SnapshotState = z.infer<typeof AdPerformanceSnapshot>['report']['completeness'];
export type RefreshResult = {
  identity: string;
  clipId: string;
  file: string;
  state: SnapshotState;
};

/**
 * Acquire ONE validated snapshot for an already-validated binding. Resolves the read-only token ONLY
 * from the profile's injected env reference (never logged/returned), verifies profile/account scope and
 * ad/creative/video identity via the sanitized reader, and returns a snapshot that (by contract) carries
 * no credential and no prohibited count. Does NOT write — the caller owns the destination file name.
 */
export async function buildAdSnapshot(
  binding: AdSnapshotBindingConfigValue,
  deps: BuildSnapshotDeps,
): Promise<{ snapshot: AdPerformanceSnapshotValue; state: SnapshotState }> {
  const { env } = deps;
  const profiles = readFacebookProfiles(env);
  const signal = deps.signal ?? new AbortController().signal;
  const now = deps.now ?? Date.now;
  const profile = profiles.find((p) => p.id === binding.profileId);
  if (!profile)
    throw new Error(`Ad snapshot binding ${binding.identity}/${binding.clipId}: unknown profile ${binding.profileId}`);
  if (
    profile.namespace !== binding.namespace ||
    profile.accountId !== binding.accountId ||
    profile.currency !== binding.currency ||
    profile.timezone !== binding.timezone
  )
    throw new Error(
      `Ad snapshot binding ${binding.identity}/${binding.clipId} does not match profile ${profile.id} account scope`,
    );
  if (!env[profile.tokenEnv] || (profile.appSecretEnv && !env[profile.appSecretEnv]))
    throw new Error(
      `Ad snapshot binding ${binding.identity}/${binding.clipId}: missing injected credential ${profile.tokenEnv}`,
    );
  const connection = {
    id: profile.id,
    namespace: profile.namespace,
    accountId: profile.accountId,
    currency: profile.currency,
    timezone: profile.timezone,
  };
  const reader = createFacebookSnapshotReader(connection, {
    fetch: deps.fetch,
    now,
    credential: async (id, credentialSignal) => {
      credentialSignal.throwIfAborted();
      if (id !== profile.id || !env[profile.tokenEnv] || (profile.appSecretEnv && !env[profile.appSecretEnv]))
        throw new FacebookReadError('access');
      return {
        token: env[profile.tokenEnv]!,
        appSecret: profile.appSecretEnv ? env[profile.appSecretEnv] : undefined,
      };
    },
  });
  const identity = SourceIdentityV2.parse({
    schemaVersion: 2,
    platform: 'facebook',
    capability: 'facebook.ad_insights',
    namespace: binding.namespace,
    connectionId: profile.id,
    accountId: binding.accountId,
    objectType: 'ad',
    externalId: binding.adId,
  });
  const period = {
    from: binding.from + 'T00:00:00+07:00',
    toExclusive: binding.toExclusive + 'T00:00:00+07:00',
    timezone: 'Asia/Bangkok' as const,
  };
  const report = await reader.report(identity, period, signal, {
    creativeId: binding.expectedCreativeId,
    videoId: binding.expectedVideoId,
  });
  const snapshot = AdPerformanceSnapshot.parse({
    schemaVersion: 1,
    binding: {
      identity: binding.identity,
      clipId: binding.clipId,
      namespace: binding.namespace,
      connectionId: profile.id,
      accountId: binding.accountId,
      adId: binding.adId,
      expectedCreativeId: binding.expectedCreativeId,
      expectedVideoId: binding.expectedVideoId,
      currency: binding.currency,
      timezone: binding.timezone,
      canViewSpend: binding.canViewSpend,
    },
    requestedPeriod: period,
    report,
    fetchedAt: new Date(now()).toISOString(),
    refreshedBy: 'operator',
  });
  return { snapshot, state: report.completeness };
}

export async function refreshAdSnapshots(deps: RefreshDeps): Promise<RefreshResult[]> {
  const { env } = deps;
  const bindings = readAdSnapshotBindings(env);
  if (!bindings.length)
    throw new Error(
      'Ad snapshot refresh is disabled or unconfigured (set LABSD_AD_SNAPSHOT_ENABLED=1 and LABSD_AD_SNAPSHOT_BINDINGS)',
    );
  const results: RefreshResult[] = [];
  for (const binding of bindings) {
    const { snapshot, state } = await buildAdSnapshot(binding, deps);
    const file = adSnapshotFileName(binding);
    await deps.write(file, JSON.stringify(snapshot, null, 2));
    deps.log?.(`ad-snapshot: wrote ${file} (${state})`);
    results.push({ identity: binding.identity, clipId: binding.clipId, file, state });
  }
  return results;
}
