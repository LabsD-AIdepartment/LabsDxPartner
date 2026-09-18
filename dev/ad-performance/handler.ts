// Development-only GET handler for the ad-performance snapshot preview. Server-only: it reads a
// persisted snapshot file (via store.ts / node:fs) and projects it to Celeb-safe metrics. It is
// selected by the `@ad-performance-handler` build alias ONLY in the development server; production
// resolves the alias to handler.unavailable.ts (a 404 stub) so neither this code nor the fixture
// marker ships.
//
// Contract:
//   GET /api/dev/ad-performance?identity=<id>&clip=<clipId>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
//     → 200 application/json { performance: PartnerAdPerformance }  (Celeb-safe; no counts)
//     → 404  disabled / unknown binding / window mismatch / missing snapshot / cross-identity / non-dev
//     → 503  persisted snapshot failed validation
//
// It accepts ONLY identity+clip+from+to and matches them against the SERVER-OWNED binding allowlist;
// no adId, accountId, URL, path or credential reference is ever accepted from the browser. Requests
// must originate from loopback (Host/Origin); there is no CORS wildcard.

import {
  readAdSnapshotBindings,
  findAdSnapshotBinding,
  adSnapshotDir,
  adSnapshotFileName,
  adSnapshotWindowFileName,
  adSnapshotAutoRefreshEnabled,
  deriveRequestedWindowBinding,
  type AdSnapshotBindingConfigValue,
} from '@/server/modules/marketing-ads/facebook/snapshot-config';
import {
  projectAdSnapshot,
  AdSnapshotScopeError,
} from '@/server/modules/marketing-ads/facebook/snapshot-projection';
import { readSnapshotFile, MissingSnapshotError } from './store';
import { acquireAutoSnapshot, AUTO_CACHE_FRESH_MS } from './auto-refresh';

// Referencing the marker at runtime lets scripts/verify-no-demo.mjs detect any leak into production.
export const AD_PERFORMANCE_MARKER = 'synthetic-ad-performance-snapshot';

export type AutoRefreshFn = (params: {
  env: Record<string, string | undefined>;
  dir: string;
  fileName: string;
  binding: AdSnapshotBindingConfigValue;
  now: () => number;
  fetch?: typeof fetch;
}) => Promise<unknown>;

export interface HandlerDeps {
  env?: Record<string, string | undefined>;
  dir?: string;
  readSnapshot?: (dir: string, fileName: string) => unknown;
  // Auto-refresh seams (opt-in, dev-only). Defaults use the real coordinator/clock/fetch.
  now?: () => number;
  fetch?: typeof fetch;
  autoRefresh?: AutoRefreshFn;
  readDatabase?: (binding: AdSnapshotBindingConfigValue) => Promise<{ raw: unknown; stale: boolean } | null>;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'x-ad-performance': AD_PERFORMANCE_MARKER,
} as const;

function notFound(reason: string): Response {
  return new Response(JSON.stringify({ error: 'not_found', reason }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}
function unavailable(reason: string): Response {
  return new Response(JSON.stringify({ error: 'unavailable', reason }), {
    status: 503,
    headers: JSON_HEADERS,
  });
}

/**
 * Parse an authority (host[:port]) into `{ bare, port }` iff it is a well-formed loopback authority,
 * else null. `port` includes its leading colon (or is '' when absent). Strict: a malformed IPv6 form
 * such as `[::1]evil` (trailing junk after the bracket) or a non-numeric port is rejected outright
 * rather than silently truncated.
 */
function loopbackParts(raw: string | null): { bare: string; port: string } | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  let bare: string;
  let port = '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end === -1) return null;
    bare = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null; // reject `[::1]evil`, `[::1]:x`
    port = rest;
  } else {
    const colon = value.indexOf(':');
    if (colon === -1) {
      bare = value;
    } else {
      bare = value.slice(0, colon);
      const rest = value.slice(colon);
      if (!/^:\d{1,5}$/.test(rest)) return null; // reject junk/multiple colons on a non-bracket host
      port = rest;
    }
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(bare)) return null;
  return { bare, port };
}

