import type { TransactionSql } from 'postgres';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authSchema } from '../../../../db/schema/identity';
import { createIdentity } from './auth';
import type { IdentityConfig } from './provider-config';

/** No second pool: native account mutations and application audit share one commit. */
export const transactionIdentity = (config: IdentityConfig) => (tx: TransactionSql) =>
  createIdentity(
    config,
    drizzleAdapter(
      // Drizzle's postgres-js constructor expects a pool with .options, not a
      // TransactionSql. Its supported query callback binds all generated SQL to
      // the already-open transaction, without pretending that tx is a pool.
      drizzle(async (query, params, method) => ({
        rows:
          method === 'all'
            ? await tx.unsafe(query, params).values()
            : await tx.unsafe(query, params),
      })),
      { provider: 'pg', schema: authSchema, transaction: false },
    ),
  );
