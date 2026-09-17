import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { contentFixture } from '../../dev/content-transport';
import {
  loadContent,
  ContentError,
  type ContentRequest,
  type ContentResponse,
  type ContentTransport,
} from '@/features/content/model';
import { useContentEarnings } from '@/features/content/useContentEarnings';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { initialReportContext as context } from '@/shared/routing/report-context';

const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <ScopedQueryProvider scope={scope}>{children}</ScopedQueryProvider>
);
const request = (extra: Partial<Omit<ContentRequest, 'resource'>> = {}): ContentRequest => ({
  resource: 'earnings',
  scope,
  context,
  contentId: 'clip-1',
  signal: new AbortController().signal,
  ...extra,
});

// A real, contract-valid earnings envelope for clip-1 that we can re-shape into synthetic pages.
// Cloning a real line and only changing its id keeps contentId/attribution/earnedAt window valid so
// loadContent accepts it; overriding contentId lets us simulate a foreign-scope leak.
async function template() {
  const base = (await loadContent(
    async (r) => contentFixture(r),
    request(),
  )) as ContentResponse<'earnings'>;
  const seed = base.data.items[0];
  const line = (id: string, patch: Partial<typeof seed> = {}) => ({ ...seed, id, ...patch });
  const page = (
    items: (typeof seed)[],
    nextCursor: string | null,
    generation: string = base.generation,
  ): ContentResponse<'earnings'> => ({
    ...base,
    generation,
    data: { ...base.data, items, nextCursor },
  });
  return { base, line, page };
}

const render = (send: ContentTransport, extra: Partial<Omit<ContentRequest, 'resource'>> = {}) =>
  renderHook(
    () => {
      const query = useContentEarnings(send, { scope, contentId: 'clip-1', context, ...extra });
      // Observe these properties during render: isSuccess alone does not change after a successful
      // append, so TanStack's tracked-property observer would correctly skip that rerender.
      return {
        data: query.data,
        error: query.error,
        hasNextPage: query.hasNextPage,
        isSuccess: query.isSuccess,
        fetchNextPage: query.fetchNextPage,
      };
    },
    { wrapper },
  );

