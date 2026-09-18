import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { TransactionsPreview } from '../../dev/TransactionsPreview';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';
import { buildDataset } from '../../dev/demo-dataset/dataset';
import { datasetScope } from '../../dev/demo-dataset/scope';
import { browserWithdrawalStorage } from '../../dev/withdrawals/browser-storage';
import { releaseWithdrawalRuntime } from '../../dev/withdrawals/transport';
import { ApplicationPresentationContext } from '@/shared/routing/ApplicationPresentation';
import { pitchHref, pitchSearch } from '@/features/pitch/routes';
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
  it('opens withdrawal details without the Wallet summary and retains the way back', async () => {
    render(
      <TransactionsPreview
        search={new URLSearchParams({
          scenario: 'partner-demo',
          identity: 'b',
          view: 'withdrawals',
          request: datasets.b.withdrawals.find((row) => row.status === 'paid')!.requestRef,
          returnTo,
        }).toString()}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'รายละเอียดการถอนเงิน' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'สรุปยอดพร้อมถอน' })).not.toBeInTheDocument();
    const back = within(
      screen.getByRole('navigation', { name: 'กลับรายการคำขอถอนเงิน' }),
    ).getByRole('link', { name: 'กลับ Wallet' });
    expect(back).toBeVisible();
    expect(
      new URL(back.getAttribute('href')!, 'http://localhost').searchParams.has('request'),
    ).toBe(false);
    expect(screen.getByRole('heading', { name: 'หลักฐานการโอน' })).toBeVisible();
  });
  it('filters database-backed credits and withdrawals inclusively on canonical routes and preserves report context', async () => {
    const report = '/overview?from=2026-07-08&toExclusive=2026-08-25&origin=overview';
    const search = pitchSearch({
      view: 'withdrawals',
      returnTo: report,
      requestedFrom: '2026-09-01',
      requestedToExclusive: '2026-09-15',
    });
    window.history.replaceState({}, '', '/transactions');
    render(
      <ApplicationPresentationContext.Provider value={{ resolveHref: pitchHref, sampleData: true }}>
        <TransactionsPreview search={search} />
      </ApplicationPresentationContext.Provider>,
    );
    const ledger = await screen.findByRole('list', { name: 'รายการเงินเข้า–ออก' });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(6);
    expect(within(ledger).getByText('คอมมิชชันเข้ายอดพร้อมถอน')).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Overview' })[0]).toHaveAttribute('href', report);

    fireEvent.click(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' })).getByRole('button', {
        name: '2026-09-11',
      }),
    );
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินสิ้นสุด' })).getByRole('button', {
        name: '2026-09-14',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(2);
    expect(within(ledger).getByRole('link', { name: 'ดูรายการถอน 202609111004' })).toBeVisible();
    const last = within(ledger).getByRole('link', { name: 'ดูรายการถอน 202609141005' });
    const detail = new URL(last.getAttribute('href')!, 'https://example.invalid');
    expect(detail.pathname).toBe('/transactions');
    expect(detail.searchParams.get('returnTo')).toBe(report);
    expect(detail.searchParams.get('requestedFrom')).toBe('2026-09-11');
    expect(detail.searchParams.get('requestedToExclusive')).toBe('2026-09-15');
    expect(new URLSearchParams(window.location.search).get('requestedToExclusive')).toBe(
      '2026-09-15',
    );

    fireEvent.click(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' })).getByRole('button', {
        name: '2026-09-15',
      }),
    );
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินสิ้นสุด' })).getByRole('button', {
        name: '2026-09-18',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    expect(screen.getByText('ไม่มีรายการในช่วงวันที่นี้')).toBeVisible();
    expect(
      within(screen.getByRole('article', { name: 'สรุปยอดพร้อมถอน' })).getByText('฿248,600'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ดูทั้งหมด' }));
    const all = await screen.findByRole('list', { name: 'รายการเงินเข้า–ออก' });
    expect(within(all).getAllByRole('listitem')).toHaveLength(6);
    expect(within(all).getByText('คอมมิชชันเข้ายอดพร้อมถอน')).toBeVisible();
    expect(new URLSearchParams(window.location.search).has('requestedFrom')).toBe(false);
    expect(new URLSearchParams(window.location.search).has('requestedToExclusive')).toBe(false);
  });
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
