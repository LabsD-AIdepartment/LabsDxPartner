import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_WORKER_WATCHDOG_MS = 180000;

/** @typedef {{state:'starting'|'running'|'stopping'|'backoff'|'failed'|'stopped', starts:number, lastProgressAt:string|null, attention:boolean, reason:string|null}} WorkerState */
/** Supervise process progress, never database freshness. SQL leases remain the data authority.
 * @param {()=>import('node:child_process').ChildProcess} spawnWorker
 * @param {{signal:AbortSignal,onState:(state:WorkerState)=>void,watchdogMs?:number,graceMs?:number,backoffMs?:number,maxFailures?:number,failureWindowMs?:number}} options
 */
export async function superviseWorker(spawnWorker, options) {
  const {
    signal,
    onState,
    watchdogMs = DEFAULT_WORKER_WATCHDOG_MS,
    graceMs = 15000,
    backoffMs = 1000,
    maxFailures = 5,
    failureWindowMs = 600000,
  } = options;
  for (const value of [watchdogMs, graceMs, backoffMs, maxFailures, failureWindowMs])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('Invalid supervisor configuration');
  /** @type {WorkerState} */
  let state = {
    state: 'starting',
    starts: 0,
    lastProgressAt: null,
    attention: false,
    reason: null,
  };
  /** @param {Partial<WorkerState>} patch */
  const publish = (patch) => {
    state = { ...state, ...patch };
    try {
      onState({ ...state });
    } catch {
      /* An observer must not orphan a running worker. */
    }
  };
  /** @type {number[]} */
  let failures = [];
  while (!signal.aborted) {
    publish({
      state: 'starting',
      starts: state.starts + 1,
      lastProgressAt: null,
      attention: false,
      reason: null,
    });
    if (signal.aborted) break;
    let reason = 'exited';
    try {
      const child = spawnWorker();
      reason = await new Promise((resolve) => {
        let settled = false,
          terminating = false;
        /** @type {ReturnType<typeof setTimeout>|undefined} */
        let watchdog, escalation;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          clearTimeout(escalation);
          signal.removeEventListener('abort', stop);
          child.removeListener('message', message);
          child.removeListener('error', error);
          child.removeListener('exit', finish);
          resolve(reason);
        };
        /** @param {string} why */
        const terminate = (why) => {
          if (terminating || settled) return;
          terminating = true;
          reason = why;
          clearTimeout(watchdog);
          publish({ state: 'stopping', reason: why });
          if (child.exitCode !== null || child.signalCode !== null) {
            finish();
            return;
          }
          child.kill('SIGTERM');
          escalation = setTimeout(() => child.kill('SIGKILL'), graceMs);
          // The exit event, not sending a signal, proves termination before any replacement.
        };
        const stop = () => terminate('shutdown');
        const arm = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => terminate('no-progress'), watchdogMs);
        };
        /** @param {unknown} value */
        const message = (value) => {
          if (terminating || !value || typeof value !== 'object') return;
          const v = /** @type {Record<string,unknown>} */ (value);
          if (Object.keys(v).length !== 2 || v.type !== 'cycle' || typeof v.attention !== 'boolean')
            return;
          publish({
            state: 'running',
            lastProgressAt: new Date().toISOString(),
            attention: v.attention,
            reason: null,
          });
          arm();
        };
        const error = () => {
          reason = 'spawn-failed';
          if (!child.pid) finish();
          else terminate('process-error');
        };
        child.on('message', message);
        child.once('error', error);
        child.once('exit', finish);
        // Discard raw child output: provider or dependency error text may contain credentials.
        child.stdout?.resume();
        child.stderr?.resume();
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
        else arm();
      });
    } catch {
      reason = 'spawn-failed';
    }
    if (signal.aborted) break;
    const now = Date.now();
    failures = failures.filter((t) => now - t < failureWindowMs);
    failures.push(now);
    if (failures.length >= maxFailures) {
      publish({ state: 'failed', reason });
      return { failed: true, starts: state.starts };
    }
    publish({ state: 'backoff', reason });
    try {
      await delay(Math.min(60000, backoffMs * 2 ** Math.min(failures.length - 1, 16)), undefined, {
        signal,
      });
    } catch {
      if (!signal.aborted) throw new Error('Supervisor wait failed');
    }
  }
  publish({ state: 'stopped', reason: 'shutdown' });
  return { failed: false, starts: state.starts };
}
