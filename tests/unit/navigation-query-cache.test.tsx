import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { createQueryClient, ScopedQueryProvider } from '@/shared/query/provider';
import {
  createNavigationQueryCache,
  NavigationQueryCache,
  RetainQuerySession,
  useClearNavigationQueries,
} from '@/shared/query/NavigationQueryCache';
const route = vi.hoisted(() => ({ path: '/content' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));
const scope = { userId: 'preview-user', partnerId: 'preview-partner', permissionRevision: '1' };
function Report({ read }: { read: () => Promise<string> }) {
  const q = useQuery({
    queryKey: ['report'],
    queryFn: read,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  return (
    <>
      <p>{q.data ?? 'loading'}</p>
      {q.isFetching && <span>refreshing</span>}
    </>
  );
}
afterEach(() => {
  route.path = '/content';
});
describe('verified session navigation query cache', () => {
  it('shows prior scoped data immediately on a revisit while still fetching latest, even in StrictMode', async () => {
    let resolve!: (value: string) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockImplementation(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      );
    const ui = (visible: boolean, owner = 'native-user:partner:revision1') => (
      <StrictMode>
        <NavigationQueryCache>
          {visible && (
            <RetainQuerySession identity={owner}>
              <ScopedQueryProvider scope={scope}>
                <Report read={read} />
              </ScopedQueryProvider>
            </RetainQuerySession>
          )}
        </NavigationQueryCache>
      </StrictMode>
    );
    const view = render(ui(true));
    expect(await screen.findByText('first')).toBeVisible();
    view.rerender(ui(false));
    view.rerender(ui(true));
    expect(screen.getByText('first')).toBeVisible();
    expect(screen.getByText('refreshing')).toBeVisible();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await act(async () => resolve('latest'));
    expect(await screen.findByText('latest')).toBeVisible();
    view.rerender(ui(false));
    view.rerender(ui(true, 'native-user:partner:revision2'));
    expect(screen.getByText('loading')).toBeVisible();
    expect(screen.queryByText('latest')).toBeNull();
  });
  it('clears all old clients and never reuses them across native identity or revision', () => {
    const cache = createNavigationQueryCache();
    const old = cache.bind('user-a:partner:rev1').get('same-preview-scope', createQueryClient);
    old.setQueryData(['money'], 'private');
    const next = cache.bind('user-b:partner:rev1').get('same-preview-scope', createQueryClient);
    expect(next).not.toBe(old);
    expect(next.getQueryData(['money'])).toBeUndefined();
    expect(old.getQueryData(['money'])).toBeUndefined();
    next.setQueryData(['money'], 'new');
    cache.clear();
    expect(next.getQueryData(['money'])).toBeUndefined();
  });
  it('login and explicit access failure/logout resets remove retained values', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce('private')
      .mockImplementation(() => new Promise<string>(() => {}));
    function Reset() {
      const clear = useClearNavigationQueries();
      return <button onClick={clear}>clear access</button>;
    }
    const ui = (show: boolean) => (
      <NavigationQueryCache>
        <Reset />
        {show && (
          <RetainQuerySession identity="native">
            <ScopedQueryProvider scope={scope}>
              <Report read={read} />
            </ScopedQueryProvider>
          </RetainQuerySession>
        )}
      </NavigationQueryCache>
    );
    const view = render(ui(true));
    await screen.findByText('private');
    fireEvent.click(screen.getByRole('button', { name: 'clear access' }));
    route.path = '/login';
    view.rerender(ui(false));
    route.path = '/content';
    view.rerender(ui(true));
    expect(screen.getByText('loading')).toBeVisible();
    expect(screen.queryByText('private')).toBeNull();
  });
  it('preserves default non-retained provider isolation', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockImplementation(() => new Promise<string>(() => {}));
    const ui = (show: boolean) => (
      <>
        {show && (
          <ScopedQueryProvider scope={scope}>
            <Report read={read} />
          </ScopedQueryProvider>
        )}
      </>
    );
    const view = render(ui(true));
    await screen.findByText('first');
    view.rerender(ui(false));
    view.rerender(ui(true));
    expect(screen.getByText('loading')).toBeVisible();
  });
});
