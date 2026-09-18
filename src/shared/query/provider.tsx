'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useContext, useMemo, useEffect, type ReactNode } from 'react';
import { RetainedQueryScopeContext } from './NavigationQueryCache';
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
  return <IsolatedQueryProvider identity={scopeKey(scope)}>{children}</IsolatedQueryProvider>;
}
export function IsolatedQueryProvider({
  identity,
  children,
}: {
  identity: readonly string[];
  children: ReactNode;
}) {
  const key = JSON.stringify(identity);
  // Each access scope gets a distinct client: old amounts cannot render in a new identity's cache.
  const retained = useContext(RetainedQueryScopeContext);
  const client = useMemo(
    () => retained?.get(key, createQueryClient) ?? createQueryClient(),
    [key, retained],
  );
  useEffect(
    () => () => {
      if (retained) return;
      void client.cancelQueries();
      client.clear();
    },
    [client, retained],
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
