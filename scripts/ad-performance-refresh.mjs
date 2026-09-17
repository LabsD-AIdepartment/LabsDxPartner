// Operator CLI: refresh the ad-performance snapshot files for the configured binding allowlist.
// Root runs this — the author executes no command. It performs a READ-ONLY Graph report per binding
// and writes a validated local snapshot file that carries NO credential and NO prohibited count.
//
// The read-only Graph token is injected by REFERENCE only, from the macOS Keychain, into the env var
// name that the Facebook profile declares (profile.tokenEnv). Never paste a token value.
//
// Usage (the modules are TypeScript, so load the tsx loader):
//   LABSD_AD_SNAPSHOT_ENABLED=1 \
//   LABSD_FACEBOOK_READ_ENABLED=1 \
//   LABSD_FACEBOOK_PROFILES='[...]' \
//   LABSD_AD_SNAPSHOT_BINDINGS='[...]' \
//   LABSD_FB_PRIMARY_TOKEN="$(security find-generic-password -s Meta_FraudCheck_API -w)" \
//   node --import tsx scripts/ad-performance-refresh.mjs
//
// Optional: LABSD_AD_SNAPSHOT_DIR overrides the (project-local) snapshot directory.

import { refreshAdSnapshots } from '../src/server/modules/marketing-ads/facebook/snapshot-refresh.ts';
import { adSnapshotDir } from '../src/server/modules/marketing-ads/facebook/snapshot-config.ts';
import { SourceReadError } from '../src/server/modules/marketing-ads/source-error.ts';
import { writeSnapshotFile } from '../dev/ad-performance/store.ts';

async function main() {
  const dir = adSnapshotDir(process.env);
  const results = await refreshAdSnapshots({
    env: process.env,
    fetch,
    now: Date.now,
    write: async (fileName, contents) => writeSnapshotFile(dir, fileName, contents),
    log: (message) => console.log(message),
  });
  console.log(`ad-snapshot: refreshed ${results.length} binding(s) into ${dir}`);
  for (const r of results) console.log(`  - ${r.identity}/${r.clipId}: ${r.state} -> ${r.file}`);
}

main().catch((error) => {
  // Never print an arbitrary Error.message/stack: a caller/file/Zod (or future unknown) error could
  // echo an injected token or a Graph URL. Emit ONLY a validated, provider-independent category —
  // a SourceReadError.code (already sanitized: no payloads/URLs/credentials) or a fixed generic
  // label. Message-only redaction is NOT assumed secret-safe for arbitrary errors.
  const category =
    error instanceof SourceReadError ? `source-read:${error.code}` : 'refresh-failed';
  console.error('ad-snapshot refresh failed:', category);
  process.exitCode = 1;
});
