// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWorkerEvents } from '@/server/modules/marketing-ads/worker-events.mjs';

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
    const path = resolve('.agent-work/runtime/logs/facebook', String(address.port));
    if (!existsSync(path)) return { reserve, address };
    await new Promise<void>((done) => reserve.close(() => done()));
  }
  throw Error('No unused journal port');
}

describe('bounded acquisition process events', () => {
  it('correlates restarts within one supervisor and distinguishes separate runs', () => {
    const logs: Record<string, unknown>[] = [];
    const events = createWorkerEvents('facebook', (event) => logs.push(event));
    events.record({ state: 'starting', starts: 1 });
    events.record({ state: 'running', starts: 1, lastProgressAt: '2026-09-11T00:00:00Z' });
    events.record({ state: 'backoff', starts: 1, reason: 'exited' });
    events.record({ state: 'starting', starts: 2 });
    const recovered = events.record({ state: 'running', starts: 2 });
    const next = events.record({ state: 'running', starts: 2 });
    expect(logs.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(logs.map((e) => e.supervisorRunId)).size).toBe(1);
    expect(logs[0].workerRunId).toBe(logs[2].workerRunId);
    expect(logs[3].workerRunId).not.toBe(logs[2].workerRunId);
    expect(recovered.event).toBe('worker.recovered');
    expect(next.event).toBe('worker.cycle');
    expect(logs[2]).toMatchObject({ level: 'warn', reason: 'exited' });
    expect(logs[1].lastProgressAt).toBe('2026-09-11T00:00:00.000Z');
    expect(logs.every((e) => Number.isFinite(Date.parse(e.recordedAt as string)))).toBe(true);
    expect(createWorkerEvents('facebook').record({ state: 'disabled' }).supervisorRunId).not.toBe(
      recovered.supervisorRunId,
    );
  });

  it('reports attention transitions only from completed cycles, including after restart', () => {
    const events = createWorkerEvents('tiktok');
    expect(events.record({ state: 'running', starts: 1, attention: true })).toMatchObject({
      level: 'warn',
      attentionChange: 'raised',
    });
    expect(
      events.record({ state: 'running', starts: 1, attention: true }).attentionChange,
    ).toBeNull();
    events.record({ state: 'stopping', starts: 1, reason: 'no-progress' });
    expect(events.record({ state: 'starting', starts: 2 }).attentionChange).toBeNull();
    expect(events.record({ state: 'running', starts: 2, attention: false })).toMatchObject({
      event: 'worker.recovered',
      level: 'info',
      attentionChange: 'cleared',
    });
    expect(events.record({ state: 'stopped', starts: 2, reason: 'shutdown' }).level).toBe('info');
  });

  it('never emits raw errors or unexpected fields, and contains sink failures', () => {
    const events = createWorkerEvents('facebook', () => {
      throw Error('sink secret');
    });
    const input = {
      state: 'raw sensitive state',
      reason: 'EAA-secret-token',
      starts: Number.NaN,
      lastProgressAt: 'https://secret.example/?access_token=sensitive',
      accountId: 'sensitive-account',
      message: 'raw provider payload',
      attention: false,
    };
    const event = events.record(input);
    expect(event).toMatchObject({
      state: 'failed',
      reason: 'unavailable',
      starts: 0,
      workerRunId: null,
      lastProgressAt: null,
      level: 'error',
      sequence: 1,
    });
    expect(JSON.stringify(event)).not.toMatch(/sensitive|secret|payload|accountId|EAA-/);
    expect(JSON.stringify(event).length).toBeLessThan(1024);
    expect(events.record({ state: 'starting', starts: 1 }).sequence).toBe(2);
  });

  it.each(['facebook', 'tiktok'])(
    'real %s CLI emits a correlated disabled event without starting a worker',
    (platform) => {
      const result = spawnSync(process.execPath, ['scripts/marketing-worker.mjs', platform], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, LABSD_MARKETING_ENABLED: '0' },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const event = JSON.parse(result.stdout.trim());
      expect(event).toMatchObject({
        platform,
        state: 'disabled',
        event: 'worker.disabled',
        schemaVersion: 1,
        sequence: 1,
        starts: 0,
        workerRunId: null,
        level: 'info',
      });
      expect(event.supervisorRunId).toMatch(/^[a-f0-9-]{36}$/);
    },
  );

  it('real CLI sanitizes invalid arguments before reporting a startup failure', () => {
    const result = spawnSync(process.execPath, ['scripts/marketing-worker.mjs', 'secret-input'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    const event = JSON.parse(result.stdout.trim());
    expect(event).toMatchObject({
      platform: null,
      state: 'failed',
      reason: 'unavailable',
      level: 'error',
    });
    expect(result.stdout).not.toContain('secret-input');
  });

  it.each(['off', 'on', 'unavailable'])(
    'correlates real CLI health with logs (%s) and contains missing configuration failures',
    async (capture) => {
      const { reserve, address } = await reserveUnusedJournalPort();
      await new Promise<void>((done) => reserve.close(() => done()));
      const journalPath = resolve('.agent-work/runtime/logs/facebook', String(address.port));
      if (capture === 'unavailable') {
        mkdirSync(resolve(journalPath, '..'), { recursive: true });
        writeFileSync(journalPath, 'storage unavailable', { flag: 'wx', mode: 0o600 });
      }
      // Deliberately no DB, credential, owner endpoint or inherited provider configuration.
      const host = spawn(process.execPath, ['scripts/marketing-worker.mjs', 'facebook'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH,
          TMPDIR: resolve('.agent-work/runtime/tmp'),
          XDG_CACHE_HOME: resolve('.agent-work/runtime/cache'),
          LABSD_MARKETING_ENABLED: '1',
          LABSD_FACEBOOK_READ_ENABLED: '1',
          LABSD_MARKETING_SYNC_ENABLED: '1',
          LABSD_WORKER_HEALTH_PORT: String(address.port),
          ...(capture === 'off'
            ? {}
            : {
                LABSD_WORKER_LOG_ENABLED: '1',
                LABSD_WORKER_LOG_MAX_BYTES: '1024',
                LABSD_WORKER_LOG_MAX_FILES: '3',
              }),
        },
      });
      let output = '',
        errors = '';
      host.stdout.on('data', (chunk) => {
        output += chunk;
      });
      host.stderr.on('data', (chunk) => {
        errors += chunk;
      });
      const exit = once(host, 'exit');
      let observed: Record<string, unknown> | undefined;
      try {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && host.exitCode === null) {
          const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
            signal: AbortSignal.timeout(500),
          }).catch(() => null);
          if (response) {
            expect(response.status).toBe(503);
            expect(response.headers.get('cache-control')).toBe('no-store');
            const health = await response.json();
            if (health.state === 'backoff') {
              observed = health;
              break;
            }
          }
          await new Promise((done) => setTimeout(done, 50));
        }
        expect(observed).toMatchObject({
          platform: 'facebook',
          state: 'backoff',
          schemaVersion: 1,
          event: 'worker.backoff',
          level: 'warn',
          reason: 'exited',
        });
        // Stop the verified live process rather than wait out its restart budget.
        host.kill('SIGTERM');
        await exit;
        expect(host.exitCode).toBe(0);
        const events = output
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const { logCapture, ...observedEvent } = observed!;
        expect(events.find((event) => event.sequence === observed!.sequence)).toEqual(
          observedEvent,
        );
        if (capture === 'off') expect(logCapture).toBeUndefined();
        else
          expect(logCapture).toEqual({
            state: capture === 'on' ? 'ready' : 'unavailable',
            lastStoredSequence: capture === 'on' ? observed!.sequence : null,
          });
        if (capture === 'on') {
          const files = readdirSync(journalPath)
            .filter((name) => /^events-\d{12}\.jsonl$/.test(name))
            .sort();
          expect(files.length).toBeLessThanOrEqual(3);
          const stored = files.flatMap((name) =>
            readFileSync(resolve(journalPath, name), 'utf8')
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line)),
          );
          expect(stored.length).toBeGreaterThan(0);
          expect(stored).toEqual(events.slice(-stored.length));
          expect(stored.at(-1)).toMatchObject({ state: 'stopped' });
        }
        expect(new Set(events.map((event) => event.supervisorRunId)).size).toBe(1);
        expect(events.at(-1)).toMatchObject({ state: 'stopped', reason: 'shutdown' });
        expect(events.map((event) => event.sequence)).toEqual(events.map((_, i) => i + 1));
        expect(errors).toBe('');
        expect(output).not.toMatch(/Error:|DATABASE_URL|BETTER_AUTH|stack|node_modules/);
      } finally {
        if (host.exitCode === null && host.signalCode === null) {
          host.kill('SIGTERM');
          const escalation = setTimeout(() => host.kill('SIGKILL'), 16000);
          await exit;
          clearTimeout(escalation);
        }
      }
    },
    30000,
  );
});
