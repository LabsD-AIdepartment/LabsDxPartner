import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoProductionFixtures } from './verify-no-demo.mjs';
import { verifyMigrationManifest } from './verify-migration-manifest.mjs';
const root = resolve(import.meta.dirname, '..');
const work = resolve(root, '.agent-work/runtime');
for (const folder of ['tmp', 'cache', 'evidence'])
  mkdirSync(resolve(work, folder), { recursive: true });
const env = {
  ...process.env,
  TMPDIR: resolve(work, 'tmp'),
  XDG_CACHE_HOME: resolve(work, 'cache'),
  NEXT_TELEMETRY_DISABLED: '1',
  PLAYWRIGHT_BROWSERS_PATH: resolve(work, 'cache/playwright'),
};
const [command, ...args] = process.argv.slice(2);
if (command === 'build' || command === 'typecheck') verifyMigrationManifest(root);
if (command === 'typecheck') {
  const generated = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules/next/dist/bin/next'), 'typegen'],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (generated.status !== 0) process.exit(generated.status ?? 1);
}
const cmds = {
  dev: [resolve(root, 'scripts/local-dev.mjs')],
  build: ['next/dist/bin/next', 'build'],
  start: ['next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '4188'],
  // Generated Next route declarations can change between dev/typegen/build.
  // TS7's retained incremental graph has produced false `Route extends never` errors here.
  // A fresh graph checks the complete program; no files or diagnostics are excluded.
  typecheck: ['typescript/bin/tsc', '--noEmit', '--incremental', 'false'],
  test: ['vitest/vitest.mjs', 'run'],
  'import:once': ['tsx/dist/cli.mjs', resolve(root, 'scripts/import-once.ts')],
  'marketing:provision': ['tsx/dist/cli.mjs', resolve(root, 'scripts/marketing-provision.ts')],
  'shop-video:sync': ['tsx/dist/cli.mjs', resolve(root, 'scripts/shop-video-sync.ts')],
  'marketing:sync': ['tsx/dist/cli.mjs', resolve(root, 'scripts/marketing-sync-once.ts')],
  'test:integration': ['vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts'],
  'test:performance': ['vitest/vitest.mjs', 'run', '--config', 'vitest.performance.config.ts'],
  'test:restored-app': [
    'tsx/dist/cli.mjs',
    resolve(root, 'tests/helpers/restored-app-acceptance.ts'),
  ],
  'test:e2e': ['@playwright/test/cli.js', 'test'],
};
if (command === 'services:monitor') {
  // Loader mode avoids the tsx CLI's IPC socket under long project-local temporary paths.
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve(root, 'scripts/service-monitor.ts'), ...args],
    {
      cwd: root,
      env,
      stdio: 'inherit',
    },
  );
  process.exit(result.status ?? 1);
}
if (command === 'db:migrate:test') {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/migrate-test.mjs')], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}
if (command === 'verify:no-demo' || command === 'build') {
  const checked = spawnSync(process.execPath, [resolve(root, 'scripts/verify-no-demo.mjs')], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (checked.status !== 0) process.exit(checked.status ?? 1);
  if (command === 'verify:no-demo') process.exit(0);
}
if (!cmds[command]) {
  console.error(
    `${command}: not implemented in F00–F02; requires the later database/integration phase. No check was run.`,
  );
  process.exit(1);
}
if (!existsSync(resolve(root, 'node_modules', cmds[command][0])))
  throw new Error('Run npm ci with the pinned Node runtime first');
if (command === 'dev') {
  const child = spawn(process.execPath, [cmds.dev[0], ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      stopping = true;
      child.kill('SIGTERM');
    });
  child.on('error', () => {
    console.error('Local runtime launcher failed.');
    process.exitCode = 1;
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  process.exit(stopping ? 0 : (code ?? 1));
}
const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules', cmds[command][0]), ...cmds[command].slice(1), ...args],
  { cwd: root, env, stdio: 'inherit' },
);
if (command === 'build' && result.status === 0) {
  assertNoProductionFixtures(resolve(root, '.next/static'));
  console.log('Production browser bundles contain no development fixture markers');
}
process.exit(result.status ?? 1);
