import { beforeEach as featureBeforeEach, afterEach as featureAfterEach } from 'vitest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { createQueryClient } from '@/shared/query/provider';
import { partnerKey, type QueryScope } from '@/shared/query/keys';
import { defaultOverviewFilters, type OverviewTransport } from '@/features/overview/model';
import { overviewFixture } from '../../dev/overview-transport';
import { BarChart } from '@/shared/charts/BarChart';
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/features/overview/report-export', () => ({ downloadOverviewReport: download }));
const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterAll(() => {
  if (show) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', show);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.unstubAllGlobals();
});
beforeEach(() => {
  download.mockReset();
  download.mockResolvedValue(undefined);
});
const scope: QueryScope = {
  userId: 'export-user',
  partnerId: 'export-partner-a',
  permissionRevision: '1',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function mount(transport: OverviewTransport = async ({ filters }) => overviewFixture(filters)) {
  const client = createQueryClient();
  const tree = (identity: QueryScope) => (
    <QueryClientProvider client={client}>
      <OverviewPage scope={identity} transport={transport} brands={['Axtion']} />
    </QueryClientProvider>
  );
  const view = render(tree(scope));
  return { ...view, client, changeScope: (identity: QueryScope) => view.rerender(tree(identity)) };
}
async function openReport() {
  const button = screen.getByRole('button', { name: 'Export report' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  return screen.getByRole('dialog', { name: 'Export report' });
}
describe('overview report UI authorization and snapshot', () => {
  it('exports an immutable matching snapshot and locks duplicate format requests while generating', async () => {
    const hold = deferred<void>();
    download.mockReturnValue(hold.promise);
    mount();
    const dialog = await openReport();
    const csv = within(dialog).getByRole('button', { name: 'ดาวน์โหลด CSV' });
    act(() => {
      csv.click();
      csv.click();
    });
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [input, format, signal] = download.mock.calls[0];
    expect(format).toBe('csv');
    expect(input.filters).toEqual(defaultOverviewFilters);
    expect(input.data.earnings.period).toEqual(
      overviewFixture(defaultOverviewFilters).earnings.period,
    );
    expect(Object.isFrozen(input.data.earnings)).toBe(true);
    expect(Object.isFrozen(input.filters)).toBe(true);
    expect(signal.aborted).toBe(false);
    expect(within(dialog).getByRole('button', { name: 'ดาวน์โหลด PDF' })).toBeDisabled();
    await act(async () => hold.resolve());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows a safe error and permits a deliberate retry in the other format', async () => {
    download.mockRejectedValueOnce(new Error('internal failure'));
    mount();
    const dialog = await openReport();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ดาวน์โหลด PDF' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('ดาวน์โหลดรายงานไม่สำเร็จ');
    expect(screen.queryByText('internal failure')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ดาวน์โหลด CSV' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(download.mock.calls[1][1]).toBe('csv');
  });
  it('disables export while loading and rejects a review made obsolete by filters', async () => {
    const hold = deferred<unknown>();
    mount(async ({ filters }) => (filters.brand ? hold.promise : overviewFixture(filters)));
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled();
    await openReport();
    fireEvent.change(screen.getByLabelText('แบรนด์'), { target: { value: 'Axtion' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled();
    expect(download).not.toHaveBeenCalled();
    await act(async () =>
      hold.resolve(overviewFixture({ ...defaultOverviewFilters, brand: 'Axtion' })),
    );
  });
  it.each(['scope', 'unmount', 'refresh', 'close'] as const)(
    'aborts the pending report on %s and never renders a late error',
    async (change) => {
      const hold = deferred<void>();
      download.mockReturnValue(hold.promise);
      const refreshResponse = deferred<unknown>();
      let reads = 0;
      const view = mount(async ({ filters }) => {
        reads += 1;
        return change === 'refresh' && reads > 1
          ? refreshResponse.promise
          : overviewFixture(filters);
      });
      const dialog = await openReport();
      fireEvent.click(within(dialog).getByRole('button', { name: 'ดาวน์โหลด PDF' }));
      await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
      const signal = download.mock.calls[0][2] as AbortSignal;
      if (change === 'scope') view.changeScope({ ...scope, partnerId: 'export-partner-b' });
      else if (change === 'unmount') view.unmount();
      else if (change === 'close')
        fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดหน้าต่าง' }));
      else {
        act(() => {
          void view.client.invalidateQueries({
            queryKey: partnerKey(scope, 'earnings', 'overview', defaultOverviewFilters),
          });
        });
        await screen.findByText('กำลังอัปเดตข้อมูล…');
        expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled();
      }
      expect(signal.aborted).toBe(true);
      if (change === 'refresh')
        await act(async () => refreshResponse.resolve(overviewFixture(defaultOverviewFilters)));
      await act(async () => hold.resolve());
      expect(
        screen.queryByText('ดาวน์โหลดรายงานไม่สำเร็จ กรุณาลองอีกครั้ง'),
      ).not.toBeInTheDocument();
    },
  );
  it('keeps every brand amount visible and accessible without losing exact minor-unit precision through Number', () => {
    const items = [
      { label: 'Axtion', value: { currency: 'THB' as const, minor: '23200000' } },
      { label: 'Tendrix', value: { currency: 'THB' as const, minor: '11500000' } },
      { label: 'Rusiren', value: { currency: 'THB' as const, minor: '9300000' } },
      { label: 'Melura', value: { currency: 'THB' as const, minor: '7000000' } },
      { label: 'Zenova', value: { currency: 'THB' as const, minor: '4000000' } },
    ];
    const view = render(<BarChart items={items} />);
    for (const text of ['232k', '115k', '93k', '70k', '40k'])
      expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      expect.stringContaining('Zenova: ฿40,000.00'),
    );
    view.rerender(
      <BarChart items={[{ label: 'Exact', value: { currency: 'THB', minor: '12345678' } }]} />,
    );
    expect(screen.getByText('123.45678k')).toBeVisible();
    expect(screen.getByRole('img')).toHaveAccessibleName('Exact: ฿123,456.78');
  });
});

// The legacy brand workflows remain available behind the opt-in flag.
featureBeforeEach(() => vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true'));
featureAfterEach(() => vi.unstubAllEnvs());
