import { createHash, randomUUID } from 'node:crypto';
import { parseShopVideoProfiles, type VideoProfile } from './video-config';
import type { VideoPeriod, VideoCollection } from './video-contract';
import type { VideoPageEvidence } from './video-page';
import {
  OWNER_PATH,
  OWNER_PAGE_BODY_LIMIT,
  OwnerRequest,
  OwnerResponse,
  OwnerError,
  ServiceToken,
  boundedOwnerJson,
} from './owner-protocol';
import { SourceReadError } from '../source-error';
import { abortable } from './video-transport';

/** Portal-to-owner adapter: token is a service credential, never the seller OAuth credential. */
export function createShopVideoOwnerClient(
  rawProfiles: readonly VideoProfile[],
  origin: string,
  serviceToken: string,
  fetcher: typeof fetch = fetch,
) {
  const profiles = parseShopVideoProfiles(JSON.stringify(rawProfiles));
  const base = new URL(origin);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    !(base.protocol === 'https:' || (base.protocol === 'http:' && base.hostname === '127.0.0.1'))
  )
    throw new Error('Invalid owner origin');
  const token = ServiceToken.parse(serviceToken);
  const url = new URL(OWNER_PATH, base);
  const configured = (id: string) => {
    const p = profiles.find((p) => p.connectionId === id);
    return p ? { ...p } : undefined;
  };
  async function request(
    id: string,
    operation:
      | { action: 'verify' }
      | { action: 'collect'; period: VideoPeriod }
      | { action: 'page'; period: VideoPeriod; pageToken: string | null },
    parent: AbortSignal,
  ) {
    const p = configured(id);
    if (!p) throw new SourceReadError('access');
    const signal = AbortSignal.any([
      parent,
      AbortSignal.timeout(operation.action === 'collect' ? 70000 : 25000),
    ]);
    let response: Response | undefined;
    try {
      signal.throwIfAborted();
      const cmd = OwnerRequest.parse({
        requestId: randomUUID(),
        connectionId: id,
        sourceConnectionRef: p.sourceConnectionRef,
        ...operation,
      });
      response = await abortable(
        fetcher(url, {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify(cmd),
        }),
        signal,
      );
      if ([401, 403].includes(response.status)) throw new SourceReadError('access');
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        const delay = retry
          ? /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : Date.parse(retry) - Date.now()
          : 0;
        if (delay > Number.MAX_SAFE_INTEGER) throw new SourceReadError('invalid-source');
        const retryAfter = Math.max(60000, Number.isFinite(delay) ? delay : 0);
        if (response.status === 429) throw new SourceReadError('throttled', retryAfter);
        // Proxies may return HTML/empty 5xx. Do not turn an outage into a permanent schema hold.
        let body: unknown;
        try {
          body = await boundedOwnerJson(response.body, signal, 4096);
        } catch {
          signal.throwIfAborted();
          throw new SourceReadError(
            response.status >= 500 ? 'temporary' : 'invalid-source',
            response.status >= 500 ? retryAfter : null,
          );
        }
        const error = OwnerError.safeParse(body);
        if (error.success)
          throw new SourceReadError(
            error.data.code,
            error.data.retryAfterMs === null && !retry
              ? null
              : Math.max(error.data.retryAfterMs ?? 0, retryAfter),
          );
        throw new SourceReadError(
          response.status >= 500 ? 'temporary' : 'invalid-source',
          response.status >= 500 ? retryAfter : null,
        );
      }
      const body = await boundedOwnerJson(
        response.body,
        signal,
        operation.action === 'page' ? OWNER_PAGE_BODY_LIMIT : 12000000,
      );
      const parsed = OwnerResponse.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.requestId !== cmd.requestId ||
        parsed.data.action !== cmd.action
      )
        throw new SourceReadError('invalid-source');
      const result = parsed.data;
      if (result.action === 'verify') {
        const proof = result.result;
        if (
          proof.connectionId !== id ||
          proof.namespace !== p.namespace ||
          proof.accountId !== p.shopId ||
          proof.sourceConnectionRef !== p.sourceConnectionRef ||
          proof.configurationDigest !== createHash('sha256').update(JSON.stringify(p)).digest('hex')
        )
          throw new SourceReadError('invalid-source');
      } else {
        if (cmd.action === 'verify') throw new SourceReadError('invalid-source');
        const r = result.result;
        const { connectionId, namespace, shopId, currency, timezone } = p;
        if (
          JSON.stringify(r.connection) !==
            JSON.stringify({ connectionId, namespace, shopId, currency, timezone }) ||
          r.period.from !== cmd.period.from ||
          r.period.toExclusive !== cmd.period.toExclusive
        )
          throw new SourceReadError('invalid-source');
        if (
          result.action === 'page' &&
          (cmd.action !== 'page' || result.result.requestedPageToken !== cmd.pageToken)
        )
          throw new SourceReadError('invalid-source');
      }
      signal.throwIfAborted();
      return result;
    } catch (error) {
      if (parent.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error instanceof SourceReadError) throw error;
      throw new SourceReadError('temporary');
    } finally {
      if (response && !response.bodyUsed) void response.body?.cancel().catch(() => {});
    }
  }
  return {
    configured,
    async verify(id: string, signal: AbortSignal) {
      const r = await request(id, { action: 'verify' }, signal);
      if (r.action !== 'verify') throw new SourceReadError('invalid-source');
      return r.result;
    },
    async collect(id: string, period: VideoPeriod, signal: AbortSignal): Promise<VideoCollection> {
      const r = await request(id, { action: 'collect', period }, signal);
      if (r.action !== 'collect') throw new SourceReadError('invalid-source');
      return r.result;
    },
    async page(
      id: string,
      period: VideoPeriod,
      pageToken: string | null,
      signal: AbortSignal,
    ): Promise<VideoPageEvidence> {
      const r = await request(id, { action: 'page', period, pageToken }, signal);
      if (r.action !== 'page') throw new SourceReadError('invalid-source');
      return r.result;
    },
  };
}
