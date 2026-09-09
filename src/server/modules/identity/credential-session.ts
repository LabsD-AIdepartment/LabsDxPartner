import type { Sql, TransactionSql } from 'postgres';
import {
  createCredentialIdentity,
  credentialHandler,
  type CredentialConfig,
} from './credential-auth';
import { transactionDatabase } from './transaction-auth';

/** Read network input before the credential writer lock; a slow body cannot hold it. */
async function boundedLoginRequest(request: Request): Promise<Request | Response> {
  if (!request.body) return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('body-timeout')), 5000);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > 8192) return Response.json({ code: 'INVALID_REQUEST' }, { status: 413 });
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Request(request, { body });
  } catch (error) {
    return Response.json(
      { code: 'INVALID_REQUEST' },
      { status: error instanceof Error && error.message === 'body-timeout' ? 408 : 400 },
    );
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

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
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/auth/sign-in/username')
      return ordinary(request);
    if (request.headers.get('origin') !== config.BETTER_AUTH_URL)
      return Response.json({ code: 'INVALID_ORIGIN' }, { status: 403 });
    const buffered = await boundedLoginRequest(request);
    if (buffered instanceof Response) return buffered;
    return credentialWrite(sql, async (tx) => {
      const transactional = createCredentialIdentity(config, transactionDatabase(tx));
      return credentialHandler(transactional)(buffered);
    });
  };
}
