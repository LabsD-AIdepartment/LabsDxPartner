'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DataState } from '@/shared/ui/DataState';
import type { PreviewIdentity } from '../withdrawals/navigation';
import type { DatasetRecords } from './dataset';
import { createDemoSession, loadDemoDataset, type DemoSession } from './client';
import { beneficiaryRevealEntriesFromDataset } from './bootstrap';
import {
  BeneficiaryAccountRevealProvider,
  type BeneficiaryAccountRevealEntry,
} from '@/features/withdrawals/BeneficiaryAccountRevealContext';
import { useQueryClient } from '@tanstack/react-query';
import { scopeKey } from '@/shared/query/keys';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';

type DatasetMap = Readonly<Partial<Record<PreviewIdentity, DemoSession>>>;
const DatasetContext = createContext<DatasetMap | null>(null);
const DEFAULT_IDENTITIES: readonly PreviewIdentity[] = ['a'];

/** Mount financial consumers only after every requested identity has its validated DB snapshot. */
export function DatasetBoundary({
  identities = DEFAULT_IDENTITIES,
  children,
}: {
  identities?: readonly PreviewIdentity[];
  children: ReactNode;
}) {
  const { connectedAds = false } = useApplicationPresentation();
  const identityKey = [...new Set(identities)].sort().join(',');
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${identityKey}:${attempt}:${connectedAds}`;
  const [result, setResult] = useState<
    { key: string; state: 'ready'; datasets: DatasetMap } | { key: string; state: 'error' } | null
  >(null);
  useEffect(() => {
    const abort = new AbortController();
    const selected = identityKey.split(',').filter(Boolean) as PreviewIdentity[];
    if (!selected.length || selected.some((identity) => !['a', 'b'].includes(identity))) {
      setResult({ key: requestKey, state: 'error' });
      return () => abort.abort();
    }
    void Promise.all(
      selected.map(
        async (identity) =>
          [
            identity,
            createDemoSession(await loadDemoDataset(identity, abort.signal), identity, connectedAds),
          ] as const,
      ),
    ).then(
      (entries) => {
        if (!abort.signal.aborted)
          setResult({ key: requestKey, state: 'ready', datasets: Object.fromEntries(entries) });
      },
      () => {
        if (!abort.signal.aborted) setResult({ key: requestKey, state: 'error' });
      },
    );
    return () => abort.abort();
  }, [identityKey, requestKey, connectedAds]);

  // Scope changes hide the prior snapshot synchronously, before the next effect begins its fetch.
  if (result?.key !== requestKey)
    return <DataState state="loading" message="กำลังโหลดข้อมูลตัวอย่างจากฐานข้อมูล…" />;
  if (result.state === 'error')
    return (
      <DataState
        state="error"
        message="โหลดชุดข้อมูลตัวอย่างจากฐานข้อมูลไม่สำเร็จ"
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  // Optional reveal provider: build the exact synthetic reveal entries from the SAME validated datasets,
  // and bind an identity key that changes on identity, generation, OR retry epoch so the eye re-masks.
  // Generations without a synthetic record (g1–g3 / old DB) contribute nothing ⇒ no eye there.
  const readyIdentities = identityKey.split(',').filter(Boolean) as PreviewIdentity[];
  const revealEntries: BeneficiaryAccountRevealEntry[] = [];
  const generationSig: string[] = [];
  for (const identity of readyIdentities) {
    const dataset = result.datasets[identity]?.dataset;
    if (!dataset) continue;
    generationSig.push(`${identity}:${dataset.meta.generation}`);
    revealEntries.push(...beneficiaryRevealEntriesFromDataset(dataset));
  }
  const revealIdentityKey = `${requestKey}#${generationSig.join(',')}`;
  return (
    <DatasetContext.Provider value={result.datasets}>
      <BeneficiaryAccountRevealProvider identityKey={revealIdentityKey} entries={revealEntries}>
        {children}
      </BeneficiaryAccountRevealProvider>
    </DatasetContext.Provider>
  );
}

export function useDemoDataset(identity: PreviewIdentity): DatasetRecords {
  const datasets = useContext(DatasetContext);
  const dataset = datasets?.[identity];
  if (!dataset) throw new Error('The partner demo requires its database DatasetBoundary');
  return dataset.dataset;
}

/** Non-demo diagnostic compositions intentionally run without a dataset provider. */
export function useOptionalDemoSession(
  identity: PreviewIdentity,
  required = false,
): DemoSession | null {
  const session = useContext(DatasetContext)?.[identity] ?? null;
  if (required && !session) throw new Error('Partner demo dataset is required');
  return session;
}

/** The existing provider owns its query client; live controller changes refresh only this scope. */
export function DatasetQueryRefresh({ session }: { session: DemoSession | null }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!session) return;
    return session.runtime.subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: scopeKey(session.scope) });
    });
  }, [queryClient, session]);
  return null;
}
