import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { superviseWorker } from '../src/server/modules/marketing-ads/worker-supervisor.mjs';
import { createWorkerEvents } from '../src/server/modules/marketing-ads/worker-events.mjs';
import { createWorkerJournal } from '../src/server/modules/marketing-ads/worker-journal.mjs';

const root = resolve(import.meta.dirname, '..');
const platform = process.argv[2];
let journal = null;
const events = createWorkerEvents(
  ['facebook', 'tiktok'].includes(platform) ? platform : null,
  (event) => {
    journal?.write(event);
    console.log(JSON.stringify(event));
  },
);
async function main() {
  if (process.argv.length !== 3 || !['facebook', 'tiktok'].includes(platform))
    throw new Error('Invalid platform');
  const required =
    platform === 'facebook'
      ? ['LABSD_MARKETING_ENABLED', 'LABSD_FACEBOOK_READ_ENABLED', 'LABSD_MARKETING_SYNC_ENABLED']
      : [
          'LABSD_MARKETING_ENABLED',
          'LABSD_TIKTOK_VIDEO_ENABLED',
          'LABSD_TIKTOK_VIDEO_SYNC_ENABLED',
        ];
  if (required.some((key) => process.env[key] !== '1')) {
    events.record({ state: 'disabled' });
    return;
  }
  const port = Number(
    process.env.LABSD_WORKER_HEALTH_PORT?.trim() || (platform === 'facebook' ? 4191 : 4192),
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid health port');
  const tmp = resolve(root, '.agent-work/runtime/tmp'),
    cache = resolve(root, '.agent-work/runtime/cache');
  mkdirSync(tmp, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const abort = new AbortController();
  let current = {
    state: 'starting',
    starts: 0,
    lastProgressAt: null,
    attention: false,
    reason: null,
  };
  let latestEvent = null;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const logCapture = journal?.status();
    res.writeHead(current.state === 'running' && logCapture?.state !== 'unavailable' ? 200 : 503);
    res.end(
      JSON.stringify({
        ...(latestEvent ?? { platform, ...current }),
        ...(logCapture ? { logCapture } : {}),
      }),
    );
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 20;
  const stop = () => abort.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    // Claim health port first: a second supervisor cannot start another local lane accidentally.
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    if (process.env.LABSD_WORKER_LOG_ENABLED === '1') {
      journal = createWorkerJournal({
        directory: resolve(root, '.agent-work/runtime/logs', platform, String(port)),
        maxBytes: Number(process.env.LABSD_WORKER_LOG_MAX_BYTES),
        maxFiles: Number(process.env.LABSD_WORKER_LOG_MAX_FILES),
      });
    }
    const result = await superviseWorker(
      () =>
        spawn(
          process.execPath,
          [
            '--import',
            'tsx',
            resolve(
              root,
              'scripts',
              platform === 'facebook' ? 'marketing-sync-once.ts' : 'shop-video-sync.ts',
            ),
            '--continuous',
          ],
          {
            cwd: root,
            env: {
              ...process.env,
              TMPDIR: tmp,
              XDG_CACHE_HOME: cache,
              NEXT_TELEMETRY_DISABLED: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          },
        ),
      {
        signal: abort.signal,
        onState: (state) => {
          current = state;
          latestEvent = events.record(state);
        },
      },
    );
    if (result.failed) process.exitCode = 1;
  } finally {
    abort.abort();
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main()
  .catch(() => {
    events.record({ state: 'failed', reason: 'unavailable' });
    process.exitCode = 1;
  })
  .finally(() => journal?.close());
