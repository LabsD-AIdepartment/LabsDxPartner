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

/** Same scoped collection pattern as the content library; source validation remains in loadContent. */
export function useContentAds(
  transport: ContentTransport,
  request: Omit<ContentRequest, 'signal' | 'resource'> & { contentId: string },
) {
  request = normalizeContentRequest(request);
  const context = { ...request.context, cursor: null, history: [] };
  return useInfiniteQuery({
    meta: changeMeta('metrics'),
    queryKey: partnerKey(
      request.scope,
      'metrics',
      'content-ads',
      resourceKey('ads', context, request.contentId),
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
        throw new ContentError('invalid_response', 'ต้นทางส่งหน้าโฆษณาซ้ำ กรุณาโหลดรายการใหม่');
      const result = await loadContent(transport, {
        ...request,
        context: { ...context, generation: pageParam.generation },
        resource: 'ads',
        cursor: pageParam.cursor,
        signal,
      });
      if (result.data.items.some((ad) => pageParam.ids.includes(ad.id)))
        throw new ContentError(
          'invalid_response',
          'ต้นทางส่งโฆษณาซ้ำระหว่างชุดข้อมูล กรุณาโหลดรายการใหม่',
        );
      return result;
    },
    getNextPageParam: (last, pages, lastParam) =>
      last.data.nextCursor && last.dataState !== 'unavailable'
        ? {
            cursor: last.data.nextCursor,
            generation: pages[0].generation,
            ids: pages.flatMap((page) => page.data.items.map((ad) => ad.id)),
            cursors: [...lastParam.cursors, ...(lastParam.cursor ? [lastParam.cursor] : [])],
          }
        : undefined,
    enabled: validContentFilters(context),
    retry: false,
    refetchInterval: 60_000,
  });
}