/**
 * Canonicalize an authority (host[:port]) to `bare[:port]` iff it is a well-formed loopback authority,
 * else null.
 */
function loopbackHost(raw: string | null): string | null {
  const parts = loopbackParts(raw);
  return parts ? parts.bare + parts.port : null;
}

/**
 * True iff the request URL authority `url` may legitimately differ from the actual Host authority
 * `host` ONLY because of the installed framework's URL normalization. Next's `NextURL` rewrites a
 * loopback hostname (`127.0.0.1` / `[::1]`) to `localhost` on `request.url` while the wire Host header
 * still carries the real alias (see node_modules/next/dist/server/web/next-url.js). We therefore accept
 * an identical authority, OR a URL hostname of exactly `localhost` against a Host of `127.0.0.1`/`::1`
 * — but ONLY when the port is identical. This is deliberately NOT any-loopback/any-port acceptance.
 */
function urlHostAgreesWithActualHost(
  url: { bare: string; port: string },
  host: { bare: string; port: string },
): boolean {
  if (url.port !== host.port) return false; // same port required in every case
  if (url.bare === host.bare) return true; // identical normal case
  return url.bare === 'localhost' && (host.bare === '127.0.0.1' || host.bare === '::1');
}

/**
 * Loopback + same-origin only. The request Host must be a well-formed loopback authority; a present
 * URL host must agree with it; any Origin present must be an EXACT same-origin loopback ORIGIN
 * (scheme AND authority, not merely a matching authority); and a present Sec-Fetch-Site must not be
 * cross-site. A no-Origin loopback curl and a same-origin browser request both pass; a cross-origin,
 * cross-scheme (e.g. `https://127.0.0.1:4187` against an `http://127.0.0.1:4187` request), spoofed-host
 * or credential/path-bearing-Origin request does not.
 */
export function isLoopbackRequest(request: Request): boolean {
  let requestUrl: URL | null = null;
  try {
    requestUrl = new URL(request.url);
  } catch {
    requestUrl = null;
  }
  const urlHost = requestUrl?.host ?? null;
  const hostHeader = request.headers.get('host');
  // The strict guard is the ACTUAL Host header when present; only in its absence do we fall back to the
  // URL authority (the legitimate no-Host-header unit/curl case).
  const hostParts = loopbackParts(hostHeader ?? urlHost);
  if (!hostParts) return false;
  const host = hostParts.bare + hostParts.port;
  // If both a Host header and a URL host are present, they must agree. They agree when identical, or
  // when the URL authority differs ONLY because the framework normalized a loopback alias
  // (127.0.0.1 / [::1]) to `localhost` on request.url at the SAME port. Nothing broader is accepted.
  if (hostHeader && urlHost) {
    const urlParts = loopbackParts(urlHost);
    if (!urlParts || !urlHostAgreesWithActualHost(urlParts, hostParts)) return false;
  }
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite.trim().toLowerCase()))
    return false;
  const origin = request.headers.get('origin');
  if (origin) {
    const raw = origin.trim();
    let originUrl: URL;
    try {
      originUrl = new URL(raw);
    } catch {
      return false;
    }
    if (!['http:', 'https:'].includes(originUrl.protocol)) return false;
    // A real Origin is `scheme://host[:port]` ONLY. Reject any userinfo/path/query/fragment (e.g.
    // `http://user:pass@127.0.0.1`, `http://127.0.0.1/evil`, `http://127.0.0.1?x=1`): the canonical
    // serialized origin must equal the header verbatim.
    if (originUrl.origin !== raw) return false;
    const originHost = loopbackHost(originUrl.host);
    if (!originHost || originHost !== host) return false; // exact same-origin authority
    // Protocol must ALSO match the request's own scheme — an authority match alone lets a cross-scheme
    // Origin (`https://…` against an `http://…` request) masquerade as same-origin.
    if (requestUrl && originUrl.protocol !== requestUrl.protocol) return false;
  }
  return true;
}

