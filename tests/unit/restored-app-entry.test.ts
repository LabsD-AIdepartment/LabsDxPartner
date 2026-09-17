// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('restored native app entry refuses unsafe input before connecting', () => {
  for (const [name, args, file] of [
    ['supplied target', ['--target=labsd_partner_test'], ''],
    ['external receipt', [], '/outside/result.json'],
    ['missing receipt', [], ''],
  ] as const)
    it(name, () => {
      const result = spawnSync(
        process.execPath,
        ['scripts/run.mjs', 'test:restored-app', ...args],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: { ...process.env, LABSD_RESTORE_RESULT: file, LABSD_DRILL_IDENTITY_CONFIG: '' },
          timeout: 10000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      const summary = JSON.parse(result.stdout.trim());
      expect(summary).toMatchObject({ status: 'failed', stage: 'preflight' });
      expect(summary).not.toHaveProperty('output');
    });
});
