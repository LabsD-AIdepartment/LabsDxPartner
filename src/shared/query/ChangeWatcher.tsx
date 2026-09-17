'use client';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { scopeKey, type QueryScope } from './keys';
import { RevisionWatcher, AccessLost } from './revision-watcher';
import { invalidateChanges } from './invalidate-changes';
import type { ChangesValue, ChangeGroup } from '@/contracts/changes';
export function ChangeWatcher({
  scope,
  initial,
  reconcileInitial,
  load,
  onAccessLost,
  onChange,
  onError,
}: {
  scope: QueryScope;
  initial?: ChangesValue;
  reconcileInitial?: boolean;
  load: (signal: AbortSignal) => Promise<unknown>;
  onAccessLost: () => void;
  onChange?: (groups: ChangeGroup[], snapshot: ChangesValue) => void;
  onError?: (error: unknown) => void;
}) {
  const client = useQueryClient();
  const callbacks = useRef({ load, onAccessLost, onChange, onError, initial });
  callbacks.current = { load, onAccessLost, onChange, onError, initial };
  const key = JSON.stringify(scopeKey(scope));
  useEffect(() => {
    const loseAccess = () => {
      void client.cancelQueries();
      client.clear();
      callbacks.current.onAccessLost();
    };
    let watcher: RevisionWatcher;
    try {
      watcher = new RevisionWatcher({
        scope,
        initial: callbacks.current.initial,
        reconcileInitial,
        load: (signal) => callbacks.current.load(signal),
        onChange: async (groups, snapshot, signal) => {
          await invalidateChanges(client, scope, groups, { signal, throwOnError: true });
          callbacks.current.onChange?.(groups, snapshot);
        },
        onError: (error) => callbacks.current.onError?.(error),
        onAccessLost: loseAccess,
      });
    } catch (error) {
      callbacks.current.onError?.(error);
      if (error instanceof AccessLost) loseAccess();
      return;
    }
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
  }, [client, key, reconcileInitial]);
  return null;
}
