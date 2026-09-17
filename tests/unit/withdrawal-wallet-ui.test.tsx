import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WithdrawalWallet } from '@/features/withdrawals/WithdrawalWallet';
import { WithdrawalProofButton } from '@/features/withdrawals/WithdrawalProofButton';
import type { WithdrawalScopeValue } from '@/contracts/withdrawal-journey';
import type { WithdrawalStaffTransport } from '@/features/withdrawals/model';
import { createWithdrawalScenario } from '../../dev/withdrawals/transport';
import { memoryStorage } from '../../dev/withdrawals/store';
import { dateLabel } from '@/shared/ui/format-date';
import { defaultWalletDateRange } from '@/features/withdrawals/wallet-ledger';
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/features/withdrawals/withdrawal-proof', () => ({ downloadWithdrawalProof: download }));
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
});
afterAll(() => {
  if (show) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', show);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
beforeEach(() => {
  download.mockReset();
  download.mockResolvedValue(undefined);
});
const scope: WithdrawalScopeValue = {
  userId: 'wallet-user',
  partnerId: 'wallet-partner',
  payerId: 'wallet-payer',
  permissionRevision: '1',
  currency: 'THB',
  scenario: 'golden',
};
const wide = { status: 'all' as const, from: '2026-01-01', toExclusive: '2027-01-01' };
function fixture() {
  return createWithdrawalScenario({ scope, storage: memoryStorage(), latencyMs: 0 });
}
function seed(current: ReturnType<typeof fixture>, paid = false) {
  const quote = current.controller.quote('500000');
  if (quote.state !== 'quoted') throw Error('Quote');
  const result = current.controller.submit({
    scope,
    idempotencyKey: crypto.randomUUID(),
    quoteId: quote.quoteId,
    gross: quote.gross,
    net: quote.net,
    bindings: quote.bindings,
  });
  if (result.outcome === 'rejected') throw Error(result.detail);
  if (paid) current.controller.markPaid(result.request.requestRef);
  return current.controller.list().items[0];
}
function mount(transport: WithdrawalStaffTransport, filters: typeof wide | null = wide) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const tree = (value = filters, identity = scope) => (
    <QueryClientProvider client={client}>
      <WithdrawalWallet
        scope={identity}
        transport={transport}
        filters={value ?? undefined}
        backHref="/transactions-preview?view=withdrawals"
        requestHref={(ref) => `/transactions-preview?view=withdrawals&request=${ref}`}
      />
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    ...view,
    rerange: (value: typeof wide) => view.rerender(tree(value)),
    rescope: (identity: WithdrawalScopeValue) => view.rerender(tree(filters, identity)),
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe('wallet financial history and withdrawal flow', () => {
  it('renders separate authoritative balance and sorted credit/debit rows; release detail has no statement navigation', async () => {
    const current = fixture();
    const request = seed(current);
    mount(current.transport);
    const balance = await screen.findByRole('article', { name: 'สรุปยอดพร้อมถอน' });
    await waitFor(() => expect(within(balance).getByText('฿15,000')).toBeVisible());
    const list = await screen.findByRole('list', { name: 'รายการเงินเข้า–ออก' });
    const rows = within(list).getAllByRole('listitem');
    expect(
      within(rows[0]).getByRole('link', { name: `ดูรายการถอน ${request.requestRef}` }),
    ).toBeVisible();
    expect(within(list).getAllByText('คอมมิชชันเข้ายอดพร้อมถอน')).toHaveLength(2);
    fireEvent.click(within(list).getAllByRole('button', { name: /ดูรายการเงินเข้า/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'เงินเข้ายอดพร้อมถอน' });
    expect(within(dialog).getByText('วันที่เงินเข้า')).toBeVisible();
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(screen.queryByText('ใบสรุปงวดเดิม')).toBeNull();
  });
  it('defaults to today minus seven through today inclusive, independently of the balance', async () => {
    const current = fixture();
    mount(current.transport, null);
    const range = defaultWalletDateRange(new Date());
    expect(screen.getByRole('group', { name: 'ช่วงวันที่แสดงรายการ' })).toHaveTextContent(
      `${dateLabel(range.displayedFromDate)} – ${dateLabel(range.displayedToInclusiveDate)}`,
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('article', { name: 'สรุปยอดพร้อมถอน' })).getByText('฿20,000'),
      ).toBeVisible(),
    );
  });
  it('date filters do not change balance and invalid dates cannot masquerade as empty history', async () => {
    const current = fixture();
    seed(current);
    const view = mount(current.transport);
    await screen.findByRole('list', { name: 'รายการเงินเข้า–ออก' });
    view.rerange({ ...wide, from: '2025-01-01', toExclusive: '2025-02-01' });
    expect(screen.getByText('ไม่มีรายการในช่วงวันที่นี้')).toBeVisible();
    expect(
      within(screen.getByRole('article', { name: 'สรุปยอดพร้อมถอน' })).getByText('฿15,000'),
    ).toBeVisible();
    view.rerange({ ...wide, from: 'invalid' });
    expect(screen.getByRole('alert')).toHaveTextContent('กรุณาเลือกช่วงวันที่');
    expect(screen.queryByText('ไม่มีรายการในช่วงวันที่นี้')).toBeNull();
  });
  it('retains valid withdrawals on credit read failure and labels the result incomplete', async () => {
    const current = fixture();
    const request = seed(current);
    mount({
      ...current.transport,
      periods: async () => {
        throw Error('outage');
      },
    });
    expect(
      await screen.findByRole('link', { name: `ดูรายการถอน ${request.requestRef}` }),
    ).toBeVisible();
    expect(screen.getByText('รายการยังไม่ครบ: โหลดเงินเข้าไม่สำเร็จ')).toBeVisible();
    expect(screen.queryByText('ไม่มีรายการในช่วงวันที่นี้')).toBeNull();
  });
  it('keeps undated release information unknown outside the date filter', async () => {
    const current = fixture();
    const periods = current.controller.periods();
    periods.released[0] = { ...periods.released[0], releasedAt: null, releasedAmount: null };
    mount(
      { ...current.transport, periods: async () => periods },
      { ...wide, from: '2025-01-01', toExclusive: '2025-02-01' },
    );
    await screen.findByText('รายการที่ยังไม่ระบุวันที่');
    expect(screen.getByLabelText('ยังไม่มีข้อมูลยอดที่ปล่อย')).toHaveTextContent('—');
    expect(screen.getByText('ยังไม่มีวันที่จากต้นทาง')).toBeVisible();
  });
  it('opens amount directly despite another active transaction, locks same-tick confirmation and starts processing', async () => {
    const current = fixture();
    seed(current);
    const submit = vi.fn(current.transport.submit);
    mount({ ...current.transport, submit });
    const button = await screen.findByRole('button', { name: 'ถอนเงิน' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(screen.getByRole('textbox', { name: 'ยอดที่ขอถอน (บาท)' })).toBeVisible();
    expect(screen.queryByText('คำขอที่ยังดำเนินการ')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    const confirm = await screen.findByRole('button', { name: 'ยืนยันถอนเงิน' });
    await waitFor(() => expect(confirm).toBeEnabled());
    act(() => {
      confirm.click();
      confirm.click();
    });
    await screen.findByRole('heading', { name: 'กำลังดำเนินการโอน' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(current.controller.list().items[0].status).toBe('processing');
    expect(screen.queryByText('รับคำขอถอนแล้ว')).toBeNull();
  });
  it('never renders another scope’s late private list', async () => {
    const current = fixture();
    const request = seed(current);
    const hold = deferred<unknown>();
    const view = mount({ ...current.transport, list: () => hold.promise });
    view.rescope({ ...scope, partnerId: 'other-partner' });
    await act(async () => hold.resolve(current.controller.list()));
    expect(screen.queryByRole('link', { name: `ดูรายการถอน ${request.requestRef}` })).toBeNull();
  });
});
describe('paid proof download', () => {
  it('revalidates a paid detail once before download and passes its cancellation signal', async () => {
    const current = fixture();
    const request = seed(current, true);
    const detail = vi.fn(current.transport.detail);
    render(
      <WithdrawalProofButton
        scope={scope}
        transport={{ ...current.transport, detail }}
        request={request}
      />,
    );
    const button = screen.getByRole('button', {
      name: `ดาวน์โหลดหลักฐานการโอน ${request.requestRef}`,
    });
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(detail).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][0].request.requestRef).toBe(request.requestRef);
    expect(download.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
  });
  it('has no proof action for a processing transaction', () => {
    const current = fixture();
    const request = seed(current);
    const view = render(
      <WithdrawalProofButton scope={scope} transport={current.transport} request={request} />,
    );
    expect(view.container).toBeEmptyDOMElement();
    expect(download).not.toHaveBeenCalled();
  });
  it('aborts generation immediately on unmount and suppresses stale success/error UI', async () => {
    const current = fixture();
    const request = seed(current, true);
    const hold = deferred<void>();
    download.mockReturnValue(hold.promise);
    const view = render(
      <WithdrawalProofButton scope={scope} transport={current.transport} request={request} />,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const signal = download.mock.calls[0][3] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => hold.resolve());
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('rejects a foreign fresh detail instead of saving a proof', async () => {
    const current = fixture();
    const request = seed(current, true);
    const foreign = current.controller.detail(request.requestRef);
    if (foreign.state !== 'found') throw Error('detail');
    foreign.detail.request.scope = { ...scope, partnerId: 'foreign' };
    render(
      <WithdrawalProofButton
        scope={scope}
        transport={{ ...current.transport, detail: async () => foreign }}
        request={request}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('ดาวน์โหลดหลักฐานไม่สำเร็จ');
    expect(download).not.toHaveBeenCalled();
  });
});
