import { request } from 'node:http';
import { DEFAULT_WORKER_WATCHDOG_MS } from './worker-supervisor.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states = new Set([
  'starting',
  'running',
  'stopping',
  'backoff',
  'failed',
  'stopped',
  'disabled',
]);

/** One bounded independent loopback observation. No credentials, SQL or provider calls.
 * @param {{platform:'facebook'|'tiktok',port:number,timeoutMs?:number}} options
 */
export async function checkWorkerHealth({ platform, port, timeoutMs = 2000 }) {
  if (
    !['facebook', 'tiktok'].includes(platform) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10000
  )
    throw Error('Invalid health monitor configuration');
  /** @param {string} status @param {string} reason @param {Record<string,unknown>} [extra] */
  const result = (status, reason, extra = {}) => ({
    schemaVersion: 1,
    monitor: 'acquisition-process',
    platform,
    checkedAt: new Date().toISOString(),
    status,
    reason,
    ...extra,
  });
  return new Promise((resolve) => {
    let complete = false;
    /** @param {Record<string,unknown>} value */
    const finish = (value) => {
      if (!complete) {
        complete = true;
        clearTimeout(deadline);
        resolve(value);
      }
    };
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
        agent: false,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      },
      (res) => {
        if (
          ![200, 503].includes(res.statusCode) ||
          !/^application\/json(?:;|$)/i.test(res.headers['content-type'] ?? '')
        ) {
          finish(result('unavailable', 'invalid-response'));
          res.destroy();
          req.destroy();
          return;
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 8192) {
            finish(result('unavailable', 'invalid-response'));
            res.destroy();
            req.destroy();
          } else chunks.push(chunk);
        });
        res.on('error', () => finish(result('unavailable', 'connection-error')));
        res.on('end', () => {
          if (complete) return;
          try {
            const health = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (
              !health ||
              health.schemaVersion !== 1 ||
              health.platform !== platform ||
              !states.has(health.state) ||
              typeof health.attention !== 'boolean' ||
              typeof health.supervisorRunId !== 'string' ||
              !uuid.test(health.supervisorRunId) ||
              !Number.isSafeInteger(health.sequence) ||
              health.sequence < 1 ||
              !Number.isSafeInteger(health.starts) ||
              health.starts < 0 ||
              health.workerRunId !==
                (health.starts ? `${health.supervisorRunId}:${health.starts}` : null)
            )
              throw Error('Malformed health');
            const recorded =
              typeof health.recordedAt === 'string' ? Date.parse(health.recordedAt) : NaN;
            const now = Date.now();
            if (!Number.isFinite(recorded)) throw Error('Invalid timestamp');
            // Only validated correlation identifiers cross into output; never echo raw response fields.
            const extra = {
              supervisorRunId: health.supervisorRunId,
              workerRunId: health.workerRunId,
              sequence: health.sequence,
            };
            if (recorded > now) {
              finish(result('unavailable', 'clock-skew', extra));
              return;
            }
            if (now - recorded >= DEFAULT_WORKER_WATCHDOG_MS) {
              finish(result('unavailable', 'stale-progress', extra));
              return;
            }
            if (health.state !== 'running') {
              finish(result('unavailable', 'not-running', extra));
              return;
            }
            if (!['worker.cycle', 'worker.recovered'].includes(health.event) || health.starts < 1)
              throw Error('Invalid running event');
            const progress =
              typeof health.lastProgressAt === 'string' ? Date.parse(health.lastProgressAt) : NaN;
            if (!Number.isFinite(progress) || progress > recorded) throw Error('Invalid progress');
            const progressAgeMs = now - progress;
            if (progressAgeMs >= DEFAULT_WORKER_WATCHDOG_MS) {
              finish(result('unavailable', 'stale-progress', extra));
              return;
            }
            if (health.logCapture !== undefined) {
              if (
                !health.logCapture ||
                !['ready', 'unavailable', 'closed'].includes(health.logCapture.state)
              )
                throw Error('Invalid capture');
              if (
                health.logCapture.state !== 'ready' ||
                health.logCapture.lastStoredSequence !== health.sequence
              ) {
                finish(result('unavailable', 'log-unavailable', extra));
                return;
              }
            }
            if (res.statusCode !== 200) {
              finish(result('unavailable', 'invalid-response', extra));
              return;
            }
            finish(
              result(
                health.attention ? 'attention' : 'ok',
                health.attention ? 'cycle-attention' : 'progress',
                { ...extra, progressAgeMs },
              ),
            );
          } catch {
            finish(result('unavailable', 'invalid-response'));
          }
        });
      },
    );
    // Absolute deadline also bounds a server that dribbles bytes without ever ending the body.
    const deadline = setTimeout(() => {
      finish(result('unavailable', 'timeout'));
      req.destroy();
    }, timeoutMs);
    req.on('error', () => finish(result('unavailable', 'connection-error')));
    req.end();
  });
}
