import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createConfiguredShopVideoWorker } from '../src/server/modules/marketing-ads/tiktok-shop/video-composition';
import { reportWorkerProgress } from '../src/server/modules/marketing-ads/worker-progress';
import {
  readCredentialConfig,
  credentialBindingDigest,
  CREDENTIAL_BINDING_ID,
} from '../src/server/modules/identity/credential-auth';
const requestId = randomUUID();
async function main() {
  const args = process.argv.slice(2),
    continuous = args.length === 1 && args[0] === '--continuous';
  if (args.length && !continuous) throw new Error('Unsupported arguments');
  if (
    process.env.LABSD_MARKETING_ENABLED !== '1' ||
    process.env.LABSD_TIKTOK_VIDEO_SYNC_ENABLED !== '1' ||
    process.env.LABSD_TIKTOK_VIDEO_ENABLED !== '1'
  ) {
    console.log(JSON.stringify({ requestId, state: 'disabled' }));
    return;
  }
  const config = readCredentialConfig(process.env),
    sql = postgres(config.DATABASE_URL, {
      max: 2,
      connect_timeout: 5,
      idle_timeout: 5,
      onnotice: () => {},
      connection: { statement_timeout: 10000, lock_timeout: 3000 },
    });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.once('disconnect', stop);
  try {
    const assertBinding = async (tx: import('postgres').TransactionSql) => {
      const [row] =
        await tx`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
      if (row?.namespace_digest !== credentialBindingDigest(config))
        throw new Error('Namespace unavailable');
    };
    await sql.begin(assertBinding);
    const native = createConfiguredShopVideoWorker(sql, process.env, assertBinding);
    if (!native) throw new Error('Source configuration unavailable');
    do {
      const result = await native.run(controller.signal);
      reportWorkerProgress(
        result.results.some((r) => r.state === 'attention' || r.state === 'partial'),
      );
      console.log(JSON.stringify({ requestId, ...result }));
      if (!continuous) {
        if (result.results.some((r) => r.state === 'attention' || r.state === 'partial'))
          process.exitCode = 2;
        break;
      }
      if (!controller.signal.aborted) await delay(15_000, undefined, { signal: controller.signal });
    } while (!controller.signal.aborted);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    console.log(JSON.stringify({ requestId, state: 'stopped' }));
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    process.removeListener('disconnect', stop);
    await sql.end();
  }
}
main().catch(() => {
  console.error(JSON.stringify({ requestId, state: 'failed', code: 'unavailable' }));
  process.exitCode = 1;
});