const IDENTITY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleAdPerformanceRequest(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  if (process.env.NODE_ENV !== 'development') return notFound('development-only');
  if (request.method !== 'GET') return notFound('method');
  if (!isLoopbackRequest(request)) return notFound('loopback-only');

  return handleAuthorizedAdPerformanceRequest(request, deps);
}

/** Shared validated read projection. Callers must enforce their own authentication boundary. */
export async function handleAuthorizedAdPerformanceRequest(request: Request, deps: HandlerDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const url = new URL(request.url);
  // Accept EXACTLY identity+clip+from+to. Reject any unknown key and any duplicated value so an
  // attacker cannot smuggle a second/overriding parameter past the allowlist matching below.
  const allowedParams = new Set(['identity', 'clip', 'from', 'to']);
  for (const key of url.searchParams.keys()) if (!allowedParams.has(key)) return notFound('unknown query');
  for (const key of allowedParams)
    if (url.searchParams.getAll(key).length > 1) return notFound('duplicate query');
  const identity = url.searchParams.get('identity') ?? '';
  const clipId = url.searchParams.get('clip') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!IDENTITY.test(identity) || !clipId || clipId.length > 160 || !DATE.test(from) || !DATE.test(to))
    return notFound('invalid request');

  let bindings;
  try {
    bindings = readAdSnapshotBindings(env);
  } catch {
    return notFound('configuration unavailable');
  }
  if (!bindings.length) return notFound('preview disabled');
  // One read generation for every connected clip, including Overview. Browser supplies no ad ids.
  if (clipId === 'all') {
    let rates: Record<string, unknown>;
    try { rates = JSON.parse(env.LABSD_AD_COMMISSION_RATES_PPM || '{}'); }
    catch { return unavailable('commission policy unavailable'); }
    if (!rates || typeof rates !== 'object' || Array.isArray(rates))
      return unavailable('commission policy unavailable');
    const selected = bindings.filter(b => b.identity === identity);
    const connections = [];
    // Bound concurrency to four provider reports. Existing per-scope coordinator deduplicates reads.
    for (let offset = 0; offset < selected.length; offset += 4) {
      const chunk = await Promise.all(selected.slice(offset, offset + 4).map(async b => {
        deriveRequestedWindowBinding(b, from, to);
        const target = new URL(request.url);
        target.searchParams.set('clip', b.clipId);
        const response = await handleAuthorizedAdPerformanceRequest(new Request(target, { headers: request.headers }), deps);
        const body = response.ok ? await response.json() : null;
        const rate = rates[`${identity}:${b.clipId}`];
        return { clipId: b.clipId, adId: b.adId,
          ratePpm: typeof rate === 'number' && Number.isInteger(rate) && rate >= 0 && rate <= 1_000_000 ? rate : null,
          performance: body?.performance ?? null };
      })).catch(() => null);
      if (!chunk) return notFound('invalid window');
      connections.push(...chunk);
    }
    return new Response(JSON.stringify({
      period: { from: from + 'T00:00:00+07:00', toExclusive: to + 'T00:00:00+07:00', timezone: 'Asia/Bangkok' },
      connections,
    }), { status: 200, headers: JSON_HEADERS });
  }
  const binding = findAdSnapshotBinding(bindings, identity, clipId);
  if (!binding) return notFound('unknown binding');

  if (env.LABSD_AD_SNAPSHOT_DATABASE === '1') {
    let derived: AdSnapshotBindingConfigValue;
    try {
      derived = deriveRequestedWindowBinding(binding, from, to);
      // No future reporting windows can create background provider work.
      const tomorrow = new Date((deps.now?.() ?? Date.now()) + 7 * 3600_000).toISOString().slice(0, 10);
      if (Date.parse(to) > Date.parse(tomorrow) + 86400_000) return notFound('invalid window');
    } catch { return notFound('invalid window'); }
    try {
      const readDatabase = deps.readDatabase ?? (await import('@/server/modules/marketing-ads/facebook/snapshot-database-runtime')).readDatabaseAdSnapshot;
      const stored = await readDatabase(derived);
      if (!stored) return notFound('awaiting scheduled report');
      return serve(stored.raw, { identity, clipId, from, to }, derived, null, stored.stale);
    } catch { return unavailable('database report unavailable'); }
  }

  const dir = deps.dir ?? adSnapshotDir(env);
  const read = deps.readSnapshot ?? readSnapshotFile;
  const isConfiguredWindow = from === binding.from && to === binding.toExclusive;

  // OFF (default): keep the EXACT read-only, configured-window-only behavior — never call the provider.
  if (!adSnapshotAutoRefreshEnabled(env)) {
    if (!isConfiguredWindow) return notFound('window mismatch');
    const cache = readCache(read, dir, adSnapshotFileName(binding));
    if (cache instanceof Response) return cache; // MissingSnapshotError → 404, other → 503
    return serve(cache.raw, { identity, clipId, from, to }, binding, null);
  }

  // ON (opt-in): serve any bounded requested window for the SAME verified ad identity. Validate the
  // requested window (real ISO dates, 1..93-day integer span) BEFORE any provider work; on failure the
  // provider is never reached.
  let derived: AdSnapshotBindingConfigValue;
  try {
    derived = deriveRequestedWindowBinding(binding, from, to);
  } catch {
    return notFound('invalid window');
  }
  const windowFile = adSnapshotWindowFileName(binding, from, to);
  const now = deps.now ?? Date.now;
  const query = { identity, clipId, from, to };

  // Cache candidates: the exact window-specific file, plus (ONLY for the configured window) the legacy
  // base file. Auto-refresh only ever writes the window-specific file, so the base file is never
  // overwritten for another period. A hard read failure (not a missing file) surfaces as 503.
  const windowCache = readCache(read, dir, windowFile);
  if (windowCache instanceof Response && windowCache.status !== 404) return windowCache;
  const legacyCache: CacheHit | Response = isConfiguredWindow
    ? readCache(read, dir, adSnapshotFileName(binding))
    : notFound('no snapshot');
  if (legacyCache instanceof Response && legacyCache.status !== 404) return legacyCache;

  // Freshness is a property of a present CacheHit ONLY; keep it a plain boolean predicate. A type
  // predicate (`c is CacheHit`) would wrongly narrow the NON-fresh path to `Response`, erasing a still
  // present STALE CacheHit (its `.raw` fallback below would type as `never`). The runtime check is
  // identical — the caller first excludes `Response`, then tests the freshness window.
  const isFresh = (c: CacheHit): boolean =>
    env.LABSD_AD_SNAPSHOT_REFRESH_ON_VISIT !== '1' &&
    c.fetchedAt !== null && now() >= c.fetchedAt && now() - c.fetchedAt <= AUTO_CACHE_FRESH_MS;

  // 1. A fresh cache is served with NO provider call (prefer the exact window file). Local-preview
  // freshness policy: AUTO_CACHE_FRESH_MS.
  if (!(windowCache instanceof Response) && isFresh(windowCache))
    return serve(windowCache.raw, query, derived, null);
  if (!(legacyCache instanceof Response) && isFresh(legacyCache))
    return serve(legacyCache.raw, query, derived, null);

  // 2. Missing/stale → bounded single-flight acquisition for the EXACT requested window (its own
  // deadline, NOT tied to the client's abort). It never throws to us and never leaks its cause.
  const automaticRefreshFrom = new Date(now()).toISOString();
  const autoRefresh = deps.autoRefresh ?? defaultAutoRefresh;
  await autoRefresh({ env, dir, fileName: windowFile, binding: derived, now, fetch: deps.fetch });
  const refreshed = readCache(read, dir, windowFile);
  if (refreshed instanceof Response && refreshed.status !== 404) return refreshed;
  if (!(refreshed instanceof Response)) return serve(refreshed.raw, query, derived, automaticRefreshFrom);

  // 3. Acquisition did not populate the cache (e.g. absent credential / provider error / deadline):
  // serve a still-present STALE cache if we have one, else 404 (client degrades to null). Nothing here
  // leaks the underlying cause.
  if (!(windowCache instanceof Response)) return serve(windowCache.raw, query, derived, automaticRefreshFrom);
  if (!(legacyCache instanceof Response)) return serve(legacyCache.raw, query, derived, automaticRefreshFrom);
  return notFound('no snapshot');
}

