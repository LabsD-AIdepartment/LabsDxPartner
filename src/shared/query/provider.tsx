'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useEffect, type ReactNode } from 'react';
import { scopeKey, type QueryScope } from './keys';
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 300_000, retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
export function ScopedQueryProvider({
  scope,
  children,
}: {
  scope: QueryScope;
  children: ReactNode;
}) {
  const key = JSON.stringify(scopeKey(scope));
  // Each access scope gets a distinct client: old amounts cannot render in a new identity's cache.
  const client = useMemo(() => createQueryClient(), [key]);
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
