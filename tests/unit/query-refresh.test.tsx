import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createQueryClient, ScopedQueryProvider } from '@/shared/query/provider';
import { ChangeWatcher } from '@/shared/query/ChangeWatcher';
import { AccessLost } from '@/shared/query/revision-watcher';
import { changeMeta, invalidateChanges } from '@/shared/query/invalidate-changes';
import { partnerKey } from '@/shared/query/keys';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { overviewFixture } from '../../dev/overview-transport';
import { scenario } from '../../dev/scenarios';
const scope = { userId: 'user-1', partnerId: 'partner-1', permissionRevision: '1' };
const filters = { from: '2026-07-01', toExclusive: '2026-09-01', brand: null };
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('F08 scoped projection invalidation', () => {
  it('refetches each affected active query once; leaves unrelated scopes and inactive data unfetched', async () => {
    const client = createQueryClient();
    const reads = [
      vi.fn(async () => 1),
      vi.fn(async () => 2),
      vi.fn(async () => 3),
      vi.fn(async () => 4),
    ];
    const specs = [
      {
        queryKey: partnerKey(scope, 'earnings', 'overview'),
        meta: changeMeta('earnings', 'settlements', 'metrics'),
        queryFn: reads[0],
      },
      { queryKey: partnerKey(scope, 'metrics', 'ad'), queryFn: reads[1] },
      {
        queryKey: partnerKey({ ...scope, partnerId: 'other' }, 'settlements', 'statement'),
        queryFn: reads[2],
      },
      { queryKey: partnerKey(scope, 'settlements', 'inactive'), queryFn: reads[3] },
    ];
    const observers = specs.slice(0, 3).map((s) => new QueryObserver(client, s));
    const unsub = observers.map((o) => o.subscribe(() => {}));
    await client.fetchQuery(specs[3]);
    await waitFor(() => expect(reads[0]).toHaveBeenCalledOnce());
    await invalidateChanges(client, scope, ['earnings', 'settlements']);
    expect(reads.map((r) => r.mock.calls.length)).toEqual([2, 1, 1, 1]);
    expect(client.getQueryState(specs[3].queryKey)!.isInvalidated).toBe(true);
    unsub.forEach((fn) => fn());
    client.clear();
  });
  it('replaces a pending old response and keeps overview earnings and later settlements separate', async () => {
    const client = createQueryClient();
    let oldResolve!: (v: unknown) => void, oldSignal!: AbortSignal;
    const read = vi
      .fn()
      .mockImplementationOnce((r) => {
        oldSignal = r.signal;
        return new Promise((resolve) => (oldResolve = resolve));
      })
      .mockImplementation(async () => overviewFixture(filters, 'ready', true));
    render(
      <QueryClientProvider client={client}>
        <OverviewPage scope={scope} transport={read} brands={[]} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    await act(async () => invalidateChanges(client, scope, ['settlements']));
    expect(oldSignal.aborted).toBe(true);
    await screen.findAllByText('฿15,520');
    await act(async () => oldResolve(overviewFixture(filters)));
    expect(screen.queryByText('฿25,520')).toBeNull();
    expect(screen.getAllByText('฿37,360').length).toBeGreaterThan(0);
    expect(read).toHaveBeenCalledTimes(2);
    client.clear();
  });
  it('clears scoped cache on access loss and pauses network checks while hidden or offline', async () => {
    vi.useFakeTimers();
    const client = createQueryClient(),
      lost = vi.fn(),
      read = vi.fn().mockResolvedValue(scenario('ready').changes);
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState'),
      online = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const r = render(
      <QueryClientProvider client={client}>
        <ChangeWatcher scope={scope} load={read} onAccessLost={lost} />
      </QueryClientProvider>,
    );
    try {
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(read).toHaveBeenCalledOnce();
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => vi.advanceTimersByTimeAsync(120000));
      expect(read).toHaveBeenCalledOnce();
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => vi.advanceTimersByTimeAsync(60000));
      expect(read).toHaveBeenCalledOnce();
      client.setQueryData(partnerKey(scope, 'earnings', 'overview'), { privateAmount: '3736000' });
      read.mockRejectedValueOnce(new AccessLost());
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      await act(async () => window.dispatchEvent(new Event('online')));
      expect(lost).toHaveBeenCalledOnce();
      expect(client.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      r.unmount();
      client.clear();
      if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
      else Reflect.deleteProperty(document, 'visibilityState');
      if (online) Object.defineProperty(navigator, 'onLine', online);
      else Reflect.deleteProperty(navigator, 'onLine');
    }
  });
  it('cannot render a late response from the previously selected partner', async () => {
    let resolve!: (v: unknown) => void;
    const old = vi.fn(() => new Promise((r) => (resolve = r))),
      next = vi.fn(async () => overviewFixture(filters, 'empty'));
    const r = render(
      <ScopedQueryProvider scope={scope}>
        <OverviewPage scope={scope} transport={old} brands={[]} />
      </ScopedQueryProvider>,
    );
    await waitFor(() => expect(old).toHaveBeenCalledOnce());
    const other = { ...scope, partnerId: 'other' };
    r.rerender(
      <ScopedQueryProvider scope={other}>
        <OverviewPage scope={other} transport={next} brands={[]} />
      </ScopedQueryProvider>,
    );
    await screen.findAllByText('฿0');
    await act(async () => resolve(overviewFixture(filters)));
    expect(screen.queryByText('฿37,360')).toBeNull();
  });
});
