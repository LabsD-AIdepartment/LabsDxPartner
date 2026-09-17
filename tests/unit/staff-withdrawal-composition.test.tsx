import { afterEach as restoreBrandFlag } from 'vitest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { OperationsPreview } from '../../dev/OperationsPreview';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';
import { TransactionsPreview } from '../../dev/TransactionsPreview';
import { StaffShell, nativeStaffRoutes } from '@/features/operations/StaffShell';
import { browserWithdrawalStorage } from '../../dev/withdrawals/browser-storage';
import { getWithdrawalRuntime, releaseWithdrawalRuntime } from '../../dev/withdrawals/transport';
import { previewScopeFor } from '../../dev/withdrawals/navigation';
import { SCENARIO_NAMES } from '../../dev/withdrawals/scenarios';
import {
  readStaffWithdrawalFilters,
  staffWithdrawalHref,
} from '../../dev/withdrawals/WithdrawalPreviewNavigation';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
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
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.unstubAllGlobals();
});
beforeEach(() => {
  for (const scenario of SCENARIO_NAMES)
    for (const identity of ['a', 'b'])
      releaseWithdrawalRuntime(browserWithdrawalStorage, previewScopeFor(scenario, identity));
  window.history.replaceState({}, '', '/?devtools=1');
});
function runtime(scenario = 'golden', identity = 'a', latencyMs = 0) {
  return getWithdrawalRuntime({
    scope: previewScopeFor(scenario, identity),
    storage: browserWithdrawalStorage,
    latencyMs,
  });
}
function seed(scenario = 'golden', identity = 'a', latencyMs = 0, legacy = false) {
  const authority = runtime(scenario, identity, latencyMs);
  if (legacy) authority.controller.setSubmitInitiationMode('legacy_manual');
  const quote = authority.controller.quote('500000');
  if (quote.state !== 'quoted') throw new Error('Expected real controller quote');
  const result = authority.controller.submit({
    scope: authority.controller.currentScope(),
    idempotencyKey: crypto.randomUUID(),
    quoteId: quote.quoteId,
    gross: quote.gross,
    net: quote.net,
    bindings: quote.bindings,
  });
  if (result.outcome === 'rejected') throw new Error(result.detail);
  return { authority, request: result.request };
}
function query(href: string) {
  return new URL(href, 'http://localhost').search.slice(1);
}
function details() {
  return within(screen.getByRole('article', { name: 'รายละเอียดคำขอถอน' }));
}
async function press(name: string) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
async function summary() {
  const card = await screen.findByRole('article', { name: 'สรุปยอดพร้อมถอน' });
  await waitFor(() => expect(within(card).queryByText('กำลังตรวจสอบยอดพร้อมถอน')).toBeNull());
  return within(card);
}

