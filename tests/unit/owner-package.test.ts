// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
let packageDirectory: string;
beforeAll(() => {
  const built = spawnSync(process.execPath, ['scripts/build-shop-video-owner.mjs'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 20000,
  });
  expect(built.status, built.stderr + built.stdout).toBe(0);
  const artifact = JSON.parse(built.stdout.trim());
  packageDirectory = join(dirname(artifact.packageDirectory), 'unpacked');
  mkdirSync(packageDirectory);
  const unpack = spawnSync(
    'tar',
    ['-xzf', artifact.archive, '--strip-components=1', '-C', packageDirectory],
    { env: process.env, encoding: 'utf8' },
  );
  expect(unpack.status, unpack.stderr).toBe(0);
}, 25000);
it('loads the actual bundle in clean Node and preserves auth, collection and quota holds', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('tests/package/shop-video-owner-smoke.mjs'), packageDirectory],
    {
      cwd: packageDirectory,
      env: process.env,
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    verify: true,
    collect: true,
    quotaDenied: true,
    upstreamCalls: 3,
  });
});
it('ships generated public types that work for a separate package consumer', () => {
  const work = join(dirname(packageDirectory), 'consumer');
  mkdirSync(join(work, 'node_modules/@labsd'), { recursive: true });
  symlinkSync(packageDirectory, join(work, 'node_modules/@labsd/shop-video-owner'), 'dir');
  writeFileSync(join(work, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(work, 'consumer.ts'),
    `
import { createSaleDashboardShopVideoOwner, createTikTokQuotaGovernor, type ShopVideoOwnerOptions } from '@labsd/shop-video-owner';
const quota = createTikTokQuotaGovernor({appPerSecond: 2, shopPerSecond: 1, eval: async () => [1, 0]});
const options: ShopVideoOwnerOptions = {
 enabled: false, profiles: [], bindings: [], clients: [],
 connect: () => ({ query: async () => ({rows: []}), decryptToken: b => b.toString(), reserveRequest: quota.reserve })
};
const handler: (r: Request) => Promise<Response> = createSaleDashboardShopVideoOwner(options);
void handler;
// @ts-expect-error quota ownership cannot be omitted
const bad: ReturnType<ShopVideoOwnerOptions['connect']> = {query: async () => ({rows: []}), decryptToken: b => b.toString()};
`,
  );
  writeFileSync(
    join(work, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        types: ['node'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
      },
      include: ['consumer.ts'],
    }),
  );
  const checked = spawnSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', join(work, 'tsconfig.json')],
    { cwd: work, env: process.env, encoding: 'utf8', timeout: 15000 },
  );
  expect(checked.status, checked.stdout + checked.stderr).toBe(0);
});
it('records real source and output digests without implying release approval', () => {
  const receipt = JSON.parse(readFileSync(join(packageDirectory, 'build-receipt.json'), 'utf8'));
  expect(receipt.sourceHead).toMatch(/^[a-f0-9]{40}$/);
  expect(receipt.releaseApproved).toBe(false);
  for (const file of receipt.outputs)
    expect(
      createHash('sha256')
        .update(readFileSync(join(packageDirectory, file.path)))
        .digest('hex'),
    ).toBe(file.sha256);
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  expect(manifest.dependencies).toBeUndefined();
  expect(
    receipt.inputs.some((input: { path: string }) => input.path.includes('node_modules/zod/')),
  ).toBe(true);
  expect(
    receipt.inputs.some((input: { path: string }) =>
      /\.env|node_modules\/(next|react|postgres)\//.test(input.path),
    ),
  ).toBe(false);
});
