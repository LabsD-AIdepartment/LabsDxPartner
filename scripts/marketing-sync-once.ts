import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { createConfiguredMarketingProviders } from '../src/server/modules/marketing-ads/composition';
import { runMarketingSyncCycle } from '../src/server/modules/marketing-ads/sync-cycle';
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
    process.env.LABSD_MARKETING_SYNC_ENABLED !== '1' ||
    process.env.LABSD_FACEBOOK_READ_ENABLED !== '1'
  ) {
    console.log(JSON.stringify({ requestId, state: 'disabled' }));
    return;
  }
  const historyDays = z.coerce
    .number()
    .int()
    .min(1)
    .max(366)
    .parse(process.env.LABSD_MARKETING_HISTORY_DAYS ?? 90);
  const config = readCredentialConfig(process.env),
    sql = postgres(config.DATABASE_URL, {
      max: 2,
      connect_timeout: 5,
      idle_timeout: 5,
      onnotice: () => {},
    });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.once('disconnect', stop);
  try {
    const assertBinding = async () => {
      const [row] =
        await sql`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
      if (row?.namespace_digest !== credentialBindingDigest(config))
        throw new Error('Namespace unavailable');
    };
    await assertBinding();
    const native = createConfiguredMarketingProviders(sql, process.env, assertBinding);
    if (!native.profiles.length) throw new Error('Source configuration unavailable');
    do {
      const result = await runMarketingSyncCycle(
        sql,
        native,
        assertBinding,
        controller.signal,
        historyDays,
      );
      console.log(JSON.stringify({ requestId, ...result }));
      reportWorkerProgress(result.attention > 0);
      if (!continuous) {
        if (result.attention) process.exitCode = 2;
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