describe('WU03 real-runtime staff composition', () => {
  it('does not touch storage during server rendering and leaves native requests strictly opt-in', () => {
    const getItem = vi.spyOn(browserWithdrawalStorage, 'getItem');
    expect(renderToString(<OperationsPreview view="requests" />)).toContain(
      'กำลังเตรียมข้อมูลเจ้าหน้าที่จำลอง',
    );
    expect(getItem).not.toHaveBeenCalled();
    const view = render(
      <StaffShell view="periods" routes={nativeStaffRoutes(false)}>
        native
      </StaffShell>,
    );
    expect(screen.queryByRole('link', { name: 'คำขอถอนเงิน' })).toBeNull();
    view.rerender(<StaffShell view="periods">fallback</StaffShell>);
    expect(screen.queryByRole('link', { name: 'คำขอถอนเงิน' })).toBeNull();
    view.rerender(
      <StaffShell view="requests" routes={{ requests: '/ops-preview/requests' }}>
        preview
      </StaffShell>,
    );
    expect(screen.getByRole('link', { name: 'คำขอถอนเงิน' })).toHaveAttribute(
      'href',
      '/ops-preview/requests',
    );
    expect(nativeStaffRoutes(true)).toEqual({
      partners: '/ops/access',
      ads: '/ops/ads',
      periods: '/ops/periods',
    });
  });

  it('retains default operations/periods and opts into withdrawal periods only through the query lane', async () => {
    const view = render(<OperationsPreview />);
    expect(screen.getByText('Operations journey preview')).toBeVisible();
    expect(screen.queryByText('Staff withdrawal preview')).toBeNull();
    view.rerender(<OperationsPreview view="periods" />);
    expect(screen.getByText('Operations journey preview')).toBeVisible();
    expect(screen.queryByRole('article', { name: 'งวดและการปล่อยยอด' })).toBeNull();
    view.rerender(
      <OperationsPreview view="periods" search="view=withdrawals&scenario=golden&identity=a" />,
    );
    expect(await screen.findByText('Staff withdrawal preview')).toBeVisible();
    expect(await screen.findByRole('article', { name: 'งวดและการปล่อยยอด' })).toBeVisible();
  });

  it('creates a partner request, visits staff detail, simulates processing/paid, and returns to the same partner/report balance', async () => {
    // This regression intentionally exercises the retained opt-in brand return context.
    vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true');
    const authority = runtime('applies-wht', 'b');
    const view = render(
      <WithdrawalPreview search="scenario=applies-wht&identity=b&from=2026-08-01&toExclusive=2026-09-01&brand=Axtion" />,
    );
    expect((await summary()).getByText('฿20,000')).toBeVisible();
    await press('ถอนเงิน');
    fireEvent.click(screen.getByRole('radio', { name: 'ระบุจำนวนเงิน' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '5000' } });
    await press('ตรวจสอบรายการ');
    await press('ยืนยันถอนเงิน');
    const partnerDetailHref = (
      await screen.findByRole('link', { name: 'ดูรายละเอียดคำขอ' })
    ).getAttribute('href')!;
    const original = authority.controller.list().items[0];
    view.rerender(<TransactionsPreview search={query(partnerDetailHref)} />);
    const staffHref = (await screen.findByRole('link', { name: 'เจ้าหน้าที่จำลอง' })).getAttribute(
      'href',
    )!;
    expect(new URL(staffHref, 'http://localhost').searchParams.get('identity')).toBe('b');
    view.rerender(<OperationsPreview view="requests" search={query(staffHref)} />);
    await screen.findByRole('article', { name: 'รายละเอียดคำขอถอน' });
    expect(details().getByText(original.requestRef)).toBeVisible();
    expect(details().getAllByText('฿5,000.00').length).toBeGreaterThan(0);
    expect(details().getByText('฿4,850.00')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeNull();
    expect(original.status).toBe('processing');
    await waitFor(() => expect(screen.getByText('กำลังดำเนินการโอน')).toBeVisible());
    await press('จำลองโอนสำเร็จ');
    await waitFor(() => expect(screen.getByText('โอนเงินแล้ว')).toBeVisible());
    const partnerHref = screen
      .getByRole('link', { name: 'ยอดพร้อมถอนของพาร์ตเนอร์ B' })
      .getAttribute('href')!;
    expect(new URL(partnerHref, 'http://localhost').searchParams.get('brand')).toBe('Axtion');
    expect(new URL(partnerHref, 'http://localhost').searchParams.get('from')).toBe('2026-08-01');
    view.rerender(<WithdrawalPreview search={query(partnerHref)} />);
    expect((await summary()).getByText('฿15,000')).toBeVisible();
    const balance = authority.controller.summary().balance;
    expect(balance.state).toBe('known');
    if (balance.state === 'known') {
      expect(balance.reserved.minor).toBe('0');
      expect(balance.settled.minor).toBe('500000');
    }
  });

  it.each([
    ['จำลองคำขอไม่สำเร็จ', 'failed', '0', '2000000'],
    ['จำลองยังไม่ทราบผลโอน', 'reconciling', '500000', '1500000'],
  ])('keeps actual money semantics for %s', async (button, status, reserve, available) => {
    const { authority, request } = seed();
    render(
      <OperationsPreview
        view="requests"
        search={`scenario=golden&identity=a&request=${request.requestRef}`}
      />,
    );
    await press(button);
    await waitFor(() => expect(authority.controller.list().items[0].status).toBe(status));
    const balance = authority.controller.summary().balance;
    if (balance.state !== 'known') throw new Error('Expected known balance');
    expect(balance.reserved.minor).toBe(reserve);
    expect(balance.available.minor).toBe(available);
    await waitFor(() => expect(details().queryByText('รับคำขอถอนแล้ว')).toBeNull());
    expect(details().queryByText('โอนเงินแล้ว')).toBeNull();
    expect(screen.queryByRole('button', { name: /ส่งซ้ำ|โอนอีกครั้ง/ })).toBeNull();
  });

  it('retains cancellation for an explicit legacy requested record without granting staff cancellation', async () => {
    const { authority, request } = seed('golden', 'a', 0, true);
    expect(request.status).toBe('requested');
    const view = render(
      <OperationsPreview
        view="requests"
        search={`scenario=golden&identity=a&request=${request.requestRef}`}
      />,
    );
    expect(await screen.findByText('รอดำเนินการ')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeNull();
    view.rerender(
      <TransactionsPreview
        search={`view=withdrawals&scenario=golden&identity=a&request=${request.requestRef}`}
      />,
    );
    await press('ยกเลิกคำขอถอน');
    await screen.findByRole('dialog', { name: 'ยืนยันการยกเลิกคำขอถอน' });
    await press('ยืนยันยกเลิกคำขอ');
    await waitFor(() => expect(authority.controller.list().items[0].status).toBe('cancelled'));
    const balance = authority.controller.summary().balance;
    if (balance.state !== 'known') throw new Error('Expected known balance');
    expect(balance.reserved.minor).toBe('0');
    expect(balance.available.minor).toBe('2000000');
    expect(balance.settled.minor).toBe('0');
  });

  it('releases an eligible period once with no transfer/request and preserves period control focus on notification', async () => {
    const authority = runtime();
    const release = vi.spyOn(authority.controller, 'releaseNextPeriod');
    render(
      <OperationsPreview view="periods" search="view=withdrawals&scenario=golden&identity=a" />,
    );
    const button = await screen.findByRole('button', { name: 'จำลองปล่อยยอดงวดที่เข้าเกณฑ์ถัดไป' });
    await waitFor(() => expect(button).toBeEnabled());
    const target = screen.getByRole('combobox', { name: 'พาร์ตเนอร์เป้าหมายของ DEV' });
    target.focus();
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(button).toBeDisabled());
    expect(release).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: 'พาร์ตเนอร์เป้าหมายของ DEV' })).toBe(target);
    expect(target).toHaveFocus();
    await screen.findByText('ไม่มีงวดที่เข้าเกณฑ์รอปล่อยยอดในข้อมูลนี้');
    expect(authority.controller.list().items).toEqual([]);
    const balance = authority.controller.summary().balance;
    if (balance.state !== 'known') throw new Error('Expected known balance');
    expect(balance.available.minor).toBe('3000000');
    expect(balance.settled.minor).toBe('0');
    expect(authority.controller.summary().currentPeriodPending?.minor).toBe('700000');
    expect(screen.getByText('ยังไม่ได้เชื่อมต่อระบบโอนเงินจริง')).toBeVisible();
  });

  it('shows unknown source/restore failures as period read errors, never empty or releasable', async () => {
    const view = render(
      <OperationsPreview
        view="periods"
        search="view=withdrawals&scenario=balance-unknown&identity=a"
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดข้อมูลงวดไม่สำเร็จ');
    expect(screen.queryByText('ยังไม่มีงวดที่ปล่อยยอดในข้อมูลนี้')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'จำลองปล่อยยอดงวดที่เข้าเกณฑ์ถัดไป' }),
    ).toBeDisabled();
    view.unmount();
    const getItem = vi.spyOn(browserWithdrawalStorage, 'getItem').mockImplementation(() => {
      throw new Error('unreadable');
    });
    render(
      <OperationsPreview view="periods" search="view=withdrawals&scenario=golden&identity=a" />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดข้อมูลงวดไม่สำเร็จ');
    expect(
      screen.getByRole('button', { name: 'จำลองปล่อยยอดงวดที่เข้าเกณฑ์ถัดไป' }),
    ).toBeDisabled();
    getItem.mockRestore();
  });

  it('shows an incomplete all-partner queue for a B outage but a valid A-only queue independently', async () => {
    const a = seed('golden', 'a');
    const b = runtime('golden', 'b');
    b.controller.setReadError(true);
    render(<OperationsPreview view="requests" search="scenario=golden&identity=a" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('รายการนี้ยังไม่ครบ');
    expect(
      screen.getByRole('link', {
        name: `ดูรายละเอียดคำขอ ${a.request.requestRef} ของ พาร์ทเนอร์ A`,
      }),
    ).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'พาร์ตเนอร์' }), {
      target: { value: 'a' },
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(
      await screen.findByRole('list', { name: 'รายการคำขอถอนเงินของพาร์ตเนอร์' }),
    ).toBeVisible();
  });

  it('sends one captured command for a batched double click and suppresses late A messages in B', async () => {
    const a = seed('golden', 'a', 120);
    const b = seed('golden', 'b');
    const outcome = vi.spyOn(a.authority.transport, 'outcome');
    const view = render(
      <OperationsPreview
        view="requests"
        search={`identity=a&scenario=golden&request=${a.request.requestRef}`}
      />,
    );
    const button = await screen.findByRole('button', { name: 'จำลองโอนสำเร็จ' });
    await waitFor(() => expect(button).toBeEnabled());
    const expectedRevision = a.authority.controller.summary().revision;
    act(() => {
      button.click();
      button.click();
    });
    expect(outcome).toHaveBeenCalledTimes(1);
    expect(outcome.mock.calls[0][0].command).toMatchObject({
      requestRef: a.request.requestRef,
      expectedRevision,
      scope: a.request.scope,
      target: 'paid',
    });
    view.rerender(
      <OperationsPreview
        view="requests"
        search={`identity=b&scenario=golden&request=${b.request.requestRef}`}
      />,
    );
    await waitFor(() => expect(details().getByText(b.request.requestRef)).toBeVisible());
    await waitFor(() => expect(a.authority.controller.list().items[0].status).toBe('paid'));
    expect(outcome.mock.calls[0][0].signal.aborted).toBe(false);
    expect(b.authority.controller.list().items[0].status).toBe('processing');
    expect(screen.queryByText('บันทึกผลจำลองแล้ว โปรดดูสถานะคำขอล่าสุด')).toBeNull();
    expect(screen.getByText('กำลังดำเนินการโอน')).toBeVisible();
  });

  it('reset fences an in-flight outcome and clears its stale busy/result notice', async () => {
    const { authority, request } = seed('golden', 'a', 120);
    const outcome = vi.spyOn(authority.transport, 'outcome');
    render(
      <OperationsPreview
        view="requests"
        search={`identity=a&scenario=golden&request=${request.requestRef}`}
      />,
    );
    await press('จำลองโอนสำเร็จ');
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มข้อมูลจำลองขอบเขตนี้ใหม่' }));
    expect(screen.queryByText('กำลังส่งผลจำลองของคำขอเดิม…')).toBeNull();
    const result = await outcome.mock.results[0].value;
    expect(result).toMatchObject({ outcome: 'rejected', code: 'stale_revision' });
    await screen.findByText('ไม่พบคำขอถอนเงินในขอบเขตนี้');
    expect(authority.controller.list().items).toEqual([]);
    expect(screen.queryByText('บันทึกผลจำลองแล้ว โปรดดูสถานะคำขอล่าสุด')).toBeNull();
  });

  it('keeps queue filter focus during a real runtime version update and reports invalid filters', async () => {
    const { authority, request } = seed();
    render(<OperationsPreview view="requests" search="identity=a&scenario=golden" />);
    await screen.findByRole('list', { name: 'รายการคำขอถอนเงินของพาร์ตเนอร์' });
    const field = screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่');
    field.focus();
    act(() => {
      authority.controller.markPaid(request.requestRef);
    });
    expect(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่')).toBe(field);
    expect(field).toHaveFocus();
    await screen.findByText('โอนเงินแล้ว');
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('ถึงก่อนวันที่ (ไม่รวมวันนี้)'), {
      target: { value: '2026-09-19' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น');
    expect(screen.queryByText('ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้')).toBeNull();
  });

  it('preserves staff display filters through detail/back while allowlisting scope and safe partner return', () => {
    const search =
      'scenario=golden&identity=b&partner=a&status=failed&requestedFrom=2026-09-01&requestedToExclusive=2026-10-01&returnTo=https://evil.test';
    const filters = readStaffWithdrawalFilters(search);
    const detail = staffWithdrawalHref(search, { identity: 'a', requestRef: 'request-a' });
    const back = staffWithdrawalHref(query(detail));
    expect(readStaffWithdrawalFilters(query(back))).toEqual(filters);
    expect(new URL(detail, 'http://localhost').searchParams.get('request')).toBe('request-a');
    expect(new URL(back, 'http://localhost').searchParams.has('request')).toBe(false);
    expect(detail).not.toContain('evil.test');
    const invalid = staffWithdrawalHref(
      'scenario=foreign&identity=arbitrary&partner=foreign&status=bad',
    );
    expect(new URL(invalid, 'http://localhost').searchParams.get('scenario')).toBe('golden');
    expect(new URL(invalid, 'http://localhost').searchParams.get('identity')).toBe('a');
    expect(readStaffWithdrawalFilters(query(invalid))).toMatchObject({
      partner: 'foreign',
      status: 'bad',
    });
  });
});

restoreBrandFlag(() => vi.unstubAllEnvs());
