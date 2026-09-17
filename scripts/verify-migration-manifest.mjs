import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export function verifyMigrationManifest(root) {
  const folder = resolve(root, 'db/migrations');
  const actual = readdirSync(folder)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((id) => ({
      id,
      checksum: createHash('sha256')
        .update(readFileSync(resolve(folder, id)))
        .digest('hex'),
    }));
  const expected = JSON.parse(readFileSync(resolve(root, 'db/required-migrations.json'), 'utf8'));
  if (!actual.length || actual.length > 512 || JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      'Required migration manifest differs from SQL source; reconcile it before building.',
    );
}
