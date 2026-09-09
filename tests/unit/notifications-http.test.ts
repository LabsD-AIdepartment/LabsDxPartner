import { afterEach, describe, it, expect, vi } from 'vitest';
import { loadNotifications, markNotificationsSeen } from '@/features/notifications/http';
import { AccessLost } from '@/shared/query/revision-watcher';
const scope = { userId: 'user', partnerId: 'partner', permissionRevision: 'p1:m1' };
const data = { items: [], unseenCount: 0, totalCount: 0, nextCursor: null };
afterEach(() => vi.unstubAllGlobals());
describe('notification HTTP scope validation', () => {
  it('sends only partner/revision/cursor and uses private abortable fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...scope, data }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await loadNotifications(scope, 'older', signal)).toEqual(data);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).not.toContain('userId');
    expect(url).toContain('cursor=older');
    expect(options).toMatchObject({ credentials: 'same-origin', cache: 'no-store', signal });
  });
  it('rejects foreign user/partner/revision and access denial', async () => {
    for (const field of ['userId', 'partnerId', 'permissionRevision']) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json({ ...scope, [field]: 'foreign', data })),
      );
      await expect(
        loadNotifications(scope, null, new AbortController().signal),
      ).rejects.toBeInstanceOf(AccessLost);
    }
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(
        loadNotifications(scope, null, new AbortController().signal),
      ).rejects.toBeInstanceOf(AccessLost);
    }
  });
  it('validates seen acknowledgement and abort after body arrival', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...scope, throughNoticeId: '12' }));
    vi.stubGlobal('fetch', fetcher);
    await markNotificationsSeen(scope, '12', new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      partnerId: 'partner',
      permissionRevision: 'p1:m1',
      throughNoticeId: '12',
    });
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          controller.abort();
          return { ...scope, data };
        },
      }),
    );
    await expect(loadNotifications(scope, null, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
