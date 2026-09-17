import { checkWorkerHealth } from '../src/server/modules/marketing-ads/worker-health.mjs';

const platform = process.argv[2];
try {
  if (process.argv.length !== 3 || !['facebook', 'tiktok'].includes(platform))
    throw Error('Invalid platform');
  const configured = process.env.LABSD_WORKER_HEALTH_PORT?.trim();
  if (configured && !/^\d+$/.test(configured)) throw Error('Invalid port');
  const port = configured ? Number(configured) : platform === 'facebook' ? 4191 : 4192;
  const result = await checkWorkerHealth({ platform, port });
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'ok' ? 0 : result.status === 'attention' ? 1 : 2;
} catch {
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      monitor: 'acquisition-process',
      status: 'unavailable',
      reason: 'invalid-configuration',
    }),
  );
  process.exitCode = 2;
}
