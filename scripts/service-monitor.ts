import { createServer } from 'node:http';
import {
  monitorConfig,
  createServiceMonitor,
} from '../src/server/platform/monitoring/service-monitor';
import { createBoundedLogWriter } from '../src/server/platform/observability/sink';
import { createMonitorJournal } from '../src/server/platform/monitoring/monitor-journal';
import { resolve } from 'node:path';

const write = createBoundedLogWriter(process.stdout);
async function main() {
  if (process.argv.length !== 2) throw Error('Invalid monitor arguments');
  const config = monitorConfig(process.env);
  let journal: ReturnType<typeof createMonitorJournal> | undefined;
  const monitor = createServiceMonitor(config, (event) => {
    journal?.write(event);
    write(event);
  });
  const abort = new AbortController();
  const stop = () => abort.abort();
  const server = createServer((req, res) => {
    if (req.url !== '/health' || !['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const logCapture = journal?.status();
    // Re-evaluate freshness after filesystem checks, which can themselves be slow.
    const snapshot = monitor.snapshot();
    const latestSequence = snapshot.transitions.at(-1)?.sequence ?? null;
    const captured =
      !logCapture ||
      (logCapture.state === 'ready' && logCapture.lastStoredSequence === latestSequence);
    const status = snapshot.status === 'ok' && captured ? 'ok' : 'unavailable';
    res.writeHead(status === 'ok' ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(
      req.method === 'HEAD'
        ? undefined
        : JSON.stringify({ ...snapshot, status, ...(logCapture ? { logCapture } : {}) }),
    );
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 10;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    // Own listener first; a conflicting port must never launch a second loop.
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', resolve);
    });
    // Directory namespace is derived from this exclusively owned listener, never a supplied path.
    if (process.env.LABSD_MONITOR_LOG_ENABLED === '1') {
      journal = createMonitorJournal({
        directory: resolve(
          import.meta.dirname,
          '..',
          '.agent-work/runtime/logs/services',
          String(config.port),
        ),
        maxBytes: Number(process.env.LABSD_MONITOR_LOG_MAX_BYTES),
        maxFiles: Number(process.env.LABSD_MONITOR_LOG_MAX_FILES),
      });
    }
    await monitor.run(abort.signal);
  } finally {
    abort.abort();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    journal?.close();
  }
}
main().catch(() => {
  write({ event: 'service_monitor_failed', reason: 'unavailable' });
  process.exitCode = 2;
});
