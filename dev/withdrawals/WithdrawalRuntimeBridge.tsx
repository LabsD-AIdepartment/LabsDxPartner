'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WithdrawalScopeValue } from '@/contracts/withdrawal-journey';
import { withdrawalScopeKey } from '@/features/withdrawals/model';
import { browserWithdrawalStorage } from './browser-storage';
import { getWithdrawalRuntime, type WithdrawalRuntime } from './transport';

const idleSubscribe = () => () => {};
const initialVersion = () => 0;

/** Both pages resolve the same browser authority only after mount. Disposal only unsubscribes. */
export function useWithdrawalRuntime(scope: WithdrawalScopeValue, injected?: WithdrawalRuntime) {
  const key = JSON.stringify(withdrawalScopeKey(scope));
  const [loaded, setLoaded] = useState<{ key: string; runtime: WithdrawalRuntime } | null>(null);
  useEffect(() => {
    setLoaded({
      key,
      runtime:
        injected ??
        getWithdrawalRuntime({ scope, storage: browserWithdrawalStorage, latencyMs: 150 }),
    });
    // Scope fields are all represented in key; report/display filters are deliberately absent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, injected]);
  const runtime = injected ?? (loaded?.key === key ? loaded.runtime : null);
  const version = useSyncExternalStore(
    runtime?.subscribe ?? idleSubscribe,
    runtime?.version ?? initialVersion,
    initialVersion,
  );
  return { runtime, version };
}
