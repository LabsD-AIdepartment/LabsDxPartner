import { randomUUID } from 'node:crypto';

const states = new Set([
  'starting',
  'running',
  'stopping',
  'backoff',
  'failed',
  'stopped',
  'disabled',
]);
const reasons = new Set([
  'exited',
  'shutdown',
  'no-progress',
  'spawn-failed',
  'process-error',
  'unavailable',
]);
/**
 * Bounded process telemetry only. SQL and the source lanes still own report status.
 * @param {'facebook'|'tiktok'|null} platform
 * @param {(event: Record<string, unknown>)=>void} [sink]
 */
export function createWorkerEvents(platform, sink = () => {}) {
  if (platform !== null && platform !== 'facebook' && platform !== 'tiktok')
    throw new Error('Invalid worker event platform');
  const supervisorRunId = randomUUID();
  let sequence = 0,
    lastAttention = false,
    interrupted = false;
  /**
   * Project known fields explicitly: never spread errors, IPC messages, env or provider output.
   * @param {{state:string, starts?:number, lastProgressAt?:string|null, attention?:boolean, reason?:string|null}} input
   */
  function record(input) {
    const state = states.has(input.state) ? input.state : 'failed';
    const starts = Number.isSafeInteger(input.starts) && input.starts >= 0 ? input.starts : 0;
    const reason =
      input.reason == null ? null : reasons.has(input.reason) ? input.reason : 'unavailable';
    const attention = input.attention === true;
    const cycle = state === 'running';
    const recovered = cycle && interrupted;
    const attentionChange =
      cycle && attention !== lastAttention ? (attention ? 'raised' : 'cleared') : null;
    if (
      state === 'backoff' ||
      state === 'failed' ||
      (state === 'stopping' && reason !== 'shutdown')
    )
      interrupted = true;
    if (cycle) {
      interrupted = false;
      lastAttention = attention;
    }
    const parsedProgress =
      typeof input.lastProgressAt === 'string' ? Date.parse(input.lastProgressAt) : NaN;
    const event = {
      schemaVersion: 1,
      event: cycle ? (recovered ? 'worker.recovered' : 'worker.cycle') : `worker.${state}`,
      recordedAt: new Date().toISOString(),
      supervisorRunId,
      workerRunId: starts ? `${supervisorRunId}:${starts}` : null,
      sequence: ++sequence,
      level:
        state === 'failed'
          ? 'error'
          : state === 'backoff' ||
              (state === 'stopping' && reason !== 'shutdown') ||
              (cycle && attention)
            ? 'warn'
            : 'info',
      platform,
      state,
      starts,
      lastProgressAt: Number.isFinite(parsedProgress)
        ? new Date(parsedProgress).toISOString()
        : null,
      attention,
      reason,
      attentionChange,
    };
    // An unavailable log destination must not break supervision or orphan its child.
    try {
      sink(event);
    } catch {
      /* Process health remains observable over loopback. */
    }
    return event;
  }
  return { record };
}
