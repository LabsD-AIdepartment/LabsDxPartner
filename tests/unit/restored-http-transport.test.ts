// @vitest-environment node
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRestoredHttp } from '../helpers/restored-http-transport';

describe('restored HTTP artifact guard', () => {
  it('refuses the active root build or an outside artifact', async () => {
    for (const directory of [process.cwd(), '/outside/build'])
      await expect(startRestoredHttp(process.cwd(), directory, '/unused')).rejects.toThrow();
  });
  it('refuses incomplete artifacts and redirected BUILD_ID before launching', async () => {
    const parent = resolve('.agent-work/runtime/tmp');
    await mkdir(parent, { recursive: true });
    const build = await mkdtemp(resolve(parent, 'restore-http-guard-'));
    await expect(
      startRestoredHttp(process.cwd(), build, resolve(build, 'result')),
    ).rejects.toThrow();
    await mkdir(resolve(build, '.next'));
    await writeFile(resolve(build, 'other-id'), 'validBuildId');
    await symlink(resolve(build, 'other-id'), resolve(build, '.next/BUILD_ID'));
    await expect(
      startRestoredHttp(process.cwd(), build, resolve(build, 'result')),
    ).rejects.toThrow();
  });
});
