// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  existsSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createMonitorJournal } from '@/server/platform/monitoring/monitor-journal';

const base = resolve('.agent-work/20260911-event-collector/tmp');
mkdirSync(base, { recursive: true });
async function reserveUnusedJournalPort() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const reserve = createServer();
    reserve.listen(0, '127.0.0.1');
    await once(reserve, 'listening');
    const address = reserve.address();
    if (!address || typeof address === 'string') {
      reserve.close();
      throw Error('No loopback address');
    }
    if (!existsSync(resolve('.agent-work/runtime/logs/services', String(address.port))))
      return { reserve, address };
    await new Promise<void>((done) => reserve.close(() => done()));
  }
  throw Error('No unused journal namespace');
}
const run = 'da6e26d9-c87e-4196-8f4c-685f36441505';
const event = (sequence = 1) => ({
  event: 'service_status',
  at: new Date().toISOString(),
  monitorRunId: run,
  sequence,
  target: 'web',
  previous: null,
  status: 'ok',
  reason: 'ready',
});
function files(path: string) {
  return readdirSync(path)
    .filter((x) => /^events-\d{12}\.jsonl$/.test(x))
    .sort();
}
function rows(path: string) {
  return files(path).flatMap((x) =>
    readFileSync(resolve(path, x), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((x) => JSON.parse(x)),
  );
}
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(25);
  }
  throw Error('Condition not reached');
}

describe('durable monitor transitions', () => {
  it('retains complete correlated lines across rotation/restart within configured capacity', () => {
    const path = mkdtempSync(resolve(base, 'rotation-'));
    writeFileSync(resolve(path, 'keep.txt'), 'unrelated');
    const journal = createMonitorJournal({ directory: path, maxBytes: 1024, maxFiles: 3 });
    for (let i = 1; i <= 30; i++) expect(journal.write(event(i))).toBe(true);
    expect(journal.status()).toEqual({ state: 'ready', lastStoredSequence: 30 });
    journal.close();
    expect(files(path)).toHaveLength(3);
    expect(rows(path).at(-1)).toMatchObject({ monitorRunId: run, sequence: 30 });
    const restart = createMonitorJournal({ directory: path, maxBytes: 1024, maxFiles: 3 });
    expect(
      restart.write({ ...event(), monitorRunId: '6237eebf-85bd-40c1-adf4-5e52903337be' }),
    ).toBe(true);
    restart.close();
    expect(rows(path).some((x) => x.monitorRunId === run && x.sequence === 30)).toBe(true);
    for (const file of files(path)) {
      const stat = statSync(resolve(path, file));
      expect(stat.size).toBeLessThanOrEqual(1024);
      expect(stat.mode & 0o777).toBe(0o600);
    }
    expect(files(path).length).toBeLessThanOrEqual(3);
    expect(statSync(path).mode & 0o777).toBe(0o700);
    expect(readFileSync(resolve(path, 'keep.txt'), 'utf8')).toBe('unrelated');
  });

  it.each([
    { message: 'PRIVATE' },
    { reason: 'PRIVATE' },
    { target: 'PRIVATE' },
    { monitorRunId: 'PRIVATE' },
    { at: 'PRIVATE' },
    { sequence: 0 },
    { status: 'PRIVATE' },
  ])('refuses unsafe retained fields: %j', (patch) => {
    const path = mkdtempSync(resolve(base, 'privacy-'));
    const journal = createMonitorJournal({ directory: path, maxBytes: 1024, maxFiles: 2 });
    expect(journal.write({ ...event(), ...patch })).toBe(false);
    expect(journal.status().state).toBe('unavailable');
    journal.close();
    expect(rows(path)).toEqual([]);
    expect(
      files(path)
        .map((x) => readFileSync(resolve(path, x), 'utf8'))
        .join(''),
    ).not.toContain('PRIVATE');
  });

  it.each(['directory', 'file'])(
    'detects replaced %s even if no new transition is written',
    (kind) => {
      const path = mkdtempSync(resolve(base, 'replaced-'));
      const journal = createMonitorJournal({ directory: path, maxBytes: 1024, maxFiles: 3 });
      journal.write(event());
      if (kind === 'directory') {
        renameSync(path, path + '-old');
        mkdirSync(path, { mode: 0o700 });
      } else {
        const file = resolve(path, files(path)[0]);
        renameSync(file, file + '-old');
        writeFileSync(file, '', { mode: 0o600 });
      }
      expect(journal.status()).toEqual({ state: 'unavailable', lastStoredSequence: 1 });
      journal.close();
    },
  );

  it('real CLI persists its transition and reports capture failure while continuing probes', async () => {
    let probes = 0;
    const host = createServer((req, res) => {
      probes++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: req.url === '/api/health' ? 'ok' : 'ready' }));
    });
    host.listen(0, '127.0.0.1');
    await once(host, 'listening');
    const target = host.address();
    if (!target || typeof target === 'string') throw Error('No port');
    const { reserve, address } = await reserveUnusedJournalPort();
    await new Promise<void>((r) => reserve.close(() => r()));
    const path = resolve('.agent-work/runtime/logs/services', String(address.port));
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/service-monitor.ts'], {
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
        LABSD_MONITOR_PORT: String(address.port),
        LABSD_MONITOR_WEB_PORT: String(target.port),
        LABSD_MONITOR_INTERVAL_MS: '1000',
        LABSD_MONITOR_TIMEOUT_MS: '100',
        LABSD_MONITOR_LOG_ENABLED: '1',
        LABSD_MONITOR_LOG_MAX_BYTES: '1024',
        LABSD_MONITOR_LOG_MAX_FILES: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', (b) => (output += b));
    child.stderr.on('data', (b) => (output += b));
    const snapshot = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${address.port}/health`);
        return { code: r.status, ...(await r.json()) };
      } catch {
        return null;
      }
    };
    try {
      await until(async () => (await snapshot())?.code === 200);
      const first = await snapshot();
      expect(first.logCapture).toEqual({ state: 'ready', lastStoredSequence: 1 });
      expect(rows(path).at(-1)).toEqual(first.transitions[0]);
      renameSync(path, path + '-moved-' + Date.now());
      const failed = await snapshot();
      expect(failed.code).toBe(503);
      expect(failed.logCapture.state).toBe('unavailable');
      expect(failed.targets[0].status).toBe('ok');
      const prior = probes;
      await until(async () => probes > prior);
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 3000);
      const [code, signal] = await exited;
      clearTimeout(force);
      host.closeAllConnections();
      await new Promise<void>((r) => host.close(() => r()));
      expect(code).toBe(0);
      expect(signal).toBeNull();
    }
    expect(output.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(output).event).toBe('service_status');
  }, 10000);
});
