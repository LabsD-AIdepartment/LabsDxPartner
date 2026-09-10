// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createTikTokQuota } from '@/server/modules/marketing-ads/tiktok-shop/quota';
const signal = () => new AbortController().signal;
describe('source-owned TikTok quota boundary', () => {
  it('shares app scope while separating shops and never sends credentials as Redis key material', async () => {
    const evalPort = vi.fn().mockResolvedValue([1, 0]);
    const a = createTikTokQuota({ appPerSecond: 5, shopPerSecond: 2, eval: evalPort });
    const b = createTikTokQuota({ appPerSecond: 5, shopPerSecond: 2, eval: evalPort });
    await a.reserve({ appKey: 'synthetic-app', shopCipher: 'synthetic-shop-a' }, signal());
    await b.reserve({ appKey: 'synthetic-app', shopCipher: 'synthetic-shop-b' }, signal());
    expect(evalPort.mock.calls[0][2]).toBe(evalPort.mock.calls[1][2]);
    expect(evalPort.mock.calls[0][3]).not.toBe(evalPort.mock.calls[1][3]);
    expect(JSON.stringify(evalPort.mock.calls)).not.toContain('synthetic-');
  });
  it.each([null, [1, 9], [0, -1], [0, 0], [1], [true, 0], ['1', 0]])(
    'rejects malformed Redis result %j',
    async (value) => {
      const q = createTikTokQuota({ appPerSecond: 5, shopPerSecond: 2, eval: async () => value });
      await expect(q.reserve({ appKey: 'test' }, signal())).rejects.toMatchObject({
        code: 'temporary',
      });
    },
  );
  it('preserves cooldown and hides raw governor errors', async () => {
    const evalPort = vi
      .fn()
      .mockResolvedValueOnce([0, 86400000])
      .mockRejectedValueOnce(new Error('synthetic-sensitive-redis-url'));
    const q = createTikTokQuota({ appPerSecond: 5, shopPerSecond: 2, eval: evalPort });
    expect(await q.reserve({ appKey: 'test' }, signal())).toEqual({
      allowed: false,
      retryAfterMs: 86400000,
    });
    await expect(q.reserve({ appKey: 'test' }, signal())).rejects.toThrow('Source read: temporary');
  });
  it('rejects invalid identity and policies before reserving', async () => {
    const evalPort = vi.fn();
    expect(() =>
      createTikTokQuota({ appPerSecond: 1, shopPerSecond: 2, eval: evalPort }),
    ).toThrow();
    const q = createTikTokQuota({ appPerSecond: 2, shopPerSecond: 1, eval: evalPort });
    await expect(q.reserve({ appKey: '' }, signal())).rejects.toMatchObject({ code: 'access' });
    expect(evalPort).not.toHaveBeenCalled();
  });
  it('cancels a hanging reservation without a fail-open fallback', async () => {
    const c = new AbortController();
    const q = createTikTokQuota({
      appPerSecond: 2,
      shopPerSecond: 1,
      eval: () => new Promise(() => {}),
    });
    const work = q.reserve({ appKey: 'test' }, c.signal);
    c.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  });
});
