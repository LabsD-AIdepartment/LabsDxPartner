import { createTikTokQuota } from './quota';
import { createSaleDashboardVideoCredentialResolver } from './sale-dashboard-credentials';
import { createShopVideoOwnerHandler } from './owner-handler';
import { SourceReadError } from '../source-error';

/** Public installation contract. No Portal types, schemas, aliases or DB client required. */
export type ShopVideoOwnerOptions = {
  enabled: boolean;
  profiles: readonly {
    connectionId: string;
    namespace: string;
    shopId: string;
    currency: string;
    timezone: string;
    acquisitionOwner: 'sale-dashboard';
    sourceConnectionRef: string;
  }[];
  bindings: readonly {
    sourceConnectionRef: string;
    connectedAccountId: number;
    credentialId: number;
  }[];
  clients: readonly { tokenSha256: string; connectionIds: readonly string[] }[];
  /** Called only when enabled; source owns SQL, encryption and shared outbound quota. */
  connect: () => {
    query: (config: {
      text: string;
      values: [number, number, string];
      query_timeout: number;
    }) => Promise<{ rows: unknown[] }>;
    decryptToken: (encrypted: Buffer) => string;
    reserveRequest: (
      scope: { connectionId: string; appKey: string; shopCipher: string },
      signal: AbortSignal,
    ) => Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }>;
    fetch?: typeof fetch;
    now?: () => number;
  };
};

/** Fixed M2M handler. Default-off callers should pass enabled: envFlag === '1'.
 * Disabled construction/request never resolves ports, profiles or credentials. */
export function createSaleDashboardShopVideoOwner(
  options: ShopVideoOwnerOptions,
): (request: Request) => Promise<Response> {
  if (options.enabled !== true)
    return async () =>
      new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  try {
    const ports = options.connect();
    if (typeof ports.reserveRequest !== 'function') throw new Error('Missing quota reservation');
    const credential = createSaleDashboardVideoCredentialResolver(
      options.profiles,
      options.bindings,
      ports,
    );
    return createShopVideoOwnerHandler(
      options.profiles,
      options.clients.map((c) => ({
        tokenSha256: c.tokenSha256,
        connectionIds: [...c.connectionIds],
      })),
      {
        credential,
        beforeRequest: async (id, signal, scope) => {
          signal.throwIfAborted();
          const reservation = await ports.reserveRequest({ connectionId: id, ...scope }, signal);
          signal.throwIfAborted();
          if (reservation?.allowed === true) return;
          if (
            reservation?.allowed === false &&
            Number.isSafeInteger(reservation.retryAfterMs) &&
            reservation.retryAfterMs > 0
          )
            throw new SourceReadError('throttled', reservation.retryAfterMs);
          // A malformed/unavailable governor never becomes permission to call upstream.
          throw new SourceReadError('temporary');
        },
        fetch: ports.fetch,
        now: ports.now,
      },
    );
  } catch {
    // Configuration errors can include credential-adjacent values; never expose raw errors.
    throw new Error('Invalid shop video owner configuration');
  }
}

/** One governor shared by every source caller using the same app/shop. */
export function createTikTokQuotaGovernor(options: {
  appPerSecond: number;
  shopPerSecond: number;
  eval: (script: string, numberOfKeys: number, ...args: (string | number)[]) => Promise<unknown>;
}): {
  reserve: (
    scope: { appKey: string; shopCipher?: string },
    signal: AbortSignal,
  ) => Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }>;
} {
  return createTikTokQuota(options);
}
