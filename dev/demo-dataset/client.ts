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
import { loadConnectedAds } from '../ad-performance/connected-client';
import { accountingCommission, withoutConnectedSamples } from './connected-earnings';
import { applyAdSample } from '../ad-sample-media';
import { Overview } from '@/contracts/overview';
import { ContentDetailResponse, ContentListResponse, AdListResponse, AdDetailResponse } from '@/contracts/content';
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

export function createDemoSession(dataset: DatasetRecords, identity: PreviewIdentity, connectedAds = false) {
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
    const original = projectOverview(dataset, request.filters, overlay());
    if (!connectedAds) return original;
    const ads = await loadConnectedAds({ identity, ...request.filters }, request.signal);
    const projected = projectOverview(withoutConnectedSamples(dataset, ads), request.filters);
    const entries = ads.connections.filter(c => !request.filters.brand ||
      dataset.clips.find(clip => clip.contentId === c.clipId)?.brand === request.filters.brand).map(c => ({
      ...accountingCommission(dataset, c, ads.period), clipId: c.clipId,
      title: applyAdSample({ id: c.clipId, title: dataset.clips.find(clip => clip.contentId === c.clipId)?.title ?? c.clipId, cover: null }).title,
      fetchedAt: c.performance?.fetchedAt ?? null,
    }));
    const allKnown = entries.every(c => c.amount !== null);
    return Overview.parse({ ...projected, obligation: original.obligation,
      dataState: allKnown ? projected.dataState : 'partial',
      reasons: [...projected.reasons, ...new Set(entries.flatMap(c => c.reason ? [c.reason] : []))],
      earnings: { ...projected.earnings, connectedAdEarnings: entries,
        estimated: allKnown && projected.earnings.estimated ? {
          currency: 'THB', minor: (BigInt(projected.earnings.estimated.minor) + entries.reduce((sum, c) => sum + BigInt(c.amount!.minor), 0n)).toString(),
        } : null,
      },
    });
  };
  const content: ContentTransport = async (request) => {
    assertRequest(request);
    const ads = connectedAds ? await loadConnectedAds({ identity, ...request.context }, request.signal) : null;
    const linked = ads?.connections.find(c => c.clipId === request.contentId);
    const sourceDataset = ads ? withoutConnectedSamples(dataset, ads) : dataset;
    const result = projectContent(sourceDataset, {
      ...request,
      ...(linked && (request.resource === 'ads' || request.resource === 'ad') ? { resource: 'detail' as const } : {}),
      context: { ...request.context, generation: request.context.generation ?? undefined },
    });
    if (ads) {
      if (request.resource === 'list' && 'items' in result.data) {
        return ContentListResponse.parse({ ...result, data: { ...result.data, items: result.data.items.map(item => {
          const connection = ads.connections.find(c => c.clipId === item.id);
          if (!connection) return item;
          const commission = accountingCommission(dataset, connection, ads.period);
          return { ...item, adCommission: commission };
        }) } });
      }
      if (linked && 'content' in result.data) {
        if (request.resource === 'ads' || request.resource === 'ad') {
          const envelope = { dataState: result.dataState, generatedAt: result.generatedAt,
            dataThrough: result.dataThrough, reasons: result.reasons, requestId: result.requestId,
            generation: result.generation, period: result.period };
          const ad = { id: linked.adId, contentId: linked.clipId, title: `Facebook · Ad ${linked.adId}`,
            status: 'unknown', asOf: linked.performance?.fetchedAt ?? dataset.meta.asOf, metrics: [],
            ...(linked.performance ? { performance: linked.performance } : {}),
          };
          if (request.resource === 'ad') {
            if (request.adId !== linked.adId) throw new Error('Ad is not linked to this clip');
            return AdDetailResponse.parse({ ...envelope, data: ad });
          }
          return AdListResponse.parse({ ...envelope, data: { items: [ad], nextCursor: null, totalCount: 1 } });
        }
        const commission = accountingCommission(dataset, linked, ads.period);
        return ContentDetailResponse.parse({ ...result, data: { ...result.data,
          content: { ...result.data.content, adCommission: commission },
          adCount: 1,
          adCommission: commission, ...(linked.performance ? { performance: linked.performance } : {}),
        } });
      }
      return result;
    }
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
