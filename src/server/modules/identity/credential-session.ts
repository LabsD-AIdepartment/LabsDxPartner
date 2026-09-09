import type { Sql, TransactionSql } from 'postgres';
import {
  createCredentialIdentity,
  credentialHandler,
  type CredentialConfig,
} from './credential-auth';
import { transactionDatabase } from './transaction-auth';
import { boundedRequest } from '@/server/http/bounded-request';
import { PARTNER_COOKIE } from '../access/partner-session';

export async function credentialWrite<T>(
  sql: Sql,
  run: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`set local lock_timeout='5s'`;
    await tx`set local statement_timeout='10s'`;
    await tx`set local idle_in_transaction_session_timeout='10s'`;
    await tx`select pg_advisory_xact_lock(981705,2)`;
    return { value: await run(tx) };
  });
  return result.value;
}
/** Native password verification and session write serialize with reset/revocation; no network calls. */
export function credentialSessionHandler(
  sql: Sql,
  config: CredentialConfig,
  auth: ReturnType<typeof createCredentialIdentity>,
) {
  const ordinary = credentialHandler(auth);
  return async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || path !== '/api/auth/sign-in/username') {
      const response = await ordinary(request);
      if (request.method === 'POST' && path === '/api/auth/sign-out' && response.ok)
        response.headers.append(
          'Set-Cookie',
          `${PARTNER_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
        );
      return response;
    }
    if (request.headers.get('origin') !== config.BETTER_AUTH_URL)
      return Response.json({ code: 'INVALID_ORIGIN' }, { status: 403 });
    const buffered = await boundedRequest(request);
    if (buffered instanceof Response) return buffered;
    return credentialWrite(sql, async (tx) => {
      const transactional = createCredentialIdentity(config, transactionDatabase(tx));
      return credentialHandler(transactional)(buffered);
    });
  };
}