type CacheHit = { raw: unknown; fetchedAt: number | null };

/**
 * Read a persisted snapshot file, returning its raw JSON plus a parsed `fetchedAt` epoch (for freshness),
 * or a Response on failure: 404 (via MissingSnapshotError) for an absent file, 503 for any other read
 * error. Never throws.
 */
function readCache(
  read: (dir: string, fileName: string) => unknown,
  dir: string,
  fileName: string,
): CacheHit | Response {
  let raw: unknown;
  try {
    raw = read(dir, fileName);
  } catch (error) {
    if (error instanceof MissingSnapshotError) return notFound('no snapshot');
    return unavailable('snapshot read failed');
  }
  let fetchedAt: number | null = null;
  if (raw && typeof raw === 'object' && 'fetchedAt' in raw) {
    const parsed = Date.parse(String((raw as { fetchedAt: unknown }).fetchedAt));
    fetchedAt = Number.isNaN(parsed) ? null : parsed;
  }
  return { raw, fetchedAt };
}

/**
 * Project a cached snapshot to Celeb-safe performance against the CURRENT (possibly requested-window)
 * binding and answer 200, or 404 on scope mismatch / 503 on validation failure. `automaticRefreshFrom`
 * is echoed (contract-optional) only when this response involved an automatic acquisition.
 */
