import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ignored = spawnSync('git', ['check-ignore', '-q', '.agent-work'], { cwd: root });
const tracked = spawnSync('git', ['ls-files', '--', '.agent-work'], {
  cwd: root,
  encoding: 'utf8',
});
if (ignored.status !== 0 || tracked.status !== 0 || tracked.stdout.trim())
  throw new Error('Owner artifacts must be ignored and untracked');
// Each invocation preserves the previous proof/artifact. No secrets or .env are read.
const work = join(root, '.agent-work/owner-package', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const out = join(work, 'package');
for (const path of [out, join(work, 'tmp'), join(work, 'cache')])
  mkdirSync(path, { recursive: true });
const env = { ...process.env, TMPDIR: join(work, 'tmp'), XDG_CACHE_HOME: join(work, 'cache') };
process.env.TMPDIR = env.TMPDIR;
process.env.XDG_CACHE_HOME = env.XDG_CACHE_HOME;
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot identify source artifact');
  return result.stdout.trim();
};
const sourceHead = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain').length > 0;
const compile = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules/typescript/bin/tsc'),
    '-p',
    'tsconfig.shop-video-owner.json',
    '--outDir',
    join(work, 'types'),
  ],
  { cwd: root, env, encoding: 'utf8' },
);
if (compile.status !== 0) {
  process.stderr.write(compile.stdout + compile.stderr);
  throw new Error('Owner declaration compilation failed');
}
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/server/modules/marketing-ads/tiktok-shop/package-entry.ts'],
  outfile: join(out, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  tsconfig: 'tsconfig.shop-video-owner.json',
  sourcemap: false,
  legalComments: 'eof',
  metafile: true,
});
copyFileSync(
  join(work, 'types/server/modules/marketing-ads/tiktok-shop/package-entry.d.ts'),
  join(out, 'index.d.ts'),
);
// Generated declaration must remain self-contained, not reference unpublished internal modules.
const declaration = readFileSync(join(out, 'index.d.ts'), 'utf8');
if (/\b(?:from|import)\s*[('"].*(?:@\/|\.\/|\.\.\/)/.test(declaration))
  throw new Error('Owner public declarations contain private imports');
const outputs = Object.values(result.metafile.outputs);
if (outputs.some((o) => o.imports.some((i) => !['node:crypto'].includes(i.path))))
  throw new Error('Owner runtime has unexpected external dependencies');
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: '@labsd/shop-video-owner',
      version: '0.2.0',
      private: true,
      type: 'module',
      engines: { node: '>=24' },
      exports: { '.': { types: './index.d.ts', import: './index.mjs' } },
      files: ['index.mjs', 'index.d.ts', 'THIRD_PARTY_LICENSES.txt', 'build-receipt.json'],
    },
    null,
    2,
  ) + '\n',
);
copyFileSync(join(root, 'node_modules/zod/LICENSE'), join(out, 'THIRD_PARTY_LICENSES.txt'));
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const inputs = Object.keys(result.metafile.inputs)
  .sort()
  .map((path) => ({ path, sha256: digest(join(root, path)) }));
const receipt = {
  sourceHead,
  dirty,
  releaseApproved: false,
  tools: {
    esbuild: JSON.parse(readFileSync(join(root, 'node_modules/esbuild/package.json'))).version,
    typescript: JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json')))
      .version,
    node: process.version,
  },
  inputs,
  recipe: ['scripts/build-shop-video-owner.mjs', 'tsconfig.shop-video-owner.json', 'package-lock.json'].map((path) => ({path, sha256: digest(join(root, path))})),
  outputs: ['index.mjs', 'index.d.ts', 'package.json', 'THIRD_PARTY_LICENSES.txt'].map((path) => ({
    path,
    sha256: digest(join(out, path)),
  })),
};
writeFileSync(join(out, 'build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
writeFileSync(join(work, 'metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
const packed = spawnSync(
  'npm',
  [
    'pack',
    '--offline',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    work,
    '--cache',
    join(work, 'cache/npm'),
  ],
  { cwd: out, env, encoding: 'utf8' },
);
if (packed.status !== 0) throw new Error('Owner package archive failed');
const archive = join(work, JSON.parse(packed.stdout)[0].filename);
console.log(
  JSON.stringify({
    packageDirectory: out,
    archive,
    archiveSha256: digest(archive),
    sourceHead,
    dirty,
    releaseApproved: false,
  }),
);
