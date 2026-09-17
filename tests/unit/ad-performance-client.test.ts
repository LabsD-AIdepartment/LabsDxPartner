// @vitest-environment node
//
// Focused unit tests for the browser ad-performance client (`dev/ad-performance/client.ts`). They pin
// the four behaviours root asked to prove: a valid period is returned; a mismatched period is dropped;
// a hung request resolves to null after the internal timeout (without waiting the real 3s — the
// AbortSignal.timeout is swapped for a controlled AbortController); a parent-aborted request resolves
// to null; and a disabled endpoint (404) degrades to null instead of throwing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAdPerformance } from '../../dev/ad-performance/client';

// The client only uses PartnerAdPerformance.safeParse; stub it so these tests exercise the client's
// own period/abort/fallback logic rather than re-testing the (separately covered) contract shape.
vi.mock('@/contracts/partner-ad-performance', () => ({
  PartnerAdPerformance: { safeParse: (value: unknown) => ({ success: true, data: value }) },
}));

const request = { identity: 'a', clipId: 'clip-3', from: '2026-07-01', toExclusive: '2026-09-01' };
const performance = () => ({
  period: { from: '2026-07-01T00:00:00+07:00', toExclusive: '2026-09-01T00:00:00+07:00' },
  metrics: [],
});
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loadAdPerformance', () => {
  it('returns the parsed performance when the requested period matches', async () => {
    const value = performance();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ performance: value })));
    const result = await loadAdPerformance(request, new AbortController().signal);
    expect(result).toEqual(value);
  });

  it('drops a payload whose period does not match the request (null, never shown)', async () => {
    const mismatched = performance();
    mismatched.period.from = '2026-06-01T00:00:00+07:00';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ performance: mismatched })));
    expect(await loadAdPerformance(request, new AbortController().signal)).toBeNull();
  });

  it('resolves null when the request hangs past the internal timeout', async () => {
    // Swap the internal 3s AbortSignal.timeout for a controller we fire synchronously, so no real wait.
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    // A hung fetch that only settles when its (combined) signal aborts.
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = loadAdPerformance(request, new AbortController().signal);
    timeoutController.abort(); // the internal timeout fires
    await expect(promise).resolves.toBeNull();
  });

  it('resolves null when the caller aborts the request', async () => {
    const parent = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = loadAdPerformance(request, parent.signal);
    parent.abort(); // the caller's abort wins the race
    await expect(promise).resolves.toBeNull();
  });

  it('degrades to null when the endpoint is disabled (404), never throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'not_found' }, 404)));
    expect(await loadAdPerformance(request, new AbortController().signal)).toBeNull();
  });
});
