import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { SourceReadError } from '../source-error';
import { ShopVideoConnection, type VideoConnection } from './video-contract';
import { SHOP_VIDEO_PATH, type VideoCollectorDependencies } from './video-collector';

const Secret = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/u);
export const ShopVideoCredentialSchema = z.strictObject({
  shopId: ShopVideoConnection.shape.shopId,
  appKey: Secret,
  appSecret: Secret,
  accessToken: Secret,
  shopCipher: Secret,
});
export type ShopVideoCredential = z.infer<typeof ShopVideoCredentialSchema>;
export const AUTHORIZED_SHOPS_PATH = '/authorization/202309/shops';
const VideoRequestSchema = z.strictObject({
  connectionId: ShopVideoConnection.shape.connectionId,
  path: z.literal(SHOP_VIDEO_PATH),
  query: z.strictObject({
    start_date_ge: z.iso.date(),
    end_date_lt: z.iso.date(),
    page_size: z.literal('100'),
    sort_field: z.literal('gmv'),
    sort_order: z.literal('DESC'),
    currency: z.literal('LOCAL'),
    account_type: z.literal('ALL'),
    page_token: z.string().min(1).max(2000).optional(),
  }),
});
const Request = z.discriminatedUnion('path', [
  VideoRequestSchema,
  z.strictObject({
    connectionId: ShopVideoConnection.shape.connectionId,
    path: z.literal(AUTHORIZED_SHOPS_PATH),
    query: z.strictObject({}),
  }),
]);
export type VideoTransportDependencies = {
  credential: (connectionId: string, signal: AbortSignal) => Promise<ShopVideoCredential>;
  /** Required: the acquisition owner reserves account/app quota before each call. */
  beforeRequest: (
    connectionId: string,
    signal: AbortSignal,
    scope: { appKey: string; shopCipher: string },
  ) => Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
};
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        abort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new SourceReadError('invalid-source');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const row = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (row.done) break;
      size += row.value.byteLength;
      if (size > 2_000_000) throw new SourceReadError('invalid-source');
      chunks.push(row.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new SourceReadError('invalid-source');
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Read-only, fixed-host transport. Factory construction does not enable a native provider.
 * The injected credential owner must independently verify shop_cipher -> shopId and access rights.
 * This client neither refreshes tokens nor installs another credential store.
 */
function createSignedShopRead(
  rawConnections: readonly VideoConnection[],
  deps: VideoTransportDependencies,
) {
  const configured = new Map<string, VideoConnection>();
  for (const raw of rawConnections) {
    const parsed = ShopVideoConnection.safeParse(raw);
    if (!parsed.success || configured.has(parsed.data.connectionId))
      throw new SourceReadError('invalid-source');
    configured.set(parsed.data.connectionId, parsed.data);
  }
  return async (raw: z.infer<typeof Request>, parent: AbortSignal) => {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
    let response: Response | undefined;
    try {
      signal.throwIfAborted();
      const parsed = Request.safeParse(raw);
      if (!parsed.success) throw new SourceReadError('invalid-source');
      const request = parsed.data,
        connection = configured.get(request.connectionId);
      if (!connection) throw new SourceReadError('access');
      if (request.path === SHOP_VIDEO_PATH) {
        const days =
          (Date.parse(request.query.end_date_lt) - Date.parse(request.query.start_date_ge)) /
          86400000;
        if (days < 1 || days > 31) throw new SourceReadError('invalid-source');
      }
      const credential = ShopVideoCredentialSchema.safeParse(
        await abortable(deps.credential(connection.connectionId, signal), signal),
      );
      if (!credential.success || credential.data.shopId !== connection.shopId)
        throw new SourceReadError('access');
      signal.throwIfAborted();
      const c = credential.data;
      await abortable(
        deps.beforeRequest(connection.connectionId, signal, {
          appKey: c.appKey,
          shopCipher: c.shopCipher,
        }),
        signal,
      );
      signal.throwIfAborted();
      const query: Record<string, string> = {
        ...request.query,
        app_key: c.appKey,
        ...(request.path === SHOP_VIDEO_PATH ? { shop_cipher: c.shopCipher } : {}),
        timestamp: String(Math.floor((deps.now ?? Date.now)() / 1000)),
      };
      const input =
        request.path +
        Object.keys(query)
          .sort()
          .map((key) => key + query[key])
          .join('');
      query.sign = createHmac('sha256', c.appSecret)
        .update(c.appSecret + input + c.appSecret, 'utf8')
        .digest('hex');
      const url = new URL(request.path, 'https://open-api.tiktokglobalshop.com');
      url.search = new URLSearchParams(query).toString();
      response = await abortable(
        (deps.fetch ?? fetch)(url, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          signal,
          headers: {
            'x-tts-access-token': c.accessToken,
            'content-type': 'application/json',
            accept: 'application/json',
          },
        }),
        signal,
      );
      const retry = response.headers.get('retry-after');
      const retryDelay = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - (deps.now ?? Date.now)()
        : 0;
      // Preserve a valid provider minimum, including HTTP dates; never cap it to an earlier retry.
      if (retryDelay > Number.MAX_SAFE_INTEGER) throw new SourceReadError('invalid-source');
      const retryAfterMs = Math.max(60_000, Number.isFinite(retryDelay) ? retryDelay : 0);
      if (response.status === 429) throw new SourceReadError('throttled', retryAfterMs);
      if ([401, 403].includes(response.status)) throw new SourceReadError('access');
      if (response.status >= 500) throw new SourceReadError('temporary');
      if (!response.ok) throw new SourceReadError('invalid-source');
      const body = await json(response, signal);
      const status = z.object({ code: z.number().int() }).safeParse(body);
      if (!status.success) throw new SourceReadError('invalid-source');
      if (status.data.code === 36009002) throw new SourceReadError('throttled', retryAfterMs);
      if ([36009003, 36009007].includes(status.data.code)) throw new SourceReadError('temporary');
      if ([101000, 106001].includes(status.data.code)) throw new SourceReadError('access');
      if (status.data.code !== 0) throw new SourceReadError('invalid-source');
      return body;
    } catch (error) {
      if (parent.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error instanceof SourceReadError) throw error;
      throw new SourceReadError('temporary');
    } finally {
      if (response && !response.bodyUsed) void response.body?.cancel().catch(() => {});
    }
  };
}

/** Existing video-only public port cannot be used to call the authorization endpoint. */
export function createShopVideoTransport(
  connections: readonly VideoConnection[],
  deps: VideoTransportDependencies,
): VideoCollectorDependencies['request'] {
  const read = createSignedShopRead(connections, deps);
  return (raw, signal) => {
    const parsed = VideoRequestSchema.safeParse(raw);
    if (!parsed.success) return Promise.reject(new SourceReadError('invalid-source'));
    return read(parsed.data, signal);
  };
}
/** Owner-side authorization check. Returns bounded raw evidence only to the verifier, never browser data. */
export function createShopAuthorizationRead(
  connections: readonly VideoConnection[],
  deps: VideoTransportDependencies,
) {
  const read = createSignedShopRead(connections, deps);
  return (connectionId: string, signal: AbortSignal) =>
    read({ connectionId, path: AUTHORIZED_SHOPS_PATH, query: {} }, signal);
}
