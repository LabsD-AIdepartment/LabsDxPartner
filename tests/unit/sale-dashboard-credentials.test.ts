// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createSaleDashboardVideoCredentialResolver } from '@/server/modules/marketing-ads/tiktok-shop/sale-dashboard-credentials';

const profile = {
  connectionId: 'video-1',
  namespace: 'labsd',
  shopId: 'shop-1',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
  acquisitionOwner: 'sale-dashboard' as const,
  sourceConnectionRef: 'source-1',
};
const binding = { sourceConnectionRef: 'source-1', connectedAccountId: 7, credentialId: 9 };
const now = Date.parse('2026-09-10T00:00:00Z');
const signal = () => new AbortController().signal;
function fixture() {
  const row = {
    shopId: 'shop-1',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    accessTokenEnc: Buffer.from('synthetic-token'),
    appKeyEnc: Buffer.from('synthetic-key'),
    appSecretEnc: Buffer.from('synthetic-secret'),
    shopCipher: 'synthetic-cipher',
    expiresAt: new Date(now + 86400000),
  };
  const query = vi.fn().mockImplementation(async () => ({ rows: [row] }));
  const decryptToken = vi.fn((v: Buffer) => v.toString());
  const ports = { query, decryptToken, now: () => now };
  const resolve = createSaleDashboardVideoCredentialResolver([profile], [binding], ports);
  return { row, ports, query, decryptToken, resolve };
}
describe('Sale Dashboard source credential snapshots', () => {
  it('is lazy, reads the trusted account/credential pair, and rereads after token rotation', async () => {
    const f = fixture();
    expect(f.query).not.toHaveBeenCalled();
    expect(await f.resolve('video-1', signal())).toMatchObject({
      accessToken: 'synthetic-token',
      shopId: 'shop-1',
    });
    expect(f.query.mock.calls[0][0]).toMatchObject({
      values: [7, 9, 'shop-1'],
      query_timeout: 5000,
    });
    f.row.accessTokenEnc = Buffer.from('synthetic-rotated');
    expect((await f.resolve('video-1', signal())).accessToken).toBe('synthetic-rotated');
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it('rejects unknown connections without touching the source database', async () => {
    const f = fixture();
    await expect(f.resolve('other', signal())).rejects.toMatchObject({ code: 'access' });
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each([
    { shopId: 'other' },
    { currency: 'USD' },
    { timezone: 'UTC' },
    { expiresAt: new Date(now) },
    { expiresAt: new Date(now + 20000) },
    { expiresAt: null },
    { appSecretEnc: null },
    { appKeyEnc: Buffer.alloc(0) },
  ])('rejects unsafe identity/expiry/ciphertext before decrypting: %j', async (change) => {
    const f = fixture();
    f.query.mockResolvedValue({ rows: [{ ...f.row, ...change }] });
    await expect(f.resolve('video-1', signal())).rejects.toMatchObject({ code: 'access' });
    expect(f.decryptToken).not.toHaveBeenCalled();
  });
  it('denies revoked/missing and ambiguous accounts without a global-token fallback', async () => {
    const f = fixture();
    for (const rows of [[], [f.row, f.row]]) {
      f.query.mockResolvedValue({ rows });
      await expect(f.resolve('video-1', signal())).rejects.toMatchObject({ code: 'access' });
    }
    expect(f.decryptToken).not.toHaveBeenCalled();
  });
  it('discards source SQL and decryption error details', async () => {
    const f = fixture();
    f.query.mockRejectedValueOnce(new Error('synthetic-sensitive-db-url'));
    await expect(f.resolve('video-1', signal())).rejects.toThrow('Source read: temporary');
    f.decryptToken.mockImplementation(() => {
      throw new Error('synthetic-sensitive-key');
    });
    await expect(f.resolve('video-1', signal())).rejects.toThrow('Source read: access');
  });
  it('cancels pending reads and does not decrypt after cancellation', async () => {
    const f = fixture(),
      controller = new AbortController();
    let finish!: (value: { rows: (typeof f.row)[] }) => void;
    f.query.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const work = f.resolve('video-1', controller.signal);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    finish({ rows: [f.row] });
    await Promise.resolve();
    expect(f.decryptToken).not.toHaveBeenCalled();
  });
  it('rejects inconsistent operator bindings without database access', () => {
    const f = fixture();
    for (const bindings of [
      [],
      [binding, binding],
      [{ ...binding, sourceConnectionRef: 'other' }],
    ]) {
      expect(() =>
        createSaleDashboardVideoCredentialResolver([profile], bindings, f.ports),
      ).toThrow('Invalid source credential bindings');
    }
    expect(f.query).not.toHaveBeenCalled();
  });
});
