// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, it, expect } from 'vitest';
import { superviseWorker } from '@/server/modules/marketing-ads/worker-supervisor.mjs';
import { createWorkerEvents } from '@/server/modules/marketing-ads/worker-events.mjs';

const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (p) =>
        new Promise<void>((resolve) => {
          if (p.exitCode !== null || p.signalCode !== null || !p.pid) {
            resolve();
            return;
          }
          p.once('exit', () => resolve());
          p.kill('SIGKILL');
        }),
    ),
  );
});
function child(code: string) {
  const p = spawn(process.execPath, ['-e', code], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: process.env,
  });
  children.push(p);
  return p;
}
const fast = {
  watchdogMs: 1000,
  graceMs: 50,
  backoffMs: 10,
  maxFailures: 3,
  failureWindowMs: 10000,
};
describe('real acquisition process supervision', () => {
  it('observes real progress and waits for shutdown before returning', async () => {
    const c = new AbortController(),
      states: string[] = [];
    const result = await superviseWorker(
      () => child("setInterval(()=>process.send({type:'cycle',attention:false}),30)"),
      {
        ...fast,
        signal: c.signal,
        onState: (s) => {
          states.push(s.state);
          if (s.state === 'running') c.abort();
        },
      },
    );
    expect(result).toEqual({ failed: false, starts: 1 });
    expect(states).toContain('running');
    expect(states.at(-1)).toBe('stopped');
    expect(children.at(-1)?.signalCode).toBe('SIGTERM');
  });
  it('escalates a stalled child that ignores TERM, then stops at the restart budget', async () => {
    const held: ChildProcess[] = [];
    const result = await superviseWorker(
      () => {
        const p = child("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)");
        held.push(p);
        return p;
      },
      { ...fast, signal: new AbortController().signal, onState: () => {} },
    );
    expect(result).toEqual({ failed: true, starts: 3 });
    expect(held.every((p) => p.signalCode === 'SIGKILL')).toBe(true);
  });
  it('does not accept arbitrary messages as progress and does not let an observer orphan children', async () => {
    const states: string[] = [];
    const result = await superviseWorker(
      () =>
        child(
          "setInterval(()=>process.send({type:'cycle',attention:false,secret:'must-not-count'}),20)",
        ),
      {
        ...fast,
        maxFailures: 1,
        signal: new AbortController().signal,
        onState: (s) => {
          states.push(s.state);
          throw Error('observer failed');
        },
      },
    );
    expect(result.failed).toBe(true);
    expect(states).not.toContain('running');
    expect(children.at(-1)?.signalCode).toBe('SIGTERM');
  });
  it('recovers an unexpected exit once without overlapping processes', async () => {
    const c = new AbortController();
    const recorded: Record<string, unknown>[] = [];
    const events = createWorkerEvents('facebook', (event) => recorded.push(event));
    let starts = 0;
    let previous: ChildProcess | undefined;
    await superviseWorker(
      () => {
        if (previous) expect(previous.exitCode).toBe(2);
        previous = child(
          ++starts === 1
            ? 'process.exit(2)'
            : "setInterval(()=>process.send({type:'cycle',attention:true}),20)",
        );
        return previous;
      },
      {
        ...fast,
        signal: c.signal,
        onState: (s) => {
          events.record(s);
          if (s.state === 'running') {
            expect(s.attention).toBe(true);
            c.abort();
          }
        },
      },
    );
    expect(starts).toBe(2);
    expect(previous?.signalCode).toBe('SIGTERM');
    expect(recorded.find((event) => event.event === 'worker.recovered')).toMatchObject({
      starts: 2,
      attentionChange: 'raised',
      level: 'warn',
      state: 'running',
    });
    expect(new Set(recorded.map((event) => event.supervisorRunId)).size).toBe(1);
    expect(recorded.at(-1)).toMatchObject({ state: 'stopped', reason: 'shutdown' });
  });
  it('cancels backoff without launching a replacement and contains spawn failure', async () => {
    const c = new AbortController();
    let starts = 0;
    expect(
      await superviseWorker(
        () => {
          starts++;
          throw Error('sensitive dependency error');
        },
        {
          ...fast,
          signal: c.signal,
          onState: (s) => {
            if (s.state === 'backoff') c.abort();
          },
        },
      ),
    ).toEqual({ failed: false, starts: 1 });
    expect(starts).toBe(1);
  });
});
