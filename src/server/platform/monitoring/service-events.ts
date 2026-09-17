/** Shared vocabulary for emitted service transitions and retained journal validation. */
export const serviceStatuses = new Set(['ok', 'attention', 'unavailable']);
export const serviceReasons = new Set([
  'ok',
  'ready',
  'not-ready',
  'invalid-response',
  'timeout',
  'connection-error',
  'clock-skew',
  'stale-progress',
  'not-running',
  'log-unavailable',
  'cycle-attention',
  'progress',
  'probe-error',
]);
