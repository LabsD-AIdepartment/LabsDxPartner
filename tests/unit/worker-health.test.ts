// @vitest-environment node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { checkWorkerHealth } from '@/server/modules/marketing-ads/worker-health.mjs';
import { createWorkerEvents } from '@/server/modules/marketing-ads/worker-events.mjs';

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing address');
  return {
    port: address.port,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
function health(patch: Record<string, unknown> = {}) {
  return {
    ...createWorkerEvents('facebook').record({
      state: 'running',
      starts: 1,
      lastProgressAt: new Date().toISOString(),
    }),
    ...patch,
  };
}
async function cli(port: number, platform = 'facebook') {
  const child = spawn(process.execPath, ['scripts/marketing-health.mjs', platform], {
    env: { NODE_ENV: 'test', PATH: process.env.PATH, LABSD_WORKER_HEALTH_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    error = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    error += chunk;
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [code, signal] = await once(child, 'exit');
    expect(signal).toBeNull();
    expect(error).toBe('');
    return { code, output, result: JSON.parse(output.trim()) };
  } finally {
    clearTimeout(deadline);
  }
}

describe('independent process health monitor', () => {
  it.each([
    ['ok', 200, {}, 'ok', 'progress'],
    ['attention', 200, { attention: true }, 'attention', 'cycle-attention'],
    ['backoff', 503, { state: 'backoff' }, 'unavailable', 'not-running'],
    [
      'stale',
      200,
      { lastProgressAt: new Date(Date.now() - 181000).toISOString() },
      'unavailable',
      'stale-progress',
    ],
    [
      'stale envelope',
      200,
      { recordedAt: new Date(Date.now() - 181000).toISOString() },
      'unavailable',
      'stale-progress',
    ],
    [
      'future clock',
      200,
      { recordedAt: new Date(Date.now() + 60000).toISOString() },
      'unavailable',
      'clock-skew',
    ],
    ['missing cycle', 200, { lastProgressAt: null }, 'unavailable', 'invalid-response'],
    ['wrong platform', 200, { platform: 'tiktok' }, 'unavailable', 'invalid-response'],
    ['unsafe ID', 200, { supervisorRunId: 'EAA-secret-token' }, 'unavailable', 'invalid-response'],
    ['contradictory event', 200, { event: 'worker.stopped' }, 'unavailable', 'invalid-response'],
    ['wrong status', 503, {}, 'unavailable', 'invalid-response'],
    [
      'log failed',
      503,
      { logCapture: { state: 'unavailable', lastStoredSequence: null } },
      'unavailable',
      'log-unavailable',
    ],
    [
      'log not acknowledged',
      200,
      { logCapture: { state: 'ready', lastStoredSequence: 0 } },
      'unavailable',
      'log-unavailable',
    ],
    ['log ready', 200, { logCapture: { state: 'ready', lastStoredSequence: 1 } }, 'ok', 'progress'],
  ] as const)(
    '%s is classified without trusting HTTP200 alone',
    async (_, code, patch, status, reason) => {
      const host = await serve((_, res) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health(patch)));
      });
      try {
        const result = await checkWorkerHealth({ platform: 'facebook', port: host.port });
        expect(result).toMatchObject({
          status,
          reason,
          platform: 'facebook',
          monitor: 'acquisition-process',
        });
        expect(JSON.stringify(result)).not.toMatch(/EAA-|token|localhost|stack/);
      } finally {
        await host.stop();
      }
    },
  );

  it.each(['redirect', 'oversize', 'malformed', 'dribble'] as const)(
    'bounds %s responses and never follows redirects',
    async (mode) => {
      let requests = 0;
      const host = await serve((_, res) => {
        requests++;
        if (mode === 'redirect') {
          res.writeHead(302, { Location: '/secret-target' });
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (mode === 'oversize') res.end('x'.repeat(9000));
          else if (mode === 'malformed') res.end('{"raw":"EAA-secret"');
          else {
            res.write('{');
            const interval = setInterval(() => res.write(' '), 10);
            res.on('close', () => clearInterval(interval));
          }
        }
      });
      try {
        const start = Date.now();
        const result = await checkWorkerHealth({
          platform: 'facebook',
          port: host.port,
          timeoutMs: 100,
        });
        expect(result).toMatchObject({
          status: 'unavailable',
          reason: mode === 'dribble' ? 'timeout' : 'invalid-response',
        });
        expect(Date.now() - start).toBeLessThan(1500);
        expect(requests).toBe(1);
        expect(JSON.stringify(result)).not.toContain('EAA-secret');
      } finally {
        await host.stop();
      }
    },
  );

  it.each([false, true])(
    'actual checker CLI returns an actionable exit code for attention=%s',
    async (attention) => {
      const host = await serve((_, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health({ attention })));
      });
      try {
        const result = await cli(host.port);
        expect(result.code).toBe(attention ? 1 : 0);
        expect(result.result.status).toBe(attention ? 'attention' : 'ok');
      } finally {
        await host.stop();
      }
    },
  );

  it('actual CLI reports a missing endpoint and rejects invalid configuration without echoing it', async () => {
    const host = await serve(() => {});
    await host.stop();
    expect(await cli(host.port)).toMatchObject({
      code: 2,
      result: { status: 'unavailable', reason: 'connection-error' },
    });
    const invalid = await cli(host.port, 'EAA-secret-input');
    expect(invalid.code).toBe(2);
    expect(invalid.result.reason).toBe('invalid-configuration');
    expect(invalid.output).not.toContain('EAA-secret');
  });

  it('another process can detect a SIGSTOP-frozen health host and both processes are cleaned up', async () => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import {createServer} from 'node:http';
      const server=createServer((req,res)=>res.end('{}'));
      server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
      process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
    `,
      ],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { NODE_ENV: 'test', PATH: process.env.PATH },
      },
    );
    const exited = once(child, 'exit');
    try {
      let startupTimeout: ReturnType<typeof setTimeout> | undefined;
      const [message] = (await Promise.race([
        once(child, 'message'),
        new Promise<never>((_, reject) => {
          startupTimeout = setTimeout(() => reject(Error('Health host did not start')), 2000);
        }),
      ]).finally(() => clearTimeout(startupTimeout))) as [{ port: number }];
      expect(child.kill('SIGSTOP')).toBe(true);
      const result = await cli(message.port);
      expect(result).toMatchObject({
        code: 2,
        result: { status: 'unavailable', reason: 'timeout' },
      });
    } finally {
      child.kill('SIGCONT');
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(force);
      expect(child.exitCode).toBe(0);
    }
  }, 10000);
});
