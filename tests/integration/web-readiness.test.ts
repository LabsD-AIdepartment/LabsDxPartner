import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { checkIdentityReadiness } from '@/server/modules/identity/readiness';
import { createReadinessProbe } from '@/server/platform/health/readiness';
import { CREDENTIAL_BINDING_ID } from '@/server/modules/identity/credential-auth';
import requiredMigrations from '../../db/required-migrations.json';
import { readyResponse } from '@/server/http/health';

let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let digest: string;
beforeAll(async () => {
  sql = await connectTestDatabase();
  const [row] =
    await sql`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
  if (!row)
    throw Error(
      'Existing isolated credential binding required; no binding is provisioned by this test',
    );
  digest = row.namespace_digest;
});
afterAll(async () => {
  await sql?.end();
});

describe('web readiness using isolated PostgreSQL', () => {
  it('checks the real binding and leaves ordinary connection timeout settings unchanged', async () => {
    // Hold one of the two test-pool connections so all checks use the same other backend.
    // postgres.js reserved handles do not provide begin() at runtime.
    const held = await sql.reserve();
    try {
      const before =
        await sql`select pg_backend_pid() as pid, current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock`;
      await checkIdentityReadiness(sql, digest);
      const after =
        await sql`select pg_backend_pid() as pid, current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock`;
      expect(after).toEqual(before);
    } finally {
      held.release();
    }
  });

  it('rejects a mismatched namespace without changing the existing binding', async () => {
    await expect(checkIdentityReadiness(sql, 'synthetic-wrong-digest')).rejects.toThrow(
      'Identity unavailable',
    );
    await expect(checkIdentityReadiness(sql, digest)).resolves.toBeUndefined();
  });

  it('returns unavailable for valid binding but missing or mismatched required migrations', async () => {
    // Candidate version ahead of this DB; no applied ledger or migration file is edited.
    const missing = [
      ...requiredMigrations,
      { id: '9999_synthetic_future.sql', checksum: '0'.repeat(64) },
    ];
    const mismatch = requiredMigrations.map((entry, index) =>
      index === 0 ? { ...entry, checksum: '0'.repeat(64) } : entry,
    );
    for (const required of [missing, mismatch]) {
      const ready = createReadinessProbe(() => checkIdentityReadiness(sql, digest, required));
      const response = await readyResponse(
        new Request('https://example.test/api/ready'),
        () => ({ ready }),
        { LABSD_IDENTITY_ENABLED: '1' },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'unavailable' });
    }
    await expect(checkIdentityReadiness(sql, digest)).resolves.toBeUndefined();
  });

  it('bounds a saturated pool, keeps one pending check, and recovers after real release', async () => {
    const first = await sql.reserve(),
      second = await sql.reserve();
    let calls = 0;
    let operation: Promise<void> | undefined;
    const probe = createReadinessProbe(() => {
      calls++;
      return (operation = checkIdentityReadiness(sql, digest));
    });
    const start = performance.now();
    try {
      expect(await probe()).toBe(false);
      expect(performance.now() - start).toBeLessThan(3000);
      expect(await Promise.all(Array.from({ length: 20 }, () => probe()))).toEqual(
        Array(20).fill(false),
      );
      expect(calls).toBe(1);
    } finally {
      first.release();
      second.release();
    }
    await operation;
    expect(await probe()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    expect(await probe()).toBe(true);
    expect(calls).toBe(2);
  });
});
