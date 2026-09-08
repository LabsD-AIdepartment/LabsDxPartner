'use client';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { scopeKey, type QueryScope } from './keys';
import { RevisionWatcher } from './revision-watcher';
import type { ChangesValue, ChangeGroup } from '@/contracts/changes';
export function ChangeWatcher({
  scope,
  load,
  onAccessLost,
  onChange,
  onError,
}: {
  scope: QueryScope;
  load: (signal: AbortSignal) => Promise<unknown>;
  onAccessLost: () => void;
  onChange?: (groups: ChangeGroup[], snapshot: ChangesValue) => void;
  onError?: (error: unknown) => void;
}) {
  const client = useQueryClient();
  const callbacks = useRef({ load, onAccessLost, onChange, onError });
  callbacks.current = { load, onAccessLost, onChange, onError };
  const key = JSON.stringify(scopeKey(scope));
  useEffect(() => {
    const watcher = new RevisionWatcher({
      scope,
      load: (signal) => callbacks.current.load(signal),
      onChange: (groups, snapshot) => {
        for (const group of groups)
          void client.invalidateQueries({
            queryKey: [...scopeKey(scope), group],
            refetchType: 'active',
          });
        callbacks.current.onChange?.(groups, snapshot);
      },
      onError: (error) => callbacks.current.onError?.(error),
      onAccessLost: () => {
        void client.cancelQueries();
        client.clear();
        callbacks.current.onAccessLost();
      },
    });
    const visible = () =>
      watcher.setActive(document.visibilityState !== 'hidden' && navigator.onLine);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    window.addEventListener('offline', visible);
    visible();
    return () => {
      watcher.stop();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
      window.removeEventListener('offline', visible);
    };
  }, [client, key]);
  return null;
}
