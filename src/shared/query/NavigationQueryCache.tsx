'use client';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { QueryClient } from '@tanstack/react-query';

/** In-memory only; the root outlives pages, while verified identity/revision owns every client. */
export function createNavigationQueryCache() {
  let owner: string | null = null;
  const clients = new Map<string, QueryClient>();
  function clear() {
    for (const client of clients.values()) {
      void client.cancelQueries();
      client.clear();
    }
    clients.clear();
    owner = null;
  }
  return {
    clear,
    bind(identity: string) {
      if (owner !== identity) {
        clear();
        owner = identity;
      }
      return {
        get(scope: string, create: () => QueryClient) {
          // A stale subtree must never acquire a client owned by a newer access scope.
          if (owner !== identity) return create();
          let client = clients.get(scope);
          if (!client) {
            client = create();
            clients.set(scope, client);
          }
          return client;
        },
      };
    },
  };
}
type Cache = ReturnType<typeof createNavigationQueryCache>;
const NavigationCacheContext = createContext<Cache | null>(null);
export const RetainedQueryScopeContext = createContext<ReturnType<Cache['bind']> | null>(null);
export function NavigationQueryCache({ children }: { children: ReactNode }) {
  const [cache] = useState(createNavigationQueryCache);
  const pathname = usePathname();
  useEffect(() => {
    if (['/login', '/invite', '/reset-password'].includes(pathname)) cache.clear();
  }, [cache, pathname]);
  const lifecycle = useRef(0);
  useEffect(() => {
    const epoch = ++lifecycle.current;
    return () =>
      queueMicrotask(() => {
        if (lifecycle.current === epoch) cache.clear();
      });
  }, [cache]);
  return (
    <NavigationCacheContext.Provider value={cache}>{children}</NavigationCacheContext.Provider>
  );
}
export function useClearNavigationQueries() {
  const cache = useContext(NavigationCacheContext);
  return useCallback(() => cache?.clear(), [cache]);
}
/** Opt-in only after native access verification; never use a synthetic identity as its owner. */
export function RetainQuerySession({
  identity,
  children,
}: {
  identity: string;
  children: ReactNode;
}) {
  const cache = useContext(NavigationCacheContext);
  const retained = useMemo(() => cache?.bind(identity) ?? null, [cache, identity]);
  return (
    <RetainedQueryScopeContext.Provider value={retained}>
      {children}
    </RetainedQueryScopeContext.Provider>
  );
}
