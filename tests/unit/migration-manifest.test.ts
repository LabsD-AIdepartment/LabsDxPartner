// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyMigrationManifest } from '../../scripts/verify-migration-manifest.mjs';

describe('build-time required migration manifest', () => {
  it('matches the real migration source and rejects missing, added or changed SQL', () => {
    const root = process.cwd();
    expect(() => verifyMigrationManifest(root)).not.toThrow();
    const work = resolve(root, '.agent-work/runtime/tmp');
    mkdirSync(work, { recursive: true });
    const copy = mkdtempSync(resolve(work, 'manifest-'));
    try {
      mkdirSync(resolve(copy, 'db'));
      cpSync(resolve(root, 'db/migrations'), resolve(copy, 'db/migrations'), { recursive: true });
      cpSync(
        resolve(root, 'db/required-migrations.json'),
        resolve(copy, 'db/required-migrations.json'),
      );
      const manifest = JSON.parse(
        readFileSync(resolve(copy, 'db/required-migrations.json'), 'utf8'),
      );
      const first = resolve(copy, 'db/migrations', manifest[0].id);
      const original = readFileSync(first);
      writeFileSync(first, 'changed synthetic SQL');
      expect(() => verifyMigrationManifest(copy)).toThrow('manifest differs');
      rmSync(first);
      expect(() => verifyMigrationManifest(copy)).toThrow('manifest differs');
      writeFileSync(first, original);
      writeFileSync(resolve(copy, 'db/migrations/9999_synthetic.sql'), 'select 1;');
      expect(() => verifyMigrationManifest(copy)).toThrow('manifest differs');
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
