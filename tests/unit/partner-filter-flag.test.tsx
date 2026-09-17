import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { partnerBrandFilterEnabled, partnerFilters } from '@/shared/config/partner-features';
import { FilterBar } from '@/shared/ui/FilterBar';
import {
  readReportContext,
  reportHref,
  changeReportFilters,
  initialReportContext,
} from '@/shared/routing/report-context';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { earningsHref, loadOverview } from '@/features/overview/model';
import { loadContent, resourceKey, type ContentRequest } from '@/features/content/model';
import { useContent } from '@/features/content/useContent';
import { createQueryClient } from '@/shared/query/provider';
import { overviewFixture } from '../../dev/overview-transport';
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/features/overview/report-export', () => ({ downloadOverviewReport: download }));
const scope = { userId: 'flag-user', partnerId: 'flag-partner', permissionRevision: '1' };
const branded = {
  ...initialReportContext,
  brand: 'Axtion',
  q: 'routine',
  cursor: 'old-cursor',
  history: [null],
  generation: '1',
};
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'false');
  download.mockReset();
  download.mockResolvedValue(undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('default-off partner brand filter', () => {
  it.each([undefined, 'false', 'TRUE', '1'])('is not enabled by %s', (value) => {
    vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', value);
    expect(partnerBrandFilterEnabled()).toBe(false);
  });
  it('clears hidden brand and old pagination from read, change, and link boundaries', () => {
    const expected = { ...branded, brand: null, cursor: null, history: [], generation: null };
    expect(partnerFilters(branded)).toEqual(expected);
    const params = new URLSearchParams({
      from: branded.from,
      toExclusive: branded.toExclusive,
      brand: branded.brand,
      q: branded.q,
      cursor: branded.cursor,
      history: JSON.stringify(branded.history),
      generation: '1',
    });
    expect(readReportContext(params)).toEqual(expected);
    const href = reportHref('/content?brand=OLD&cursor=old&scenario=partner-demo', branded);
    expect(href).toContain('scenario=partner-demo');
    expect(href).toContain('q=routine');
    expect(href).not.toMatch(/brand=|cursor=|history=|generation=/);
    expect(changeReportFilters(branded, { from: '2026-08-01' })).toEqual({
      ...expected,
      from: '2026-08-01',
    });
  });
  it('retains all brand and cursor behavior when explicitly enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true');
    expect(partnerFilters(branded)).toBe(branded);
    expect(reportHref('/content', branded)).toContain('brand=Axtion');
    render(<FilterBar value={branded} brands={['Axtion']} onChange={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getByLabelText('แบรนด์')).toHaveValue('Axtion');
  });
  it('strips hidden brand from overview reads and earnings links', async () => {
    const send = vi.fn(async ({ filters }) => overviewFixture(filters));
    await loadOverview(send, {
      scope,
      filters: { from: branded.from, toExclusive: branded.toExclusive, brand: branded.brand },
      signal: new AbortController().signal,
    });
    expect(send.mock.calls[0][0].filters.brand).toBeNull();
    expect(earningsHref('/content', overviewFixture(initialReportContext), branded)).not.toContain(
      'brand=',
    );
  });
  it('strips hidden branded detail context before the transport call', async () => {
    const send = vi.fn(async (_request: ContentRequest) => {
      throw new Error('stop after capture');
    });
    await expect(
      loadContent(send, {
        scope,
        context: branded,
        resource: 'detail',
        contentId: 'clip-1',
        cursor: 'explicit-old-cursor',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('stop after capture');
    expect(send.mock.calls[0][0].cursor).toBeNull();
    expect(
      resourceKey('detail', branded, 'clip-1', undefined, 'explicit-old-cursor'),
    ).toMatchObject({ brand: null, cursor: null });
    expect(send.mock.calls[0][0].context).toMatchObject({
      brand: null,
      cursor: null,
      generation: null,
      history: [],
      q: 'routine',
    });
  });
  it('exports the same unfiltered snapshot shown on the page despite stale initial brand', async () => {
    const send = vi.fn(async ({ filters }) => overviewFixture(filters));
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OverviewPage
          scope={scope}
          transport={send}
          brands={['Axtion']}
          initialFilters={{
            from: branded.from,
            toExclusive: branded.toExclusive,
            brand: branded.brand,
          }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export report' })).toBeEnabled(),
    );
    expect(screen.queryByLabelText('แบรนด์')).toBeNull();
    expect(send.mock.calls[0][0].filters.brand).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    fireEvent.click(screen.getByRole('button', { name: 'ดาวน์โหลด CSV' }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(download.mock.calls[0][0].filters.brand).toBeNull();
    expect(download.mock.calls[0][0].data.earnings.eligibleSales.minor).toBe('55000000');
  });
});

it('keeps query keys and generation in the normalized unfiltered scope', async () => {
  const client = createQueryClient();
  const send = vi.fn(async (_request: ContentRequest) => {
    throw new Error('captured');
  });
  renderHook(
    () =>
      useContent(send, {
        scope,
        context: branded,
        resource: 'detail',
        contentId: 'clip-1',
        cursor: 'explicit-stale',
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][0]).toMatchObject({
    cursor: null,
    context: { brand: null, generation: null, cursor: null },
  });
  const serialized = JSON.stringify(client.getQueryCache().getAll()[0].queryKey);
  expect(serialized).not.toContain('Axtion');
  expect(serialized).not.toContain('explicit-stale');
  expect(serialized).not.toContain('old-cursor');
  expect(client.getQueryCache().getAll()[0].queryKey.at(-1)).toBeNull();
});
it('retains a newly issued unfiltered cursor and generation', async () => {
  const context = { ...initialReportContext, generation: '2', cursor: 'new-context-cursor' };
  const send = vi.fn(async (_request: ContentRequest) => {
    throw new Error('captured');
  });
  await expect(
    loadContent(send, {
      scope,
      context,
      resource: 'list',
      cursor: 'new-page-cursor',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('captured');
  expect(send.mock.calls[0][0]).toMatchObject({
    cursor: 'new-page-cursor',
    context: { generation: '2', cursor: 'new-context-cursor' },
  });
  expect(resourceKey('list', context, undefined, undefined, 'new-page-cursor').cursor).toBe(
    'new-page-cursor',
  );
});
