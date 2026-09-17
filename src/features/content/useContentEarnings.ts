'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { partnerKey } from '@/shared/query/keys';
import { changeMeta } from '@/shared/query/invalidate-changes';
import { validContentFilters } from '@/shared/routing/report-context';
import {
  loadContent,
  normalizeContentRequest,
  ContentError,
  resourceKey,
  type ContentRequest,
  type ContentTransport,
} from './model';

type Continuation = {
  cursor: string | null;
  generation: string | null;
  ids: string[];
  cursors: string[];
};

/**
 * Scoped earnings-line collection for a single clip, mirroring {@link useContentAds} and
 * `useContentLibrary`. The earnings breakdown is one continuous list, not a user-navigated page:
 * the consuming UI simply keeps calling `fetchNextPage` until `hasNextPage` is false, so there is
 * NO native pagination UI here — the hook returns the plain `useInfiniteQuery` result.
 *
 * Source validation (generation pin, period match, per-line contentId/attribution/earnedAt window
 * and intra-page duplicate ids) stays in {@link loadContent}. On top of that this hook guards the
 * pagination walk itself: a repeated cursor or an id already seen on a PRIOR page stops the walk
 * with an error instead of looping forever or double-counting — and, because the error is thrown
 * from `queryFn`/`getNextPageParam` and never mutates cached pages, previously loaded pages are
 * preserved for the UI to keep showing. The query key includes the clip and the whole filter scope
 * (period/brand/search) plus the pinned generation so a filter or generation change starts fresh.
 */
export function useContentEarnings(
  transport: ContentTransport,
  request: Omit<ContentRequest, 'signal' | 'resource'> & { contentId: string },
) {
  request = normalizeContentRequest(request);
  // A cursor belongs to a page walk, not to the collection identity: drop any inbound cursor/history
  // so the key and the first page are pinned to the filter scope + generation only.
  const context = { ...request.context, cursor: null, history: [] };
  return useInfiniteQuery({
    meta: changeMeta('earnings'),
    queryKey: partnerKey(
      request.scope,
      'earnings',
      'content-earnings',
      resourceKey('earnings', context, request.contentId),
      context.generation,
    ),
    initialPageParam: {
      cursor: null,
      generation: context.generation,
      ids: [],
      cursors: [],
    } as Continuation,
    queryFn: async ({ signal, pageParam }) => {
      if (pageParam.cursor && pageParam.cursors.includes(pageParam.cursor))
        throw new ContentError(
          'invalid_response',
          'ต้นทางส่งหน้ารายการรายได้ซ้ำ กรุณาโหลดรายการใหม่',
        );
      const result = await loadContent(transport, {
        ...request,
        context: { ...context, generation: pageParam.generation },
        resource: 'earnings',
        cursor: pageParam.cursor,
        signal,
      });
      if (result.data.items.some((line) => pageParam.ids.includes(line.id)))
        throw new ContentError(
          'invalid_response',
          'ต้นทางส่งรายการรายได้ซ้ำระหว่างชุดข้อมูล กรุณาโหลดรายการใหม่',
        );
      return result;
    },
    getNextPageParam: (last, pages, lastParam) =>
      last.data.nextCursor && last.dataState !== 'unavailable'
        ? {
            cursor: last.data.nextCursor,
            generation: pages[0].generation,
            ids: pages.flatMap((page) => page.data.items.map((line) => line.id)),
            cursors: [...lastParam.cursors, ...(lastParam.cursor ? [lastParam.cursor] : [])],
          }
        : undefined,
    enabled: validContentFilters(context),
    retry: false,
  });
}
