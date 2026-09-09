import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadChanges } from '@/shared/query/changes-http';
import { AccessLost } from '@/shared/query/revision-watcher';
afterEach(() => vi.unstubAllGlobals());
describe('native change metadata transport', () => {
  const scope = { userId: 'private-user', partnerId: 'partner&one', permissionRevision: 'p1:m2' };
  it('sends only scoped metadata inputs and preserves the abort signal without shared caching', async () => {
    const signal = new AbortController().signal;
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ partnerId: scope.partnerId }) });
    vi.stubGlobal('fetch', fetcher);
    await expect(loadChanges(scope, 'view_statements', signal)).resolves.toEqual({
      partnerId: scope.partnerId,
    });
    const [path, options] = fetcher.mock.calls[0];
    const url = new URL(path, 'https://local.invalid');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      partnerId: scope.partnerId,
      permissionRevision: 'p1:m2',
      capability: 'view_statements',
    });
    expect(path).not.toContain(scope.userId);
    expect(options).toEqual({ cache: 'no-store', credentials: 'same-origin', signal });
  });
  it.each([401, 403])('clears access on %s instead of retrying old data', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(
      loadChanges(scope, 'view_statements', new AbortController().signal),
    ).rejects.toBeInstanceOf(AccessLost);
  });
  it('lets temporary service errors back off without claiming revoked access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(
      loadChanges(scope, 'view_statements', new AbortController().signal),
    ).rejects.not.toBeInstanceOf(AccessLost);
  });
});