describe('useContentEarnings', () => {
  it('appends earnings pages automatically without native pagination (UI drives fetchNextPage)', async () => {
    const { line, page } = await template();
    const send = vi.fn(async (r: ContentRequest) =>
      r.cursor
        ? page([line('e-3'), line('e-4')], null)
        : page([line('e-1'), line('e-2')], 'offset-2'),
    );
    const { result } = render(send);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.pages).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(true);
    expect(send.mock.calls[0][0].cursor).toBeNull();

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data!.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    // The follow-up batch is fetched with the cursor the first page issued — not a user page jump.
    expect(send.mock.calls[1][0]).toMatchObject({ cursor: 'offset-2' });
    const ids = result.current.data!.pages.flatMap((p) => p.data.items.map((x) => x.id));
    expect(ids).toEqual(['e-1', 'e-2', 'e-3', 'e-4']);
  });

  it('pins the first page generation and stops (keeping prior pages) if a later batch drifts', async () => {
    const { line, page } = await template();
    const send = vi.fn(async (r: ContentRequest) =>
      r.cursor
        ? page([line('e-3')], null, '2') // a newer generation must not be stitched in
        : page([line('e-1')], 'offset-2', '1'),
    );
    const { result } = render(send, { context: { ...context, generation: '1' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ContentError));
    expect((result.current.error as ContentError).code).toBe('generation_changed');
    // Prior page is preserved; the second request still carried the pinned generation.
    expect(result.current.data!.pages).toHaveLength(1);
    expect(send.mock.calls[1][0].context.generation).toBe('1');
  });

  it('rejects a foreign-clip line leaking into a later page without dropping earlier pages', async () => {
    const { line, page } = await template();
    const send = vi.fn(async (r: ContentRequest) =>
      r.cursor
        ? page([line('e-3', { contentId: 'clip-2' })], null)
        : page([line('e-1')], 'offset-2'),
    );
    const { result } = render(send);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ContentError));
    expect((result.current.error as ContentError).code).toBe('invalid_response');
    expect(result.current.data!.pages).toHaveLength(1);
  });

  it('stops a repeated id across pages instead of double-counting earnings', async () => {
    const { line, page } = await template();
    const send = vi.fn(async (r: ContentRequest) =>
      r.cursor ? page([line('e-1')], null) : page([line('e-1')], 'offset-2'),
    );
    const { result } = render(send);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ContentError));
    expect(result.current.error!.message).toContain('ต้นทางส่งรายการรายได้ซ้ำระหว่างชุดข้อมูล');
    expect(result.current.data!.pages).toHaveLength(1);
  });

  it('breaks a self-cursor loop (a page re-issuing the very cursor it was fetched with) while keeping the pages already loaded', async () => {
    const { line, page } = await template();
    // Deterministic, cursor-keyed responses (NOT a blind per-call counter): page 1 hands out cursor
    // 'c2', and the page fetched WITH 'c2' re-issues 'c2' — its own cursor. Keying the reply off the
    // request cursor makes every (re)fetch idempotent, so an incidental TanStack refetch cannot
    // reshuffle ids and trip the prior-page id guard early; the ONLY thing that can stop the walk is
    // the repeated-cursor guard, which fires the moment 'c2' would be re-used for a third page.
    const send = vi.fn(async (r: ContentRequest) =>
      r.cursor === 'c2' ? page([line('e-2')], 'c2') : page([line('e-1')], 'c2'),
    );
    const { result } = render(send);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage(); // page 2 is fetched with cursor 'c2' and re-issues 'c2'
    });
    await waitFor(() => expect(result.current.data!.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(true); // source still advertises a "next" (the loop)

    // The guard lives in queryFn and throws BEFORE calling the transport, so it neither hits the
    // source a third time nor mutates the two cached pages. Capture the call count first so the
    // assertion is robust to any incidental all-pages refetch that happened earlier.
    const callsBeforeGuard = send.mock.calls.length;
    await act(async () => {
      await result.current.fetchNextPage(); // cursor 'c2' already used → guarded
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ContentError));
    expect((result.current.error as ContentError).code).toBe('invalid_response');
    expect(result.current.error!.message).toContain('ต้นทางส่งหน้ารายการรายได้ซ้ำ');
    expect(send.mock.calls.length).toBe(callsBeforeGuard); // guarded before re-hitting the source
    expect(result.current.data!.pages).toHaveLength(2);
  });

  it('breaks a genuine multi-step A→B→A cursor cycle without dropping the pages walked so far', async () => {
    const { line, page } = await template();
    // A real cycle, not a self-cursor: the walk advances through three distinct cursors and only the
    // THIRD page points back to an earlier one ('A'). Distinct ids per page mean the id guard never
    // fires, so reaching the stop proves the cursor-history guard remembers earlier cursors — not just
    // the immediately preceding one.
    const send = vi.fn(async (r: ContentRequest) => {
      if (r.cursor === 'A') return page([line('e-2')], 'B');
      if (r.cursor === 'B') return page([line('e-3')], 'A'); // loops back to an already-used cursor
      return page([line('e-1')], 'A');
    });
    const { result } = render(send);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage(); // null → A: page 2 (cursor 'A')
    });
    await waitFor(() => expect(result.current.data!.pages).toHaveLength(2));
    await act(async () => {
      await result.current.fetchNextPage(); // A → B: page 3 (cursor 'B')
    });
    await waitFor(() => expect(result.current.data!.pages).toHaveLength(3));

    const callsBeforeGuard = send.mock.calls.length;
    await act(async () => {
      await result.current.fetchNextPage(); // B → A: 'A' seen back on page 2 → guarded
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ContentError));
    // The repeated-cursor guard (not the id guard) is what stops the cycle.
    expect(result.current.error!.message).toContain('ต้นทางส่งหน้ารายการรายได้ซ้ำ');
    expect(send.mock.calls.length).toBe(callsBeforeGuard);
    expect(result.current.data!.pages).toHaveLength(3);
    const ids = result.current.data!.pages.flatMap((p) => p.data.items.map((x) => x.id));
    expect(ids).toEqual(['e-1', 'e-2', 'e-3']);
  });

  it('keys the collection by clip + filter scope + generation so a new clip starts fresh', async () => {
    const { line, page } = await template();
    // Type the mock's parameter so `send.mock.calls[n][0]` is a ContentRequest, not an index into an
    // inferred empty-tuple `[]` (which fails typecheck at the mock-call assertions below).
    const send = vi.fn(async (_r: ContentRequest) => page([line('e-1')], null));
    const view = render(send, { contentId: 'clip-1' });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].contentId).toBe('clip-1');

    // Switching the clip is a different cache entry: a brand new first page, cursor reset to null.
    view.rerender();
    const view2 = renderHook(
      () => useContentEarnings(send, { scope, contentId: 'clip-2', context }),
      { wrapper },
    );
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0]).toMatchObject({ contentId: 'clip-2', cursor: null });
    view2.unmount();
  });
});
