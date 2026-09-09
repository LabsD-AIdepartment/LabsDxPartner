import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentHttp } from '@/features/content/http';
import { loadContent, type ContentRequest } from '@/features/content/model';
import { AccessLost } from '@/shared/query/revision-watcher';
import { initialReportContext } from '@/shared/routing/report-context';
import { contentFixture } from '../../dev/content-transport';
const request: ContentRequest & { resource: 'detail' } = {
  resource: 'detail',
  scope: { userId: 'user', partnerId: 'partner', permissionRevision: 'p1:m1' },
  context: initialReportContext,
  contentId: 'clip-3',
  signal: new AbortController().signal,
};
const payload = () => ({
  partnerId: 'partner',
  permissionRevision: 'p1:m1',
  resource: 'detail',
  brand: null,
  q: '',
  contentId: 'clip-3',
  adId: null,
  earningsRevision: '1',
  catalogueRevision: '1',
  result: contentFixture(request, 'ready'),
});
afterEach(() => vi.unstubAllGlobals());
describe('native content transport envelope', () => {
  it('sends only the selected scope and report context through the private endpoint', async () => {
    const fetch = vi.fn(async () => Response.json(payload()));
    vi.stubGlobal('fetch', fetch);
    const response = await loadContent(contentHttp, request);
    expect(response.data.content.id).toBe('clip-3');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url, 'https://example.test').searchParams.get('userId')).toBeNull();
    expect(url).toContain('contentId=clip-3');
    expect(init).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      signal: request.signal,
    });
  });
  it.each([{ partnerId: 'foreign' }, { permissionRevision: 'old' }])(
    'rejects a foreign membership envelope %j',
    async (patch) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ ...payload(), ...patch })),
      );
      await expect(contentHttp(request)).rejects.toBeInstanceOf(AccessLost);
    },
  );
  it.each([{ brand: 'Other' }, { q: 'other search' }, { contentId: 'clip-2' }])(
    'rejects a mismatched report envelope %j',
    async (patch) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ ...payload(), ...patch })),
      );
      await expect(contentHttp(request)).rejects.toMatchObject({ code: 'invalid_response' });
    },
  );
  it('rejects a late aborted response and maps expired access and generations', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        return Response.json(payload());
      }),
    );
    await expect(contentHttp({ ...request, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    for (const status of [401, 403]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status })),
      );
      await expect(contentHttp(request)).rejects.toBeInstanceOf(AccessLost);
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 409 })),
    );
    await expect(contentHttp(request)).rejects.toMatchObject({ code: 'generation_changed' });
  });
});
