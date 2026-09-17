// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertProjectCluster,
  comparableSchema,
  identifier,
  restoreName,
  sourceForDrill,
  toolEnvironment,
} from '../../scripts/restore-drill-guards.mjs';

afterEach(() => vi.unstubAllEnvs());
describe('isolated backup/restore drill boundaries', () => {
  const good = 'postgresql://labsd_test@127.0.0.1:55487/labsd_partner_test';
  it('allows only the dedicated synthetic source with no connection overrides', () => {
    expect(sourceForDrill(good).pathname).toBe('/labsd_partner_test');
    for (const value of [
      good.replace('55487', '5432'),
      good.replace('127.0.0.1', 'example.com'),
      good.replace('labsd_partner_test', 'production'),
      good.replace('labsd_test@', 'g@'),
      good.replace('labsd_test@', 'labsd_test:secret@'),
      good + '?host=example.com',
      good + '#override',
      'invalid',
    ])
      expect(() => sourceForDrill(value)).toThrow();
  });
  it('refuses cluster paths outside the project work area, including prefix lookalikes', () => {
    expect(() => assertProjectCluster('/project/.agent-work/pg', '/project')).not.toThrow();
    for (const path of [
      '/project/.agent-work-other/pg',
      '/project/.agent-work/../../other',
      '/outside/pg',
    ])
      expect(() => assertProjectCluster(path, '/project')).toThrow();
  });
  it('cannot name the source, an arbitrary existing database or SQL as its target', () => {
    expect(restoreName('a'.repeat(32))).toBe('labsd_restore_' + 'a'.repeat(32));
    for (const value of [
      'labsd_partner_test',
      'production',
      'a'.repeat(33),
      'a'.repeat(31) + ';',
      'DROP DATABASE x',
    ])
      expect(() => restoreName(value)).toThrow();
    expect(identifier('odd"table')).toBe('"odd""table"');
  });
  it('does not inherit libpq redirection, password or service configuration', () => {
    vi.stubEnv('PGHOST', 'example.com');
    vi.stubEnv('PGPASSWORD', 'must-not-propagate');
    vi.stubEnv('PGSERVICE', 'production');
    vi.stubEnv('PGOPTIONS', '-c search_path=other');
    const env = toolEnvironment('/project/.agent-work/drill', 'generated');
    expect(env.PGHOST).toBe('127.0.0.1');
    expect(env.PGDATABASE).toBe('generated');
    expect(env.PGPASSFILE).toBe('/project/.agent-work/drill/unused-password-file');
    expect(env.TMPDIR).toBe('/project/.agent-work/drill/tmp');
    expect(env).not.toHaveProperty('PGPASSWORD');
    expect(env).not.toHaveProperty('PGSERVICE');
    expect(env).not.toHaveProperty('PGOPTIONS');
  });
  it('ignores only pg_dump restriction nonces, not actual schema differences', () => {
    const a = '\\restrict abc123\nCREATE TABLE a(id int);\n\\unrestrict abc123\n';
    const b = '\\restrict XYZ789\nCREATE TABLE a(id int);\n\\unrestrict XYZ789\n';
    expect(comparableSchema(a)).toBe(comparableSchema(b));
    expect(comparableSchema(a)).not.toBe(comparableSchema(b.replace('int', 'text')));
    expect(comparableSchema('SELECT 1; -- keep\n')).toBe('SELECT 1; -- keep\n');
  });
  it('rejects caller-supplied targets before creating artifacts or opening a connection', () => {
    const run = spawnSync(
      process.execPath,
      ['scripts/restore-drill.mjs', '--target=labsd_partner_test'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, LABSD_TEST_DATABASE_URL: good },
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toMatchObject({
      status: 'failed',
      stage: 'preflight',
      workDirectory: null,
    });
  });
});
