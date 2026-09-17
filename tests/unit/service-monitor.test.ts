// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { monitorConfig, createServiceMonitor } from '@/server/platform/monitoring/service-monitor';
import { checkWebEndpoint, checkWebHealth } from '@/server/platform/monitoring/web-probe';
import { createWorkerEvents } from '@/server/modules/marketing-ads/worker-events.mjs';

async function serve(handler: (path: string, res: ServerResponse) => void) {
  const server = createServer((req, res) => handler(req.url ?? '', res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  return { port: address.port, async stop() {
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
  } };
}
async function until(check: () => boolean | Promise<boolean>, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(20); }
  throw Error('Condition not reached');
}
const base = { LABSD_MONITOR_PORT: '43100', LABSD_MONITOR_WEB_PORT: '43101' };

describe('service monitor', () => {
  it('does not renew observation freshness after a slow synchronous sink', async () => {
    let tick = 100;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => tick);
    const abort = new AbortController();
    const monitor = createServiceMonitor(monitorConfig(base), () => { tick += 100000; },
      async () => ({ status: 'ok', reason: 'ready' }));
    const task = monitor.run(abort.signal);
    try {
      await until(() => monitor.snapshot().lastCompletedAt !== null);
      expect(monitor.snapshot()).toMatchObject({ status: 'unavailable', state: 'stale' });
      expect(monitor.snapshot().targets[0].status).toBe('ok');
    } finally { abort.abort(); await task; clock.mockRestore(); }
  });
  it('requires explicit unique target ports; no default worker targets or private config echo', () => {
    expect(monitorConfig(base)).toEqual({ port: 43100, targets: [{ name: 'web', port: 43101 }], intervalMs: 30000, timeoutMs: 3000 });
    for (const env of [{}, { LABSD_MONITOR_PORT: '43100' }, { ...base, LABSD_MONITOR_WEB_PORT: '43100' },
      { ...base, LABSD_MONITOR_FACEBOOK_PORT: '43101' }, { ...base, LABSD_MONITOR_TIMEOUT_MS: '0' },
      { ...base, LABSD_MONITOR_INTERVAL_MS: 'PRIVATE' }, { ...base, LABSD_MONITOR_WEB_PORT: '65536' }])
      expect(() => monitorConfig(env)).toThrow('Invalid monitor configuration');
  });

  it('checks liveness and readiness; a responding but unready web is unavailable', async () => {
    let ready = false; const paths: string[] = [];
    const host = await serve((path, res) => {
      paths.push(path); res.writeHead(path === '/api/ready' && !ready ? 503 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: path === '/api/health' ? 'ok' : ready ? 'ready' : 'unavailable' }));
    });
    try {
      expect(await checkWebHealth(host.port, 100)).toEqual({ status: 'unavailable', reason: 'not-ready' });
      ready = true;
      expect(await checkWebHealth(host.port, 100)).toEqual({ status: 'ok', reason: 'ready' });
      expect(paths).toEqual(['/api/health', '/api/ready', '/api/health', '/api/ready']);
    } finally { await host.stop(); }
  });

  it.each(['redirect', 'oversize', 'invalid', 'contradiction', 'dribble', 'aborted'])(
    'bounds/rejects %s and never echoes upstream body', async mode => {
      let requests = 0;
      const host = await serve((_, res) => {
        requests++;
        if (mode === 'redirect') { res.writeHead(302, { Location: '/PRIVATE' }); res.end(); return; }
        res.writeHead(mode === 'contradiction' ? 503 : 200, { 'Content-Type': 'application/json' });
        if (mode === 'oversize') res.end('PRIVATE'.repeat(200));
        else if (mode === 'invalid') res.end('{"status":"PRIVATE"}');
        else if (mode === 'contradiction') res.end('{"status":"ready"}');
        else if (mode === 'aborted') { res.write('{'); res.destroy(); }
        else { res.write('{'); const timer = setInterval(() => res.write(' '), 10); res.on('close', () => clearInterval(timer)); }
      });
      try {
        const start = Date.now(); const result = await checkWebEndpoint(host.port, '/api/ready', 100);
        expect(result.status).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain('PRIVATE');
        expect(Date.now() - start).toBeLessThan(1500); expect(requests).toBe(1);
        if (mode === 'dribble') expect(result.reason).toBe('timeout');
      } finally { await host.stop(); }
    },
  );

  it('serializes cycles, suppresses repeats, records recovery, bounds history and stops', async () => {
    let active = 0, peak = 0, calls = 0;
    let status: 'ok' | 'unavailable' = 'ok';
    const events: unknown[] = [], abort = new AbortController();
    const monitor = createServiceMonitor({ ...monitorConfig(base), intervalMs: 1 }, e => events.push(e), async () => {
      active++; peak = Math.max(peak, active); calls++; await delay(5); active--;
      return { status, reason: status === 'ok' ? 'ready' : 'timeout' };
    });
    expect(monitor.snapshot().status).toBe('unavailable');
    const task = monitor.run(abort.signal);
    try {
      await until(() => calls >= 5); expect(events).toHaveLength(1);
      for (let i = 0; i < 43; i++) {
        status = status === 'ok' ? 'unavailable' : 'ok'; const expected = events.length + 1;
        await until(() => events.length === expected);
      }
      expect(monitor.snapshot().transitions).toHaveLength(40);
      expect(peak).toBe(1); expect(monitor.snapshot().state).toBe('running');
      expect(monitor.snapshot().transitions.at(-1)?.previous).toBe('ok');
      await expect(monitor.run(abort.signal)).rejects.toThrow('twice');
    } finally { abort.abort(); await task; }
    const count = calls; await delay(20); expect(calls).toBe(count);
    expect(monitor.snapshot()).toMatchObject({ status: 'unavailable', state: 'stopped' });
  });

  it('contains a failed probe/sink and rejects raw reason fields', async () => {
    const abort = new AbortController(); let calls = 0;
    const monitor = createServiceMonitor({ ...monitorConfig(base), intervalMs: 1 }, () => { throw Error('PRIVATE'); }, async () => {
      if (++calls === 1) throw Error('PRIVATE');
      return { status: 'unavailable', reason: 'PRIVATE' };
    });
    const task = monitor.run(abort.signal);
    try { await until(() => monitor.snapshot().transitions.length === 2);
      expect(JSON.stringify(monitor.snapshot())).not.toContain('PRIVATE');
      expect(monitor.snapshot().targets[0].reason).toBe('invalid-response');
    } finally { abort.abort(); await task; }
  });

  it.each(['facebook', 'tiktok'] as const)('uses the existing %s worker health contract and recognizes recovery', async platform => {
    let attention = true;
    const events = createWorkerEvents(platform);
    const host = await serve((path, res) => {
      expect(path).toBe('/health');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(events.record({ state: 'running', starts: 1,
        lastProgressAt: new Date().toISOString(), attention })));
    });
    const abort = new AbortController();
    const monitor = createServiceMonitor({ ...monitorConfig(base), intervalMs: 10,
      targets: [{ name: platform, port: host.port }] }, () => {});
    const task = monitor.run(abort.signal);
    try {
      await until(() => monitor.snapshot().targets[0]?.status === 'attention');
      expect(monitor.snapshot().status).toBe('unavailable');
      attention = false;
      await until(() => monitor.snapshot().status === 'ok');
      expect(monitor.snapshot().transitions.map(x => x.status)).toEqual(['attention', 'ok']);
    } finally { abort.abort(); await task; await host.stop(); }
  });

  it('a listener conflict exits the real CLI before any target probe', async () => {
    let probes = 0;
    const occupied = await serve((_, res) => { probes++; res.end('PRIVATE'); });
    const target = await serve((_, res) => { probes++; res.end('PRIVATE'); });
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/service-monitor.ts'], {
      env: { NODE_ENV: 'test', PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
        LABSD_MONITOR_PORT: String(occupied.port), LABSD_MONITOR_WEB_PORT: String(target.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      const [code, signal] = await once(child, 'exit');
      expect(code).toBe(2); expect(signal).toBeNull(); expect(probes).toBe(0);
      expect(JSON.parse(output)).toMatchObject({ event: 'service_monitor_failed', reason: 'unavailable' });
      expect(output).not.toContain('PRIVATE');
    } finally { clearTimeout(force); await occupied.stop(); await target.stop(); }
  });

  it('runs the real CLI repeatedly through failure/recovery and exits on SIGTERM', async () => {
    let ready = true, probes = 0;
    const host = await serve((path, res) => {
      probes++; const failed = path === '/api/ready' && !ready;
      res.writeHead(failed ? 503 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: path === '/api/health' ? 'ok' : failed ? 'unavailable' : 'ready' }));
    });
    const free = await serve(() => {}); const port = free.port; await free.stop();
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/service-monitor.ts'], {
      env: { NODE_ENV: 'test', PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
        LABSD_MONITOR_PORT: String(port), LABSD_MONITOR_WEB_PORT: String(host.port), LABSD_MONITOR_INTERVAL_MS: '1000', LABSD_MONITOR_TIMEOUT_MS: '100' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit'); let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    const status = async () => { try { return await (await fetch(`http://127.0.0.1:${port}/health`)).json(); } catch { return null; } };
    try {
      await until(async () => (await status())?.status === 'ok');
      ready = false;
      await until(async () => (await status())?.targets[0]?.reason === 'not-ready');
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(503);
      ready = true;
      await until(async () => (await status())?.status === 'ok');
      const state = await status(); expect(state.targets).toHaveLength(1);
      expect(state.transitions.map((x: { status: string }) => x.status)).toEqual(['ok', 'unavailable', 'ok']);
      await delay(1200); expect((await status()).transitions).toHaveLength(3);
      expect(probes).toBeGreaterThanOrEqual(8);
      expect((await fetch(`http://127.0.0.1:${port}/health?PRIVATE`)).status).toBe(404);
      expect(await (await fetch(`http://127.0.0.1:${port}/health`, { method: 'HEAD' })).text()).toBe('');
    } finally {
      child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 3000);
      const [code, signal] = await exited; clearTimeout(force); await host.stop();
      expect(code).toBe(0); expect(signal).toBeNull();
    }
    expect(stderr).toBe(''); expect(stdout).not.toContain('PRIVATE');
    expect(stdout.trim().split('\n').map(x => JSON.parse(x).status)).toEqual(['ok', 'unavailable', 'ok']);
  }, 12000);
});
