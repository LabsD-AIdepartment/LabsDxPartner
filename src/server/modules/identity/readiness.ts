import type { Sql } from 'postgres';
import { CREDENTIAL_BINDING_ID } from './credential-auth';
import requiredMigrations from '../../../../db/required-migrations.json';

/** Uses the web pool; transaction-local budgets never alter ordinary request settings. */
export async function checkIdentityReadiness(
  sql: Sql,
  expectedDigest: string,
  required: ReadonlyArray<{ id: string; checksum: string }> = requiredMigrations,
): Promise<void> {
  await sql.begin('read only', async (tx) => {
    await tx`set local statement_timeout = '1500ms'`;
    await tx`set local lock_timeout = '500ms'`;
    const [row] = await tx`select namespace_digest from portal_identity.binding
      where id=${CREDENTIAL_BINDING_ID} limit 1`;
    if (row?.namespace_digest !== expectedDigest) throw new Error('Identity unavailable');
    if (!required.length || required.length > 512) throw new Error('Schema unavailable');
    const ledger = await tx`select id,checksum from portal_meta.migrations
      where id = any(${required.map((entry) => entry.id)}) limit ${required.length}`;
    const applied = new Map(ledger.map((entry) => [entry.id, entry.checksum]));
    if (required.some((entry) => applied.get(entry.id) !== entry.checksum))
      throw new Error('Schema unavailable');
  });
}
