import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { connectTestDatabase } from './test-database.mjs';
const folder = resolve(import.meta.dirname, '../db/migrations');
const sql = await connectTestDatabase();
try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(981705, 1)`;
    await tx`create schema if not exists portal_meta`;
    await tx`create table if not exists portal_meta.migrations (id text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    const files = (await readdir(folder))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    const applied = await tx`select id, checksum from portal_meta.migrations order by id`;
    for (const row of applied)
      if (!files.includes(row.id)) throw new Error('Applied migration is missing from source');
    for (const name of files) {
      const source = await readFile(resolve(folder, name), 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const previous = applied.find((row) => row.id === name);
      if (previous && previous.checksum !== checksum)
        throw new Error('Applied migration checksum changed');
      if (previous) {
        console.log(`${name}: already applied, checksum verified`);
        continue;
      }
      await tx.unsafe(source);
      await tx`insert into portal_meta.migrations (id, checksum) values (${name}, ${checksum})`;
      console.log(`${name}: applied to isolated test database`);
    }
  });
} finally {
  await sql.end();
}
