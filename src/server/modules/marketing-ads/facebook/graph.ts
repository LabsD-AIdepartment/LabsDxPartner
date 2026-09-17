import { createHmac } from 'node:crypto';
export const FACEBOOK_VERSION = 'v25.0';
import { SourceReadError as FacebookReadError } from '../source-error';
export { SourceReadError as FacebookReadError, type SourceErrorCode } from '../source-error';
export type FacebookCredential = { token: string; appSecret?: string };
export type FacebookUsage = { percent: number; retryAfterMs: number; appPercent?: number };
export type FacebookReadDependencies = {
  credential: (connectionId: string, signal: AbortSignal) => Promise<FacebookCredential>;
  beforeRequest?: (connectionId: string, signal: AbortSignal) => Promise<void>;
  recordUsage?: (connectionId: string, usage: FacebookUsage) => Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
};
function quota(headers: Headers, now: number): FacebookUsage {
  let percent = 0,
    appPercent = 0,
    retryAfterMs = 0;
  const visit = (v: unknown, depth = 0) => {
    if (!v || typeof v !== 'object' || depth > 5) return;
    for (const [key, value] of Object.entries(v)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        if (['call_count', 'total_cputime', 'total_time', 'acc_id_util_pct'].includes(key))
          percent = Math.max(percent, value);
        if (key === 'estimated_time_to_regain_access')
          retryAfterMs = Math.max(retryAfterMs, value * 60_000);
        if (key === 'reset_time_duration') retryAfterMs = Math.max(retryAfterMs, value * 1000);
      } else visit(value, depth + 1);
    }
  };
  for (const name of ['x-app-usage', 'x-business-use-case-usage', 'x-ad-account-usage']) {
    const raw = headers.get(name);
    if (raw && raw.length <= 16_384) {
      try {
        const parsed = JSON.parse(raw);
        const prior = percent;
        percent = 0;
        visit(parsed);
        if (name === 'x-app-usage') appPercent = percent;
        percent = Math.max(prior, percent);
      } catch {
        /* Missing quota is not zero source data. */
      }
    }
  }
  const after = headers.get('retry-after');
  if (after) {
    const seconds = /^\d+$/.test(after)
      ? Number(after)
      : Math.max(0, (Date.parse(after) - now) / 1000);
    if (Number.isFinite(seconds)) retryAfterMs = Math.max(retryAfterMs, seconds * 1000);
  }
  return {
    percent,
    retryAfterMs: Math.min(retryAfterMs, 7 * 86400_000),
    ...(appPercent ? { appPercent } : {}),
  };
}
async function readJson(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new FacebookReadError('invalid-source');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const row = await reader.read();
      if (row.done) break;
      length += row.value.byteLength;
      if (length > 2_000_000) throw new FacebookReadError('invalid-source');
      chunks.push(row.value);
    }
    signal.throwIfAborted();
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new FacebookReadError('invalid-source');
    }
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
/** Fixed host + read-only paths. Cursors are rebuilt into our own request, never followed as URLs. */
export function createFacebookGraph(deps: FacebookReadDependencies) {
  return async (
    connectionId: string,
    path: string,
    params: Record<string, string>,
    parent: AbortSignal,
  ): Promise<unknown> => {
    if (
      !/^(?:act_\d+|\d+)(?:\/insights)?$/.test(path) ||
      Object.keys(params).some((k) => ['access_token', 'appsecret_proof'].includes(k))
    )
      throw new FacebookReadError('invalid-source');
    const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
    try {
      signal.throwIfAborted();
      await abortable(Promise.resolve(deps.beforeRequest?.(connectionId, signal)), signal);
      const credential = await abortable(deps.credential(connectionId, signal), signal);
      if (!credential.token || /[\r\n]/.test(credential.token))
        throw new FacebookReadError('access');
      const url = new URL(`https://graph.facebook.com/${FACEBOOK_VERSION}/${path}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      if (credential.appSecret)
        url.searchParams.set(
          'appsecret_proof',
          createHmac('sha256', credential.appSecret).update(credential.token).digest('hex'),
        );
      const response = await abortable(
        (deps.fetch ?? fetch)(url, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          signal,
          headers: { authorization: 'Bearer ' + credential.token, accept: 'application/json' },
        }),
        signal,
      );
      const usage = quota(response.headers, (deps.now ?? Date.now)());
      try {
        await abortable(
          Promise.resolve(
            deps.recordUsage?.(
              connectionId,
              response.status === 429
                ? {
                    ...usage,
                    percent: Math.max(80, usage.percent),
                    retryAfterMs: Math.max(60_000, usage.retryAfterMs),
                  }
                : usage,
            ),
          ),
          signal,
        );
      } catch (error) {
        void response.body?.cancel().catch(() => {});
        throw error;
      }
      if (
        response.status === 429 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status >= 500
      ) {
        void response.body?.cancel().catch(() => {});
        throw new FacebookReadError(
          response.status === 429
            ? 'throttled'
            : response.status === 404
              ? 'not-found'
              : response.status >= 500
                ? 'temporary'
                : 'access',
          response.status === 429
            ? Math.max(usage.retryAfterMs, 60_000)
            : usage.retryAfterMs || null,
        );
      }
      const data = await readJson(response, signal);
      const error = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (
        response.status === 429 ||
        [4, 17, 32, 613].includes(Number(code)) ||
        (Number(code) >= 80000 && Number(code) <= 80014)
      ) {
        await abortable(
          Promise.resolve(
            deps.recordUsage?.(connectionId, {
              ...usage,
              percent: Math.max(80, usage.percent),
              retryAfterMs: Math.max(60_000, usage.retryAfterMs),
            }),
          ),
          signal,
        );
        throw new FacebookReadError('throttled', Math.max(usage.retryAfterMs, 60_000));
      }
      if (
        response.status === 401 ||
        response.status === 403 ||
        [10, 190, 200].includes(Number(code))
      )
        throw new FacebookReadError('access');
      if (response.status === 404 || code === 100) throw new FacebookReadError('not-found');
      if (!response.ok || error)
        throw new FacebookReadError(
          response.status >= 500 || [1, 2].includes(Number(code)) ? 'temporary' : 'invalid-source',
          usage.retryAfterMs || null,
        );
      if (usage.percent >= 80)
        throw new FacebookReadError('throttled', Math.max(usage.retryAfterMs, 60_000));
      return data;
    } catch (error) {
      if (error instanceof FacebookReadError) throw error;
      if (parent.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new FacebookReadError('temporary');
    }
  };
}

export function nextFacebookCursor(paging: unknown, path: string): string | null {
  if (paging === undefined) return null;
  if (!paging || typeof paging !== 'object') throw new FacebookReadError('invalid-source');
  if (!('next' in paging) || paging.next === null || paging.next === '') return null;
  if (typeof paging.next !== 'string' || paging.next.length > 16_384)
    throw new FacebookReadError('invalid-source');
  let url: URL;
  try {
    url = new URL(paging.next);
  } catch {
    throw new FacebookReadError('invalid-source');
  }
  if (
    url.origin !== 'https://graph.facebook.com' ||
    url.pathname !== `/${FACEBOOK_VERSION}/${path}` ||
    url.username ||
    url.password
  )
    throw new FacebookReadError('invalid-source');
  const cursors = url.searchParams.getAll('after');
  if (cursors.length !== 1 || !cursors[0] || cursors[0].length > 2000)
    throw new FacebookReadError('invalid-source');
  return cursors[0];
}
