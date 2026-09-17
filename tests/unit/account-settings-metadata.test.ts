import { describe, expect, it } from 'vitest';
import { createScopedAccountTransport } from '../../dev/account-settings-account-transport';
import { loadAccount, actOnAccount } from '@/features/account/model';
const scope = { userId: 'u-a', partnerId: 'p-a', permissionRevision: 'g1' };
const metadata = {
  userId: scope.userId,
  displayName: 'Partner A',
  username: 'partner.a',
  agreement: null,
  supportUrl: null,
  termsSummary: null,
};
const signal = () => new AbortController().signal;
const build = () =>
  createScopedAccountTransport({ scope, metadata, latencyMs: 0, dataThrough: null });
describe('scoped preview account metadata adapter', () => {
  it('passes the existing Account loader and preserves unknown agreement, support and cutoff', async () => {
    const value = await loadAccount(build(), scope, signal());
    expect(value.data).toEqual(metadata);
    expect(value.dataThrough).toBeNull();
    expect(value.partnerId).toBe(scope.partnerId);
  });
  it.each(['userId', 'partnerId', 'permissionRevision'] as const)(
    'rejects another %s at the adapter boundary',
    async (field) => {
      await expect(
        loadAccount(build(), { ...scope, [field]: 'foreign' }, signal()),
      ).rejects.toThrow();
    },
  );
  it('rejects mis-composed user metadata before responding and guards forged responses in the existing loader', async () => {
    expect(() =>
      createScopedAccountTransport({ scope, metadata: { ...metadata, userId: 'other-user' } }),
    ).toThrow();
    const t = build();
    const valid = await loadAccount(t, scope, signal());
    await expect(
      loadAccount(
        { ...t, read: async () => ({ ...valid, data: { ...valid.data, userId: 'other-user' } }) },
        scope,
        signal(),
      ),
    ).rejects.toThrow(/ไม่ตรง/);
  });
  it('keeps generation compositions isolated and does not expose mutable response references', async () => {
    const a = createScopedAccountTransport({ scope, metadata, namespace: 'g1', latencyMs: 0 });
    const b = createScopedAccountTransport({
      scope,
      metadata: { ...metadata, displayName: 'New generation' },
      namespace: 'g2',
      latencyMs: 0,
    });
    const first = await loadAccount(a, scope, signal());
    first.data.displayName = 'tampered';
    expect((await loadAccount(a, scope, signal())).data.displayName).toBe('Partner A');
    expect((await loadAccount(b, scope, signal())).data.displayName).toBe('New generation');
    expect((await loadAccount(b, scope, signal())).requestId).not.toBe(first.requestId);
  });
  it('honors abort before and during a read and action without issuing a completed result', async () => {
    const t = createScopedAccountTransport({ scope, metadata, latencyMs: 50 });
    const before = new AbortController();
    before.abort();
    await expect(loadAccount(t, scope, before.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const during = new AbortController();
    const pending = loadAccount(t, scope, during.signal);
    during.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      actOnAccount(t, {
        scope,
        expectedRevision: '1',
        idempotencyKey: 'aborted',
        command: { action: 'logout' },
        signal: before.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('labels logout as local simulation and recovery as not yet sent, preserving existing action contract', async () => {
    const t = build();
    const request = {
      scope,
      expectedRevision: '1',
      idempotencyKey: 'logout',
      command: { action: 'logout' as const },
      signal: signal(),
    };
    const result = await actOnAccount(t, request);
    expect(result.message).toMatch(/จำลอง ไม่ได้ออกจากระบบจริง/);
    expect(await actOnAccount(t, request)).toEqual(result);
    const recovery = await actOnAccount(t, {
      ...request,
      idempotencyKey: 'recover',
      command: { action: 'recover' },
    });
    expect(recovery.status).toBe('recovery-required');
    expect(recovery.message).toMatch(/ยังไม่มีการส่งลิงก์หรือเปลี่ยนรหัสผ่าน/);
  });
});
