import { spawnSync } from 'node:child_process';
import { verifyMigrationManifest } from './verify-migration-manifest.mjs';
import { assertProductionFlags, assertApplicationImports } from './verify-no-demo.mjs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
verifyMigrationManifest(root);
assertProductionFlags(process.env);
assertApplicationImports(resolve(root, 'app'));
const result = spawnSync(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'build'], {
  cwd: root, stdio: 'inherit',
  env: {...process.env, NODE_ENV: 'production', LABSD_BUILD_TARGET: 'hosted-demo', NEXT_TELEMETRY_DISABLED: '1'},
});
process.exit(result.status ?? 1);
