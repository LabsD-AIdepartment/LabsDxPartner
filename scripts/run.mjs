import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoProductionFixtures } from './verify-no-demo.mjs';
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
if (command === 'typecheck') {
  const generated = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules/next/dist/bin/next'), 'typegen'],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (generated.status !== 0) process.exit(generated.status ?? 1);
}
const cmds = {
  dev: ['next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '4187'],
  build: ['next/dist/bin/next', 'build'],
  start: ['next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '4188'],
  typecheck: ['typescript/bin/tsc', '--noEmit'],
  test: ['vitest/vitest.mjs', 'run'],
  'test:e2e': ['@playwright/test/cli.js', 'test'],
};
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
