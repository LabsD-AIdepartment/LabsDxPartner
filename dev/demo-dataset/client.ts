import type { PreviewIdentity } from '../withdrawals/navigation';
import { validateDataset, type DatasetRecords } from './dataset';

// Browser-safe projection modules only: server SQLite modules are intentionally absent here.
import {
  projectOverview,
  projectContent,
  projectTransactions,
  projectDocument,
} from './projections';
import { assertIdentityMatchesDataset, datasetScope } from './scope';
import { loadAdPerformance } from '../ad-performance/client';
import { bootstrapWithdrawal, withdrawalRowsFromRecords } from './bootstrap';
import { browserWithdrawalStorage } from '../withdrawals/browser-storage';
import { getWithdrawalRuntime, type WithdrawalRuntime } from '../withdrawals/transport';
import type { OverviewTransport } from '@/features/overview/model';
import type { ContentTransport } from '@/features/content/model';
import type { TransactionTransport, DocumentTransport } from '@/features/transactions/model';
import type { QueryScope } from '@/shared/query/keys';
import { PersistedWithdrawalRecord } from '../withdrawals/store';

/** Read-only development snapshot. No path, dataset generation, or fallback is supplied by the UI. */
export async function loadDemoDataset(
  identity: PreviewIdentity,
  signal: AbortSignal,
): Promise<DatasetRecords> {
  if (identity !== 'a' && identity !== 'b') throw new Error('Invalid demo identity');
  const response = await fetch(`/api/dev/demo-dataset?${new URLSearchParams({ identity })}`, {
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Demo database unavailable');
  const raw: unknown = await response.json();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const records = validateDataset(raw);
  assertIdentityMatchesDataset(records, identity);
  return records;
}

export function createDemoSession(dataset: DatasetRecords, identity: PreviewIdentity) {
  const scope = datasetScope(dataset, identity);
  const runtime = getWithdrawalRuntime({
    scope,
    storage: browserWithdrawalStorage,
    latencyMs: 150,
    bootstrap: bootstrapWithdrawal(dataset, scope),
  });
  function assertRequest(request: { scope: QueryScope; signal: AbortSignal }) {
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (
      request.scope.userId !== scope.userId ||
      request.scope.partnerId !== scope.partnerId ||
      request.scope.permissionRevision !== scope.permissionRevision
    )
      throw new Error('Mismatched demo dataset scope');
  }
  const overlay = () => currentWithdrawalRows(runtime);
  const overview: OverviewTransport = async (request) => {
    assertRequest(request);
    return projectOverview(dataset, request.filters, overlay());
  };
  const content: ContentTransport = async (request) => {
    assertRequest(request);
    const result = projectContent(dataset, {
      ...request,
      context: { ...request.context, generation: request.context.generation ?? undefined },
    });
    // Optional Celeb-safe ad performance overlay for a clip detail. It is best-effort: the endpoint is
    // off by default and returns null unless a matching server binding + snapshot exist. A null result
    // (disabled, missing snapshot, aborted, or any failure) leaves the financial detail untouched.
    if (request.resource === 'detail' && request.contentId && 'content' in result.data) {
      const performance = await loadAdPerformance(
        {
          identity,
          clipId: request.contentId,
          from: request.context.from,
          toExclusive: request.context.toExclusive,
        },
        request.signal,
      );
      if (performance && !request.signal.aborted)
        return { ...result, data: { ...result.data, performance } } as typeof result;
    }
    return result;
  };
  const transactions: TransactionTransport = async (request) => {
    assertRequest(request);
    return projectTransactions(dataset, request, overlay());
  };
  const documents: DocumentTransport = async (request) => {
    assertRequest(request);
    const requests = overlay();
    const current = projectTransactions(
      dataset,
      { resource: 'detail', statementId: request.statementId },
      requests,
    );
    if (!('statement' in current.data) || current.data.statement.version !== request.version)
      throw new Error('Statement changed');
    const text = projectDocument(dataset, request.statementId, request.documentId, requests);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    let disposed = false;
    let url: string | null = null;
    return {
      expiresAt,
      save: () => {
        if (disposed || Date.now() >= Date.parse(expiresAt)) throw new Error('Document expired');
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${request.statementId}-${request.documentId}.csv`;
        anchor.click();
      },
      dispose: () => {
        disposed = true;
        if (url) URL.revokeObjectURL(url);
        url = null;
      },
    };
  };
  return { dataset, scope, runtime, overview, content, transactions, documents };
}
export type DemoSession = ReturnType<typeof createDemoSession>;

/** Read the public authoritative controller views, never its private mutable fields. */
export function currentWithdrawalRows(runtime: WithdrawalRuntime) {
  const records = runtime.controller.list().items.map((request) => {
    const result = runtime.controller.detail(request.requestRef);
    if (result.state !== 'found') throw new Error('Withdrawal snapshot changed');
    return PersistedWithdrawalRecord.parse({
      ...result.detail.request,
      timeline: result.detail.timeline,
      historyComplete: result.detail.historyComplete,
      sourceContext: result.detail.sourceContext,
    });
  });
  return withdrawalRowsFromRecords(records);
}
