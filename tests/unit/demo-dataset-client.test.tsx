import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { buildDataset } from '../../dev/demo-dataset/dataset';
import { createDemoSession, loadDemoDataset } from '../../dev/demo-dataset/client';
import { DatasetQueryRefresh } from '../../dev/demo-dataset/DatasetBoundary';
import { datasetScope } from '../../dev/demo-dataset/scope';
import { browserWithdrawalStorage } from '../../dev/withdrawals/browser-storage';
import { releaseWithdrawalRuntime } from '../../dev/withdrawals/transport';
import { createQueryClient } from '@/shared/query/provider';
import { partnerKey } from '@/shared/query/keys';
import { loadTransactions } from '@/features/transactions/model';
import { loadOverview } from '@/features/overview/model';

const records = () =>
  buildDataset({ datasetId: 'partner-demo-a', asOf: new Date('2026-09-17T02:00:00Z') });
const signal = () => new AbortController().signal;
beforeEach(() => {
  sessionStorage.clear();
  for (const identity of ['a', 'b'] as const) {
    const data = buildDataset({
      datasetId: `partner-demo-${identity}`,
      asOf: new Date('2026-09-17T02:00:00Z'),
    });
    releaseWithdrawalRuntime(browserWithdrawalStorage, datasetScope(data, identity));
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('database demo client', () => {
  it('rejects unavailable, foreign identity, and aborted snapshot responses', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(loadDemoDataset('a', signal())).rejects.toThrow('unavailable');
    const foreign = { ...records(), meta: { ...records().meta, datasetId: 'partner-demo-b' } };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(foreign)));
    await expect(loadDemoDataset('a', signal())).rejects.toThrow();
    const aborted = new AbortController();
    fetcher.mockImplementationOnce(async () => {
      aborted.abort();
      return new Response(JSON.stringify(records()));
    });
    await expect(loadDemoDataset('a', aborted.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(records())));
    expect((await loadDemoDataset('a', signal())).meta.datasetId).toBe('partner-demo-a');
    expect(fetcher.mock.calls[3][0]).toBe('/api/dev/demo-dataset?identity=a');
    expect(fetcher.mock.calls[3][1]).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('uses one generation-scoped runtime and rejects foreign report scopes', async () => {
    sessionStorage.setItem('legacy-sentinel', 'keep');
    const session = createDemoSession(records(), 'a');
    expect(createDemoSession(records(), 'a').runtime).toBe(session.runtime);
    const b = createDemoSession(
      buildDataset({ datasetId: 'partner-demo-b', asOf: new Date('2026-09-17T02:00:00Z') }),
      'b',
    );
    expect(b.runtime).not.toBe(session.runtime);
    await expect(
      session.overview({
        scope: b.scope,
        filters: { from: '2026-07-01', toExclusive: '2026-09-01', brand: null },
        signal: signal(),
      }),
    ).rejects.toThrow('scope');
    expect(sessionStorage.getItem('legacy-sentinel')).toBe('keep');
  });

  it('projects overview and statements from the current paid-request overlay without double counting', async () => {
    const session = createDemoSession(records(), 'a');
    const read = () =>
      loadTransactions(session.transactions, {
        scope: session.scope,
        resource: 'detail',
        statementId: 'statement-1',
        signal: signal(),
      });
    const initial = await read();
    expect(initial.data.statement.settled.minor).toBe('10000000');
    const pending = session.runtime.controller
      .list()
      .items.find((item) => item.status === 'requested')!;
    expect(pending.gross.minor).toBe('2500000');
    session.runtime.controller.markProcessing(pending.requestRef);
    session.runtime.controller.markPaid(pending.requestRef);
    const after = await read();
    expect(after.data.statement.settled.minor).toBe('12500000');
    expect(after.data.statement.closing.minor).toBe('24860000');
    expect(after.data.settlements.items).toHaveLength(5);
    const overview = await loadOverview(session.overview, {
      scope: session.scope,
      filters: { from: '2026-07-01', toExclusive: '2026-09-01', brand: null },
      signal: signal(),
    });
    expect(overview.earnings.confirmed?.minor).toBe('37360000');
    const balance = session.runtime.controller.summary().balance;
    expect(balance.state).toBe('known');
    if (balance.state === 'known') expect(balance.available.minor).toBe('24860000');
  });

  it('prepares a fresh CSV after settlement changes and disposes its download URL', async () => {
    const session = createDemoSession(records(), 'a');
    const read = () =>
      loadTransactions(session.transactions, {
        scope: session.scope,
        resource: 'detail',
        statementId: 'statement-1',
        signal: signal(),
      });
    const before = await read();
    const documentId = before.data.documents[0].id;
    const blobs: Blob[] = [];
    const create = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:sample-${blobs.length}`;
    });
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const prepare = (version: string) =>
      session.documents({
        scope: session.scope,
        statementId: 'statement-1',
        version,
        documentId,
        signal: signal(),
      });
    const first = await prepare(before.data.statement.version);
    await first.save();
    const pending = session.runtime.controller
      .list()
      .items.find((item) => item.status === 'requested')!;
    session.runtime.controller.markProcessing(pending.requestRef);
    session.runtime.controller.markPaid(pending.requestRef);
    const after = await read();
    const second = await prepare(after.data.statement.version);
    await second.save();
    const text = (blob: Blob) =>
      new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blob);
      });
    expect(await text(blobs[1])).not.toBe(await text(blobs[0]));
    first.dispose?.();
    second.dispose?.();
    expect(revoke).toHaveBeenCalledWith('blob:sample-1');
    expect(revoke).toHaveBeenCalledWith('blob:sample-2');
    await expect(async () => first.save()).rejects.toThrow('expired');
  });

  it('refreshes active statement queries on the same controller mutation', async () => {
    const session = createDemoSession(records(), 'a');
    const client = createQueryClient();
    function Statement() {
      const query = useQuery({
        queryKey: partnerKey(session.scope, 'settlements', 'list'),
        queryFn: ({ signal }) =>
          loadTransactions(session.transactions, {
            scope: session.scope,
            resource: 'list',
            signal,
          }),
      });
      return <p>{query.data?.data.items[0].settled.minor ?? 'loading'}</p>;
    }
    const view = render(
      <QueryClientProvider client={client}>
        <DatasetQueryRefresh session={session} />
        <Statement />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('10000000')).toBeVisible();
    const pending = session.runtime.controller
      .list()
      .items.find((item) => item.status === 'requested')!;
    act(() => {
      session.runtime.controller.markProcessing(pending.requestRef);
      session.runtime.controller.markPaid(pending.requestRef);
    });
    await waitFor(() => expect(screen.getByText('12500000')).toBeVisible());
    view.unmount();
    client.clear();
  });
});
