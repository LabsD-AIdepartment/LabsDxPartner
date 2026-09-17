import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { TransactionsPreview } from '../../dev/TransactionsPreview';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';
import { buildDataset } from '../../dev/demo-dataset/dataset';
import { datasetScope } from '../../dev/demo-dataset/scope';
import { browserWithdrawalStorage } from '../../dev/withdrawals/browser-storage';
import { releaseWithdrawalRuntime } from '../../dev/withdrawals/transport';
const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const datasets = {
  a: buildDataset({ datasetId: 'partner-demo-a', asOf: new Date('2026-09-17T02:00:00Z') }),
  b: buildDataset({ datasetId: 'partner-demo-b', asOf: new Date('2026-09-17T02:00:00Z') }),
};
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
      unobserve() {}
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
  router.push.mockClear();
  router.replace.mockClear();
  for (const identity of ['a', 'b'] as const)
    releaseWithdrawalRuntime(browserWithdrawalStorage, datasetScope(datasets[identity], identity));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const identity = new URL(String(input), 'http://localhost').searchParams.get('identity');
      return identity === 'a' || identity === 'b'
        ? new Response(JSON.stringify(datasets[identity]), { status: 200 })
        : new Response(null, { status: 404 });
    }),
  );
  window.history.replaceState({}, '', '/');
});
const returnTo =
  '/withdrawal-preview?scenario=partner-demo&identity=b&from=2026-07-01&toExclusive=2026-10-01&brand=Axtion';
describe('partner Wallet preview composition', () => {
  it.each([
    { segments: ['statement-1'], view: 'withdrawals' },
    { segments: [], view: 'periods' },
  ])(
    'normalizes old statement navigation to Wallet while retaining partner/report context: %j',
    async ({ segments, view }) => {
      render(
        <TransactionsPreview
          segments={segments}
          search={new URLSearchParams({
            scenario: 'partner-demo',
            identity: 'b',
            view,
            returnTo,
            request: 'old-statement',
            status: 'paid',
          }).toString()}
        />,
      );
      expect(await screen.findByRole('heading', { name: 'รายการเงินเข้า–ออก' })).toBeVisible();
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      const target = new URL(router.replace.mock.calls[0][0], 'http://localhost');
      expect(target.pathname).toBe('/transactions-preview');
      expect(target.searchParams.get('view')).toBe('withdrawals');
      expect(target.searchParams.get('identity')).toBe('b');
      expect(target.searchParams.get('returnTo')).toBe(returnTo);
      expect(target.searchParams.has('request')).toBe(false);
      expect(target.searchParams.has('status')).toBe(false);
      expect(screen.queryByRole('link', { name: 'ใบสรุปงวดเดิม' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ปิดเครื่องมือทดสอบ' })).not.toBeInTheDocument();
      const overview = new URL(
        screen.getAllByRole('link', { name: 'Overview' })[0].getAttribute('href')!,
        'http://localhost',
      );
      expect(overview.searchParams.get('brand')).toBe('Axtion');
      expect(overview.searchParams.get('identity')).toBe('b');
    },
  );
  it.each(['wallet', 'overview'] as const)(
    'routes notices to scoped Wallet from %s without legacy statement navigation',
    async (page) => {
      const search = new URLSearchParams({
        scenario: 'partner-demo',
        identity: 'b',
        view: 'withdrawals',
        returnTo,
      }).toString();
      render(
        page === 'wallet' ? (
          <TransactionsPreview search={search} />
        ) : (
          <WithdrawalPreview search={search} />
        ),
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'การแจ้งเตือน 1 รายการที่ยังไม่อ่าน' }),
      );
      const dialog = screen.getByRole('dialog', { name: 'การแจ้งเตือน' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'สรุปคอมมิชชันพร้อมตรวจสอบ' }));
      const target = new URL(router.push.mock.calls[0][0], 'http://localhost');
      expect(target.pathname).toBe('/transactions-preview');
      expect(target.searchParams.get('view')).toBe('withdrawals');
      expect(target.searchParams.get('scenario')).toBe('partner-demo');
      expect(target.searchParams.get('identity')).toBe('b');
      expect(target.searchParams.has('request')).toBe(false);
    },
  );
});
