import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkWorkerHealth } from '../../modules/marketing-ads/worker-health.mjs';
import { checkWebHealth, type ProbeResult } from './web-probe';
import { serviceReasons, serviceStatuses } from './service-events';

type Target = 'web' | 'facebook' | 'tiktok';
export type MonitorConfig = {
  port: number;
  intervalMs: number;
  timeoutMs: number;
  targets: { name: Target; port: number }[];
};
const names: Target[] = ['web', 'facebook', 'tiktok'];
export function monitorConfig(env: Record<string, string | undefined>): MonitorConfig {
  const number = (key: string, min: number, max: number, fallback?: number) => {
    const raw = env[key];
    if (raw === undefined && fallback !== undefined) return fallback;
    if (!raw || !/^\d+$/.test(raw)) throw Error('Invalid monitor configuration');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw Error('Invalid monitor configuration');
    return value;
  };
  const port = number('LABSD_MONITOR_PORT', 1, 65535);
  const targets = names.flatMap((name) => {
    const key = `LABSD_MONITOR_${name.toUpperCase()}_PORT`;
    return env[key] === undefined ? [] : [{ name, port: number(key, 1, 65535) }];
  });
  if (!targets.length || new Set([port, ...targets.map((x) => x.port)]).size !== targets.length + 1)
    throw Error('Invalid monitor configuration');
  return {
    port,
    targets,
    intervalMs: number('LABSD_MONITOR_INTERVAL_MS', 1000, 300000, 30000),
    timeoutMs: number('LABSD_MONITOR_TIMEOUT_MS', 100, 10000, 3000),
  };
}

type Observation = ProbeResult & { target: Target; checkedAt: string };
type Transition = {
  event: 'service_status';
  at: string;
  monitorRunId: string;
  sequence: number;
  target: Target;
  previous: string | null;
  status: ProbeResult['status'];
  reason: string;
};
export function createServiceMonitor(
  config: MonitorConfig,
  emit: (event: Transition) => void,
  probe: (
    target: MonitorConfig['targets'][number],
    timeoutMs: number,
  ) => Promise<ProbeResult> = async (target, timeoutMs) => {
    if (target.name === 'web') return checkWebHealth(target.port, timeoutMs);
    const result = await checkWorkerHealth({ platform: target.name, port: target.port, timeoutMs });
    return { status: result.status as ProbeResult['status'], reason: result.reason as string };
  },
) {
  const runId = randomUUID();
  let sequence = 0,
    lastCompleted: string | null = null,
    lastTick = -Infinity;
  let stopped = false,
    running = false;
  const current = new Map<Target, Observation>();
  const history: Transition[] = [];
  // At most two sequential web probes plus one bounded worker probe per cycle.
  const staleMs = config.intervalMs + config.timeoutMs * 2 + 5000;
  return {
    snapshot() {
      const fresh = performance.now() - lastTick <= staleMs;
      const status =
        !stopped &&
        fresh &&
        current.size === config.targets.length &&
        [...current.values()].every((x) => x.status === 'ok')
          ? 'ok'
          : 'unavailable';
      return {
        schemaVersion: 1,
        monitor: 'services',
        monitorRunId: runId,
        status,
        state: stopped
          ? 'stopped'
          : lastCompleted === null
            ? 'starting'
            : fresh
              ? 'running'
              : 'stale',
        lastCompletedAt: lastCompleted,
        intervalMs: config.intervalMs,
        targets: config.targets.map(
          (x) =>
            current.get(x.name) ?? {
              target: x.name,
              status: 'unavailable',
              reason: 'not-checked',
              checkedAt: null,
            },
        ),
        transitions: [...history],
      };
    },
    async run(signal: AbortSignal) {
      if (running || stopped) throw Error('Monitor cannot be started twice');
      running = true;
      try {
        while (!signal.aborted) {
          // Parallel across up to3 targets, never across cycles. Probe implementations bound their requests.
          const observed = await Promise.all(
            config.targets.map(async (target) => {
              let result: ProbeResult;
              try {
                result = await probe(target, config.timeoutMs);
              } catch {
                result = { status: 'unavailable', reason: 'probe-error' };
              }
              if (
                !result ||
                !serviceStatuses.has(result.status) ||
                !serviceReasons.has(result.reason)
              )
                result = { status: 'unavailable', reason: 'invalid-response' };
              return {
                target: target.name,
                status: result.status,
                reason: result.reason,
                checkedAt: new Date().toISOString(),
              };
            }),
          );
          if (signal.aborted) break;
          // Observation age starts when probes finish, not after a potentially slow log/fsync.
          const observedAt = new Date().toISOString();
          const observedTick = performance.now();
          for (const result of observed) {
            const old = current.get(result.target);
            current.set(result.target, result);
            if (old?.status === result.status && old?.reason === result.reason) continue;
            const event: Transition = {
              event: 'service_status',
              at: result.checkedAt,
              monitorRunId: runId,
              sequence: ++sequence,
              target: result.target,
              previous: old?.status ?? null,
              status: result.status,
              reason: result.reason,
            };
            history.push(event);
            if (history.length > 40) history.shift();
            try {
              emit(event);
            } catch {
              /* Collection cannot stop health checks. */
            }
          }
          lastCompleted = observedAt;
          lastTick = observedTick;
          try {
            await delay(config.intervalMs, undefined, { signal });
          } catch {
            if (!signal.aborted) throw Error('Monitor scheduling failed');
          }
        }
      } finally {
        stopped = true;
        running = false;
      }
    },
  };
}
