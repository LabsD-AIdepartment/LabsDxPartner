import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthResponse, readyResponse } from '@/server/http/health';
import { createReadinessProbe } from '@/server/platform/health/readiness';

const request = (method = 'GET') => new Request('https://example.test/api/ready', { method });
afterEach(() => vi.useRealTimers());

describe('web operational responses', () => {
  it('reports process liveness without dependencies, no-store and empty HEAD bodies', async () => {
    const response = healthResponse(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await healthResponse(request('HEAD')).text()).toBe('');
  });

  it('allows a closed deployment without constructing identity but refuses dependent features', async () => {
    const runtime = vi.fn(() => {
      throw new Error('secret configuration');
    });
    expect((await readyResponse(request(), runtime, {})).status).toBe(200);
    for (const flag of [
      'LABSD_FINANCE_ENABLED',
      'LABSD_MARKETING_ENABLED',
      'LABSD_TIKTOK_VIDEO_ENABLED',
      'LABSD_ACCOUNT_PROFILE_ENABLED',
    ]) {
      expect((await readyResponse(request(), runtime, { [flag]: '1' })).status).toBe(503);
    }
    expect(runtime).not.toHaveBeenCalled();
  });

  it('checks enabled identity, preserves HEAD status, and never projects errors', async () => {
    const env = { LABSD_IDENTITY_ENABLED: '1' };
    const ready = vi.fn(async () => true);
    expect(await (await readyResponse(request(), () => ({ ready }), env)).json()).toEqual({
      status: 'ready',
    });
    const failure = await readyResponse(request('HEAD'), () => ({ ready: async () => false }), env);
    expect(failure.status).toBe(503);
    expect(await failure.text()).toBe('');
    expect((await readyResponse(request(), () => null, env)).status).toBe(503);
    const thrown = await readyResponse(
      request(),
      () => {
        throw Error('postgresql://secret');
      },
      env,
    );
    expect(await thrown.json()).toEqual({ status: 'unavailable' });
    expect(thrown.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects mutation methods before checking a dependency', async () => {
    const runtime = vi.fn();
    const response = await readyResponse(request('POST'), runtime, { LABSD_IDENTITY_ENABLED: '1' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(runtime).not.toHaveBeenCalled();
    expect(healthResponse(request('POST')).status).toBe(405);
  });
});

describe('bounded readiness work', () => {
  it('coalesces concurrent checks and briefly caches settled outcomes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let finish!: () => void;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const probe = createReadinessProbe(check);
    const first = probe();
    expect(probe()).toBe(first);
    await Promise.resolve();
    finish();
    expect(await first).toBe(true);
    expect(await probe()).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    const next = probe();
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(2);
    finish();
    expect(await next).toBe(true);
  });

  it('times out queued work without accumulating replacements and rejects late success', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let finish!: () => void;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const probe = createReadinessProbe(check);
    const first = probe();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first).toBe(false);
    for (let i = 0; i < 50; i++) expect(await probe()).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await probe()).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(await probe()).toBe(false);
    await vi.advanceTimersByTimeAsync(1001);
    const recovered = probe();
    await Promise.resolve();
    finish();
    expect(await recovered).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('converts synchronous and asynchronous failures into retryable unavailability', async () => {
    const sync = createReadinessProbe(() => {
      throw Error('private');
    });
    const asyncFailure = createReadinessProbe(async () => {
      throw Error('private');
    });
    expect(await sync()).toBe(false);
    expect(await asyncFailure()).toBe(false);
  });
});
