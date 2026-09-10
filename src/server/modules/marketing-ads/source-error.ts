export type SourceErrorCode = 'access' | 'not-found' | 'throttled' | 'temporary' | 'invalid-source';
/** Provider-independent safe category. Raw source payloads, URLs and credentials never travel here. */
export class SourceReadError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    readonly retryAfterMs: number | null = null,
  ) {
    super('Source read: ' + code);
    this.name = 'SourceReadError';
  }
}
