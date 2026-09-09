'use client';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useIsFetching } from '@tanstack/react-query';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { partnerKey, type QueryScope } from '@/shared/query/keys';
import { AccessLost } from '@/shared/query/revision-watcher';
import { loadNotifications, markNotificationsSeen } from './http';
export function NotificationCenter({
  scope,
  onAccessLost,
}: {
  scope: QueryScope;
  onAccessLost: () => void;
}) {
  const critical = useIsFetching({ predicate: (q) => q.queryKey[4] !== 'notices' });
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    if (critical === 0) {
      const timer = setTimeout(() => setEnabled(true), 0);
      return () => clearTimeout(timer);
    }
  }, [critical]);
  useEffect(() => () => operation.current?.abort(), []);
  const query = useInfiniteQuery({
    queryKey: partnerKey(scope, 'notices', 'notifications'),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => loadNotifications(scope, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  useEffect(() => {
    if (query.error instanceof AccessLost) onAccessLost();
  }, [query.error, onAccessLost]);
  async function seen(id: string) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(false);
    try {
      await markNotificationsSeen(scope, id, controller.signal);
      if (!controller.signal.aborted) await query.refetch();
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (reason instanceof AccessLost) onAccessLost();
        else setError(true);
      }
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setPending(false);
      }
    }
  }
  const first = query.data?.pages[0];
  const data =
    first && !query.isError
      ? {
          ...first,
          items: query.data!.pages.flatMap((p) => p.items),
          nextCursor: query.data!.pages.at(-1)!.nextCursor,
        }
      : null;
  return (
    <NotificationButton
      data={data}
      state={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
      onSeen={(id) => void seen(id)}
      onOpenStatement={(id) => window.location.assign('/transactions/' + encodeURIComponent(id))}
      pending={pending}
      seenError={error}
      onRetry={() => void query.refetch()}
      onLoadMore={query.hasNextPage ? () => void query.fetchNextPage() : undefined}
      loadingMore={query.isFetchingNextPage}
    />
  );
}
