import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { hashPassword } from 'better-auth/crypto';
import { NewPassword, Username } from '@/contracts/credentials';
import { createCredentialIdentity, type CredentialConfig } from './credential-auth';
import { transactionDatabase } from './transaction-auth';

/** Identity-owned primitive. Caller supplies the transaction; never an HTTP password-hash argument. */
export function credentialRegistration(config: CredentialConfig) {
  return {
    async prepare(password: string) {
      return hashPassword(NewPassword.parse(password));
    },
    async create(
      tx: TransactionSql,
      input: { username: string; name: string; passwordHash: string },
    ) {
      const context = await createCredentialIdentity(config, transactionDatabase(tx)).$context;
      const user = await context.internalAdapter.createUser(
        {
          name: input.name,
          username: Username.parse(input.username),
          email: `${randomUUID()}@identity.invalid`,
          emailVerified: false,
        },
        { method: 'admin' },
      );
      await context.internalAdapter.createAccount({
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: input.passwordHash,
      });
      return user.id;
    },
  };
}