function serve(
  raw: unknown,
  request: { identity: string; clipId: string; from: string; to: string },
  binding: AdSnapshotBindingConfigValue,
  automaticRefreshFrom: string | null,
  storedStale = false,
): Response {
  try {
    const projected = projectAdSnapshot(
      raw,
      { identity: request.identity, clipId: request.clipId, from: request.from, toExclusive: request.to },
      binding,
    );
    const refreshFailed = automaticRefreshFrom !== null &&
      (!projected.fetchedAt || Date.parse(projected.fetchedAt) < Date.parse(automaticRefreshFrom));
    const performance = storedStale && projected.state !== 'unavailable' ? {
      ...projected, state: 'stale', reasons: [...projected.reasons, 'แสดงข้อมูลล่าสุดที่บันทึกไว้ รอการอัปเดตรอบถัดไป'],
    } : automaticRefreshFrom ? {
      ...projected,
      automaticRefreshFrom,
      ...(refreshFailed && projected.state !== 'unavailable' ? {
        state: 'stale',
        reasons: [...projected.reasons, 'อัปเดตจากแพลตฟอร์มไม่สำเร็จ แสดงข้อมูลล่าสุดที่บันทึกไว้'],
      } : {}),
    } : projected;
    return new Response(JSON.stringify({ performance }), { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    // A scope mismatch (e.g. a foreign identity's snapshot on disk) must not leak: report not-found.
    if (error instanceof AdSnapshotScopeError) return notFound('scope mismatch');
    return unavailable('snapshot failed validation');
  }
}

/** Default acquisition seam: the bounded, single-flight coordinator (project-local atomic write). */
const defaultAutoRefresh: AutoRefreshFn = (params) =>
  acquireAutoSnapshot({
    env: params.env,
    dir: params.dir,
    fileName: params.fileName,
    binding: params.binding,
    now: params.now,
    fetch: params.fetch,
  });
