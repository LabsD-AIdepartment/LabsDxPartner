// @vitest-environment node
//
// Unit tests for the dev auto-refresh coordinator (`dev/ad-performance/auto-refresh.ts`): single-flight
// per scope+window, bounded provider deadline, and graceful `unavailable` on failure/absent credentials
// (never a fabricated zero, never a token/URL/error leak). The real snapshot builder is exercised for
// the credential-present/absent paths; a fake builder isolates the concurrency/deadline behavior.

import { describe, it, expect, vi } from 'vitest';
import { loadAdPerformance } from '../../dev/ad-performance/client';
import { acquireAutoSnapshot } from '../../dev/ad-performance/auto-refresh';
import { parseAdSnapshotBindings } from '@/server/modules/marketing-ads/facebook/snapshot-config';
import { AdPerformanceSnapshot } from '@/contracts/ad-performance-snapshot';
import type { buildAdSnapshot } from '@/server/modules/marketing-ads/facebook/snapshot-refresh';

const binding = parseAdSnapshotBindings(
  JSON.stringify([
    {
      identity: 'a',
      clipId: 'clip-3',
      profileId: 'fb-primary',
      namespace: 'meta',
      accountId: '123',
      adId: '52513673563767',
      expectedCreativeId: '1004085732033027',
      expectedVideoId: '2629443027486387',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
      from: '2026-07-01',
      toExclusive: '2026-09-01',
      canViewSpend: false,
    },
  ]),
)[0];

// A fake builder typed as the real one (its snapshot payload is opaque to the coordinator).
const fakeBuild = (impl: () => Promise<unknown>) => (async () => ({
  snapshot: (await impl()) as never,
  state: 'complete' as const,
})) as unknown as typeof buildAdSnapshot;

