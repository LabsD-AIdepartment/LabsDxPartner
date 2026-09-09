import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authSchema, binding } from '../../../../db/schema/identity';
import { createIdentity } from './auth';
import { identityBindingDigest, readIdentityConfig } from './provider-config';
import { principalResolver } from './resolve-principal';
import { createIdentityMethods } from './methods';
import { transactionIdentity } from './transaction-auth';

type Runtime = {
  auth: ReturnType<typeof createIdentity>;
  assertBinding: () => Promise<void>;
  methods: ReturnType<typeof createIdentityMethods>;
};
let current: Runtime | undefined;
export function getIdentityRuntime(): Runtime | null {
  if (process.env.LABSD_IDENTITY_ENABLED !== '1') return null;
  if (current) return current;
  const config = readIdentityConfig(process.env);
  const sql = postgres(config.DATABASE_URL, { max: 10, idle_timeout: 20, connect_timeout: 5 });
  const db = drizzle(sql);
  const auth = createIdentity(
    config,
    drizzleAdapter(db, { provider: 'pg', schema: authSchema, transaction: true }),
  );
  const assertBinding = async () => {
    const rows = await db
      .select({ digest: binding.namespaceDigest })
      .from(binding)
      .where(eq(binding.id, 'current'))
      .limit(1);
    if (rows[0]?.digest !== identityBindingDigest(config))
      throw new Error('Identity namespace binding unavailable');
  };
  current = {
    auth,
    assertBinding,
    methods: createIdentityMethods(
      sql,
      principalResolver(auth, assertBinding),
      transactionIdentity(config),
    ),
  };
  return current;
}
