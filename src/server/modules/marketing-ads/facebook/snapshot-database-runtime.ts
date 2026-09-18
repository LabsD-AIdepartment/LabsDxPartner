import postgres from 'postgres';
import {
  readCredentialConfig,
  credentialBindingDigest,
  CREDENTIAL_BINDING_ID,
} from '@/server/modules/identity/credential-auth';
import { createSnapshotDatabase } from './snapshot-database';
import type { AdSnapshotBindingConfigValue } from './snapshot-config';

/** Database connection only: deliberately no provider or credential injector import. */
export function createSnapshotDatabaseRuntime(env: Record<string, string | undefined>) {
  const config = readCredentialConfig(env);
  const namespace = credentialBindingDigest(config);
  const sql = postgres(config.DATABASE_URL, {
    max: 2,
    connect_timeout: 5,
    idle_timeout: 20,
    onnotice: () => {},
  });
  const store = createSnapshotDatabase(sql, namespace);
  const assertBinding = async () => {
    const [row] =
      await sql`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
    if (row?.namespace_digest !== namespace) throw new Error('Namespace unavailable');
  };
  return { store, assertBinding, close: () => sql.end() };
}

let runtime: ReturnType<typeof createSnapshotDatabaseRuntime> | undefined;
export async function readDatabaseAdSnapshot(binding: AdSnapshotBindingConfigValue) {
  runtime ??= createSnapshotDatabaseRuntime(process.env);
  await runtime.assertBinding();
  await runtime.store.request(binding);
  return runtime.store.read(binding);
}