describe('auto-refresh coordinator', () => {
  it('shares ONE provider read across concurrent callers for the same scope+window', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const build = vi.fn(fakeBuild(async () => {
      calls++;
      await gate;
      return {};
    }));
    const writes: string[] = [];
    const write = (_dir: string, file: string) => {
      writes.push(file);
    };
    const deps = { env: {}, dir: '/tmp/x', fileName: 'a__clip-3__w1.json', binding, build, write };

    const p1 = acquireAutoSnapshot(deps);
    const p2 = acquireAutoSnapshot(deps);
    release();
    const [o1, o2] = await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect([o1, o2]).toEqual(['refreshed', 'refreshed']);
    expect(writes).toEqual(['a__clip-3__w1.json']); // written exactly once

    // A different window is a different scope → its own provider read.
    await acquireAutoSnapshot({ ...deps, fileName: 'a__clip-3__w2.json' });
    expect(calls).toBe(2);
  });

  it('a client timeout does not cancel the shared server acquisition or its cache write', async () => {
    const clientDeadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(clientDeadline.signal);
    let serverSignal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const build = vi.fn<typeof buildAdSnapshot>(async (_binding, deps) => {
      serverSignal = deps.signal;
      await gate;
      return { snapshot: {} as never, state: 'complete' };
    });
    const write = vi.fn();
    const deps = {
      env: {},
      dir: '.agent-work/runtime/test-only',
      fileName: 'client-timeout.json',
      binding,
      build,
      write,
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          // Emulate a caller disconnecting from a real shared server acquisition. Its request signal
          // cancels only its response waiter; the server keeps its own bounded deadline.
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
          void acquireAutoSnapshot(deps).then(() => resolve(Response.json({ performance: null })));
        }),
    );
    try {
      const client = loadAdPerformance(
        { identity: 'a', clipId: 'clip-3', from: '2026-07-01', toExclusive: '2026-09-01' },
        new AbortController().signal,
      );
      const joined = acquireAutoSnapshot(deps);
      clientDeadline.abort();
      expect(await client).toBeNull();
      expect(serverSignal?.aborted).toBe(false);
      expect(write).not.toHaveBeenCalled();
      release();
      expect(await joined).toBe('refreshed');
      expect(build).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      release();
      globalThis.fetch = originalFetch;
      timeout.mockRestore();
    }
  });

  it('returns unavailable and writes nothing on a provider failure', async () => {
    const build = fakeBuild(async () => {
      throw new Error('boom');
    });
    const write = vi.fn();
    const outcome = await acquireAutoSnapshot({
      env: {},
      dir: '/tmp',
      fileName: 'a__clip-3__f.json',
      binding,
      build,
      write,
    });
    expect(outcome).toBe('unavailable');
    expect(write).not.toHaveBeenCalled();
  });

  it('returns unavailable after the deadline when the provider NEVER resolves (flight cleans up)', async () => {
    // A build that ignores the abort signal AND never resolves must not hold the single-flight open
    // past the deadline: the real wall-clock race settles `unavailable`.
    let calls = 0;
    const hung = fakeBuild(() => {
      calls++;
      return new Promise<unknown>(() => {}); // never resolves, never rejects
    });
    const write = vi.fn();
    const deps = {
      env: {},
      dir: '/tmp',
      fileName: 'a__clip-3__hung.json',
      binding,
      build: hung,
      write,
      deadlineMs: 20,
    };
    const outcome = await acquireAutoSnapshot(deps);
    expect(outcome).toBe('unavailable');
    expect(write).not.toHaveBeenCalled();

    // The flight was removed from the in-flight map (not left pending forever): a fresh acquisition for
    // the SAME scope+window starts a brand new provider read and can succeed.
    const good = vi.fn(fakeBuild(async () => ({})));
    const second = await acquireAutoSnapshot({ ...deps, build: good });
    expect(second).toBe('refreshed');
    expect(calls).toBe(1); // the hung build ran once
    expect(good).toHaveBeenCalledTimes(1); // a NEW read, proving the prior flight was cleared
  });

  it('drops a build that SUCCEEDS after the deadline — never writes a stale cache', async () => {
    // Gate a build so it resolves only after we release it, which we do AFTER the deadline has fired.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const build = fakeBuild(async () => {
      await gate;
      return {};
    });
    const write = vi.fn();
    const outcome = await acquireAutoSnapshot({
      env: {},
      dir: '/tmp',
      fileName: 'a__clip-3__late.json',
      binding,
      build,
      write,
      deadlineMs: 10,
    });
    expect(outcome).toBe('unavailable');
    expect(write).not.toHaveBeenCalled();

    // Now let the build finish LATE. The pre-writer deadline check must drop it: still no write.
    release();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(write).not.toHaveBeenCalled();
  });

  it('aborts within the bounded deadline and reports unavailable', async () => {
    const build = ((_b: unknown, deps: { signal?: AbortSignal }) =>
      new Promise((_res, rej) => {
        deps.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      })) as unknown as typeof buildAdSnapshot;
    const write = vi.fn();
    const outcome = await acquireAutoSnapshot({
      env: {},
      dir: '/tmp',
      fileName: 'a__clip-3__d.json',
      binding,
      build,
      write,
      deadlineMs: 10,
    });
    expect(outcome).toBe('unavailable');
    expect(write).not.toHaveBeenCalled();
  });

  // Real builder paths (exercise the sanitized reader end-to-end without network).
  const account = { id: 'act_123', account_id: '123', currency: 'THB', timezone_name: 'Asia/Bangkok' };
  const ad = {
    id: '52513673563767',
    account_id: '123',
    name: 'Tendrix',
    effective_status: 'ACTIVE',
    creative: {
      id: '1004085732033027',
      object_story_spec: { video_data: { video_id: '2629443027486387' } },
    },
  };
  const row = {
    ad_id: '52513673563767',
    account_id: '123',
    account_currency: 'THB',
    date_start: '2026-07-01',
    date_stop: '2026-08-31',
    spend: '18260.17',
    cpc: '2.35',
    ctr: '1.53',
    cpm: '85.20',
    purchase_roas: [{ action_type: 'omni_purchase', value: '3.760042' }],
  };
  const now = () => Date.parse('2026-09-02T00:00:00Z');
  const fetcher: typeof fetch = vi.fn(async (input) => {
    const url = new URL(String(input));
    return Response.json(
      url.pathname.endsWith('/act_123')
        ? account
        : url.pathname.endsWith('/insights')
          ? { data: [row] }
          : ad,
    );
  });
  const realEnv = (withToken = true) => ({
    LABSD_FACEBOOK_READ_ENABLED: '1',
    LABSD_FACEBOOK_PROFILES: JSON.stringify([
      {
        id: 'fb-primary',
        namespace: 'meta',
        accountId: '123',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
        acquisitionOwner: 'portal-direct',
        tokenEnv: 'LABSD_FB_PRIMARY_TOKEN',
      },
    ]),
    LABSD_AD_SNAPSHOT_ENABLED: '1',
    ...(withToken ? { LABSD_FB_PRIMARY_TOKEN: 'synthetic-token' } : {}),
  });

  it('acquires a validated snapshot via the real reader and never writes a token', async () => {
    const writes: { file: string; contents: string }[] = [];
    const outcome = await acquireAutoSnapshot({
      env: realEnv(),
      dir: '/tmp',
      fileName: 'a__clip-3__2026-07-01__2026-09-01.json',
      binding,
      fetch: fetcher,
      now,
      write: (_dir, file, contents) => writes.push({ file, contents }),
    });
    expect(outcome).toBe('refreshed');
    expect(writes).toHaveLength(1);
    expect(writes[0].contents).not.toContain('synthetic-token');
    const snap = AdPerformanceSnapshot.parse(JSON.parse(writes[0].contents));
    for (const forbidden of ['impressions', 'reach', 'video_views'])
      expect(snap.report.metrics.some((m) => m.key === forbidden)).toBe(false);
  });

  it('reports unavailable (never a fabricated zero) when the injected credential is absent', async () => {
    const write = vi.fn();
    const outcome = await acquireAutoSnapshot({
      env: realEnv(false),
      dir: '/tmp',
      fileName: 'a__clip-3__2026-07-01__2026-09-01__nocred.json',
      binding,
      fetch: fetcher,
      now,
      write,
    });
    expect(outcome).toBe('unavailable');
    expect(write).not.toHaveBeenCalled();
  });
});
