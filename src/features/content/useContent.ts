'use client';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { partnerKey } from '@/shared/query/keys';
import { changeMeta } from '@/shared/query/invalidate-changes';
import { validContentFilters } from '@/shared/routing/report-context';
import {
  loadContent,
  ContentError,
  resourceKey,
  type Resource,
  type ContentRequest,
  type ContentTransport,
} from './model';
export function useContent<K extends Resource>(
  transport: ContentTransport,
  request: Omit<ContentRequest, 'signal' | 'resource'> & { resource: K },
) {
  return useQuery({
    meta:
      request.resource === 'ads' || request.resource === 'ad'
        ? changeMeta('metrics')
        : request.resource === 'detail'
          ? changeMeta('earnings', 'metrics')
          : changeMeta('earnings'),
    queryKey: partnerKey(
      request.scope,
      request.resource === 'ads' || request.resource === 'ad' ? 'metrics' : 'earnings',
      'content',
      resourceKey(
        request.resource,
        request.context,
        request.contentId,
        request.adId,
        request.cursor,
      ),
      request.context.generation,
    ),
    queryFn: ({ signal }) => loadContent(transport, { ...request, signal }),
    enabled: validContentFilters(request.context),
    retry: false,
  });
}

type Continuation = {
  cursor: string | null;
  generation: string | null;
  ids: string[];
  cursors: string[];
};
/** Source batches append to one library; pagination is never a user navigation step. */
export function useContentLibrary(
  transport: ContentTransport,
  request: Omit<ContentRequest, 'signal' | 'resource'>,
) {
  const context = { ...request.context, cursor: null, history: [] };
  return useInfiniteQuery({
    meta: changeMeta('earnings', 'metrics'),
    queryKey: partnerKey(
      request.scope,
      'earnings',
      'content-library',
      resourceKey('list', context),
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
        throw new ContentError('invalid_response', 'ต้นทางส่งหน้ารายการซ้ำ กรุณาโหลดคลังคลิปใหม่');
      const result = await loadContent(transport, {
        ...request,
        context: { ...context, generation: pageParam.generation },
        resource: 'list',
        cursor: pageParam.cursor,
        signal,
      });
      if (result.data.items.some((x) => pageParam.ids.includes(x.id)))
        throw new ContentError(
          'invalid_response',
          'ต้นทางส่งคลิปซ้ำระหว่างชุดข้อมูล กรุณาโหลดคลังคลิปใหม่',
        );
      return result;
    },
    getNextPageParam: (last, pages, lastParam) =>
      last.data.nextCursor && last.dataState !== 'unavailable'
        ? {
            cursor: last.data.nextCursor,
            generation: pages[0].generation,
            ids: pages.flatMap((p) => p.data.items.map((x) => x.id)),
            cursors: [...lastParam.cursors, ...(lastParam.cursor ? [lastParam.cursor] : [])],
          }
        : undefined,
    enabled: validContentFilters(context),
    retry: false,
  });
}
