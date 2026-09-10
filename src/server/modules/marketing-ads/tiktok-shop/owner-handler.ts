import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Id } from '@/contracts/common';
import { parseShopVideoProfiles, type VideoProfile } from './video-config';
import { createShopVideoVerifier } from './video-verifier';
import { createShopVideoCollector } from './video-collector';
import { createShopVideoTransport, type VideoTransportDependencies } from './video-transport';
import {
  OwnerRequest,
  OwnerResponse,
  OWNER_PATH,
  ServiceToken,
  boundedOwnerJson,
} from './owner-protocol';
import { SourceReadError } from '../source-error';

const Clients = z
  .array(
    z.strictObject({
      tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
      connectionIds: z.array(Id).min(1).max(100),
    }),
  )
  .min(1)
  .max(100);
/** Install inside the credential owner's service. Never exposes OAuth tokens or arbitrary proxying.
 * Host retains authentication secret provisioning, refresh ownership and per-call quota authority. */
export function createShopVideoOwnerHandler(
  rawProfiles: readonly VideoProfile[],
  rawClients: z.input<typeof Clients>,
  deps: VideoTransportDependencies,
) {
  const profiles = parseShopVideoProfiles(JSON.stringify(rawProfiles));
  const clients = Clients.parse(rawClients);
  if (
    new Set(clients.map((c) => c.tokenSha256)).size !== clients.length ||
    clients.some(
      (c) =>
        new Set(c.connectionIds).size !== c.connectionIds.length ||
        c.connectionIds.some((id) => !profiles.some((p) => p.connectionId === id)),
    )
  )
    throw new Error('Invalid owner client configuration');
  const connections = profiles.map(({ connectionId, namespace, shopId, currency, timezone }) => ({
    connectionId,
    namespace,
    shopId,
    currency,
    timezone,
  }));
  const verifier = createShopVideoVerifier(profiles, deps);
  const collect = createShopVideoCollector(connections, {
    request: createShopVideoTransport(connections, deps),
    now: deps.now,
  });
  const headers = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname !== OWNER_PATH || url.search)
      return new Response(null, { status: 404, headers });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers });
    // This is an M2M boundary, never an alternate public browser/session endpoint.
    if (request.headers.has('origin')) return new Response(null, { status: 403, headers });
    const token = ServiceToken.safeParse(
      request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1],
    );
    if (!token.success) return new Response(null, { status: 401, headers });
    const hash = createHash('sha256').update(token.data).digest();
    const client = clients.find((c) => timingSafeEqual(hash, Buffer.from(c.tokenSha256, 'hex')));
    if (!client) return new Response(null, { status: 401, headers });
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      return new Response(null, { status: 415, headers });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(65000)]);
    try {
      const parsed = OwnerRequest.safeParse(await boundedOwnerJson(request.body, signal, 4096));
      if (!parsed.success) return new Response(null, { status: 400, headers });
      const cmd = parsed.data,
        profile = profiles.find((p) => p.connectionId === cmd.connectionId);
      if (
        !profile ||
        !client.connectionIds.includes(cmd.connectionId) ||
        profile.sourceConnectionRef !== cmd.sourceConnectionRef
      )
        return new Response(null, { status: 403, headers });
      const result =
        cmd.action === 'verify'
          ? await verifier.verify(cmd.connectionId, signal)
          : await collect(cmd.connectionId, cmd.period, signal);
      const body = OwnerResponse.parse({ requestId: cmd.requestId, action: cmd.action, result });
      const encoded = JSON.stringify(body);
      if (Buffer.byteLength(encoded) > 12000000) throw new SourceReadError('invalid-source');
      return new Response(encoded, {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const code =
        error instanceof SourceReadError && error.code !== 'not-found' ? error.code : 'temporary';
      const retryAfterMs = error instanceof SourceReadError ? error.retryAfterMs : null;
      return Response.json({ code, retryAfterMs }, { status: 503, headers });
    }
  };
}
