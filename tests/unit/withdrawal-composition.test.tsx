import { beforeEach as brandBeforeEach, afterEach as brandAfterEach, vi as brandVi } from 'vitest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';
import { TransactionsPreview } from '../../dev/TransactionsPreview';
import { browserWithdrawalStorage } from '../../dev/withdrawals/browser-storage';
import { getWithdrawalRuntime, releaseWithdrawalRuntime } from '../../dev/withdrawals/transport';
import { previewScopeFor } from '../../dev/withdrawals/navigation';
import { SCENARIO_NAMES } from '../../dev/withdrawals/scenarios';
import { formatMinor } from '@/shared/ui/format-money';

// Only browser primitives/router are stubbed. Every withdrawal operation below uses the real
// shared runtime, store, model loader and transport; no replacement financial store or mock API.
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
function runtime(scenario = 'golden', identity = 'a') {
  return getWithdrawalRuntime({
    scope: previewScopeFor(scenario, identity),
    storage: browserWithdrawalStorage,
    latencyMs: 150,
  });
}
function seed(scenario = 'golden', identity = 'a', minor = '500000', legacy = false) {
  const current = runtime(scenario, identity);
  if (legacy) current.controller.setSubmitInitiationMode('legacy_manual');
  const quote = current.controller.quote(minor);
  if (quote.state !== 'quoted') throw new Error('Fixture quote unavailable');
  const result = current.controller.submit({
    scope: current.controller.currentScope(),
    idempotencyKey: crypto.randomUUID(),
    quoteId: quote.quoteId,
    gross: quote.gross,
    net: quote.net,
    bindings: quote.bindings,
  });
  if (result.outcome === 'rejected') throw new Error(result.detail);
  return { current, request: result.request };
}
function searchOf(href: string) {
  return new URL(href, 'http://localhost').search.slice(1);
}
async function readySummary() {
  const card = await screen.findByRole('article', { name: 'สรุปยอดพร้อมถอน' });
  await waitFor(() => expect(within(card).queryByText('กำลังตรวจสอบยอดพร้อมถอน')).toBeNull());
  return within(card);
}
async function makeRequest(amount: string | 'all' = '5000') {
  const start = await screen.findByRole('button', { name: 'ถอนเงิน' });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  if (amount === 'all') fireEvent.click(screen.getByRole('radio', { name: 'ถอนทั้งหมด' }));
  if (amount !== 'all') {
    fireEvent.click(screen.getByRole('radio', { name: 'ระบุจำนวนเงิน' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: amount } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
  const confirm = await screen.findByRole('button', { name: 'ยืนยันถอนเงิน' });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  return await screen.findByRole('link', { name: 'ดูรายละเอียดคำขอ' });
}
async function cancelRequest() {
  const cancel = await screen.findByRole('button', { name: 'ยกเลิกคำขอถอน' });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  const confirm = screen.getByRole('button', { name: 'ยืนยันยกเลิกคำขอ' });
  fireEvent.click(confirm);
}

describe('WU02 actual-runtime preview composition', () => {
  it('does not resolve browser storage/runtime while rendering the server shell', () => {
    const read = vi.spyOn(browserWithdrawalStorage, 'getItem');
    const html = renderToString(<WithdrawalPreview search="scenario=golden&identity=b" />);
    expect(html).toContain('กำลังเตรียมข้อมูลจำลอง');
    expect(read).not.toHaveBeenCalled();
  });

  it('creates a partial request, navigates history/detail, cancels it, and returns to the same authoritative summary and report', async () => {
    const search =
      'scenario=applies-wht&identity=b&from=2026-08-01&toExclusive=2026-09-01&brand=Axtion&origin=overview';
    // Deliberate retained legacy cancellation: fresh default submissions now auto-initiate.
    runtime('applies-wht', 'b').controller.setSubmitInitiationMode('legacy_manual');
    const overview = render(<WithdrawalPreview search={search} />);
    const summary = await readySummary();
    expect(summary.getByText('฿20,000')).toBeVisible();
    const resultLink = await makeRequest();
    const detailHref = resultLink.getAttribute('href')!;
    const authority = runtime('applies-wht', 'b');
    const original = authority.controller.list().items[0];
    expect(original.gross.minor).toBe('500000');
    expect(new URL(detailHref, 'http://localhost').searchParams.get('request')).toBe(
      original.requestRef,
    );
    const historyHref = screen.getAllByRole('link', { name: 'Wallet' })[0].getAttribute('href')!;
    await waitFor(() => expect(summary.getByText('฿15,000')).toBeVisible());
    expect(summary.getByText('฿7,000')).toBeVisible();
    overview.unmount();
    const history = render(<TransactionsPreview search={searchOf(historyHref)} />);
    const row = await screen.findByRole('link', {
      name: `ดูรายละเอียดคำขอ ${original.requestRef}`,
    });
    expect(within(row).getByText(formatMinor(original.net.minor, false))).toBeVisible();
    const rowHref = row.getAttribute('href')!;
    history.unmount();
    const detail = render(<TransactionsPreview search={searchOf(rowHref)} />);
    await screen.findByText(original.requestRef);
    expect(screen.getByText(original.beneficiary.maskedAccount)).toBeVisible();
    expect(runtime('applies-wht', 'b')).toBe(authority);
    await cancelRequest();
    await waitFor(() => expect(authority.controller.list().items[0].status).toBe('cancelled'));
    await screen.findAllByText('คำขอถูกยกเลิกแล้ว');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอ' })).toBeEnabled(),
    );
    expect(screen.getByText('ยืนยันการยกเลิกคำขอถอนแล้ว')).toBeVisible();
    expect(screen.queryByText(/กำลังโหลดสถานะและยอดล่าสุด/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'ยอดพร้อมถอน' })).toBeNull();
    const summaryHref = screen.getAllByRole('link', { name: 'Overview' })[0].getAttribute('href')!;
    const params = new URL(summaryHref, 'http://localhost').searchParams;
    expect(params.get('scenario')).toBe('applies-wht');
    expect(params.get('identity')).toBe('b');
    expect(params.get('from')).toBe('2026-08-01');
    expect(params.get('brand')).toBe('Axtion');
    detail.unmount();
    render(<WithdrawalPreview search={searchOf(summaryHref)} />);
    const restored = await readySummary();
    expect(restored.getByText('฿20,000')).toBeVisible();
    expect(authority.controller.summary().balance).toMatchObject({
      state: 'known',
      reserved: { minor: '0' },
    });
    expect(restored.getByText('ยังไม่มีรายการถอนสำเร็จ')).toBeVisible();
    expect(authority.controller.list().items[0].requestRef).toBe(original.requestRef);
  });

  it('creates partial then all remaining funds and retains every record in history after reload', async () => {
    const view = render(<WithdrawalPreview />);
    await makeRequest();
    const updatedSummary = await readySummary();
    await waitFor(() => expect(updatedSummary.getByText('฿15,000')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'เสร็จสิ้น' }));
    await makeRequest('all');
    await waitFor(() => expect(runtime().controller.list().items).toHaveLength(2));
    const requests = runtime().controller.list().items;
    expect(requests.map((r) => r.gross.minor).sort()).toEqual(['1500000', '500000']);
    expect(requests.every((r) => r.status === 'processing')).toBe(true);
    view.unmount();
    const restored = render(<WithdrawalPreview />);
    const summary = await readySummary();
    expect(summary.getByText('฿0')).toBeVisible();
    // History owns older requests; the withdraw action no longer opens a resume-list selector.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runtime().controller.summary().readiness.requestGate).not.toBe('ready');
    const historyHref = screen.getAllByRole('link', { name: 'Wallet' })[0].getAttribute('href')!;
    expect(runtime().controller.summary().balance).toMatchObject({
      state: 'known',
      available: { minor: '0' },
      reserved: { minor: '2000000' },
    });
    restored.unmount();
    render(<TransactionsPreview search={searchOf(historyHref)} />);
    for (const request of requests)
      await screen.findByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` });
    expect(screen.getByRole('list', { name: 'รายการคำขอถอนเงิน' }).children).toHaveLength(2);
  });

  it('keeps history filter URLs through detail/back and keeps invalid filters visibly invalid', async () => {
    const { request, current } = seed();
    const revision = current.controller.summary().revision;
    const returnTo =
      '/withdrawal-preview?scenario=golden&identity=a&from=2026-07-01&toExclusive=2026-09-01&brand=Zenova';
    window.history.replaceState({}, '', '/transactions-preview');
    const view = render(
      <TransactionsPreview
        search={
          'view=withdrawals&scenario=golden&identity=a&returnTo=' + encodeURIComponent(returnTo)
        }
      />,
    );
    await screen.findByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` });
    fireEvent.change(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่'), {
      target: { value: '2000-01-01' },
    });
    fireEvent.change(screen.getByLabelText('ถึงก่อนวันที่ (ไม่รวมวันนี้)'), {
      target: { value: '2100-01-01' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะคำขอถอน' }), {
      target: { value: 'processing' },
    });
    const href = screen
      .getByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` })
      .getAttribute('href')!;
    const query = new URL(href, 'http://localhost').searchParams;
    expect(query.get('requestedFrom')).toBe('2000-01-01');
    expect(query.get('status')).toBe('processing');
    expect(query.get('returnTo')).toBe(returnTo);
    expect(current.controller.summary().revision).toBe(revision);
    view.unmount();
    const detail = render(<TransactionsPreview search={searchOf(href)} />);
    const back = await screen.findByRole('link', { name: /กลับคำขอถอนเงินทั้งหมด/ });
    const backHref = back.getAttribute('href')!;
    expect(new URL(backHref, 'http://localhost').searchParams.get('request')).toBeNull();
    detail.unmount();
    const history = render(<TransactionsPreview search={searchOf(backHref)} />);
    await screen.findByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` });
    expect(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่')).toHaveValue('2000-01-01');
    history.rerender(<TransactionsPreview search={searchOf(backHref) + '&requestedFrom=wrong'} />);
    // URLSearchParams takes the first duplicate; use a single invalid field for the route check.
    history.rerender(
      <TransactionsPreview search="view=withdrawals&requestedFrom=wrong&status=invalid-status" />,
    );
    await screen.findByRole('alert');
    expect(
      screen.getByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` }),
    ).toBeVisible();
    expect(screen.queryByText('ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้')).toBeNull();
  });

  it('keeps A/B identities isolated, clears an old request on a scope switch, and ignores actor strings', async () => {
    const { request } = seed('golden', 'a');
    render(
      <TransactionsPreview
        search={`view=withdrawals&identity=a&request=${request.requestRef}&payerId=injected&userId=injected`}
      />,
    );
    await screen.findByText(request.requestRef);
    fireEvent.change(screen.getByRole('combobox', { name: 'ขอบเขตจำลอง' }), {
      target: { value: 'b' },
    });
    expect(screen.queryByText(request.requestRef)).toBeNull();
    await screen.findByText('ยังไม่มีคำขอถอนเงิน');
    expect(runtime('golden', 'b').controller.currentScope().payerId).toBe('SYNTH-payer-b');
    expect(runtime('golden', 'b').controller.list().items).toHaveLength(0);
    fireEvent.change(screen.getByRole('combobox', { name: 'ขอบเขตจำลอง' }), {
      target: { value: 'a' },
    });
    await screen.findByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` });
  });

  it('reattaches scenario and identity when earnings filters change without changing the withdrawal authority', async () => {
    window.history.replaceState({}, '', '/withdrawal-preview');
    render(<WithdrawalPreview search="scenario=applies-wht&identity=b" />);
    const summary = await readySummary();
    const authority = runtime('applies-wht', 'b');
    const revision = authority.controller.summary().revision;
    fireEvent.click(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'เดือน 1' }), {
      target: { value: '08' },
    });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' })).getByRole('button', {
        name: '2026-08-01',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'แบรนด์' }), {
      target: { value: 'Axtion' },
    });
    expect(new URLSearchParams(window.location.search).get('scenario')).toBe('applies-wht');
    expect(new URLSearchParams(window.location.search).get('identity')).toBe('b');
    const href = screen.getAllByRole('link', { name: 'Wallet' })[0].getAttribute('href')!;
    const returnTo = new URL(href, 'http://localhost').searchParams.get('returnTo')!;
    expect(new URL(returnTo, 'http://localhost').searchParams.get('brand')).toBe('Axtion');
    expect(runtime('applies-wht', 'b')).toBe(authority);
    expect(authority.controller.summary().revision).toBe(revision);
    expect((await readySummary()).getByText('฿20,000')).toBeVisible();
  });

  it.each(['', 'view=periods', 'view=withdrawals&request=wr-foreign'])(
    'retains legacy statements for no-query/periods and gives statement paths precedence: %s',
    async (search) => {
      const segments = search.includes('withdrawals') ? ['statement-1'] : [];
      render(<TransactionsPreview segments={segments} search={search} />);
      expect(screen.getByRole('complementary', { name: 'ชุดตรวจรอบจ่าย' })).toBeVisible();
      expect(screen.queryByRole('complementary', { name: 'ชุดตรวจการถอนเงินจำลอง' })).toBeNull();
      expect(screen.getByText(/ใบสรุปงวดเดิมเป็นข้อมูลตัวอย่างแยกต่างหาก/)).toBeVisible();
      if (segments.length) await screen.findByRole('heading', { name: 'รายละเอียดรอบจ่าย' });
      else await screen.findByLabelText('สถานะรอบจ่าย');
      expect(screen.queryByRole('article', { name: 'ประวัติคำขอถอนเงิน' })).toBeNull();
    },
  );

  it('refreshes a visible summary and detail from the same runtime when dev controls change status', async () => {
    const { request, current } = seed();
    const overview = render(<WithdrawalPreview />);
    const summary = await readySummary();
    expect(summary.getByText('฿15,000')).toBeVisible();
    expect(current.controller.summary().balance).toMatchObject({
      state: 'known',
      reserved: { minor: '500000' },
    });
    expect(summary.getByText('ยังไม่มีรายการถอนสำเร็จ')).toBeVisible();
    const detail = render(
      <TransactionsPreview search={`view=withdrawals&request=${request.requestRef}`} />,
    );
    await within(detail.container).findByText(request.requestRef);
    fireEvent.click(within(detail.container).getByRole('button', { name: 'จำลองโอนสำเร็จ' }));
    await within(detail.container).findAllByText('โอนเงินแล้ว');
    await waitFor(() => expect(summary.getByText('฿5,000')).toBeVisible());
    expect(current.controller.summary().balance).toMatchObject({
      state: 'known',
      reserved: { minor: '0' },
    });
    expect(summary.getByText('฿15,000')).toBeVisible();
    expect(current.controller.list().items[0].status).toBe('paid');
    overview.unmount();
    detail.unmount();
  });

  it('refreshes immediately on read-error controls and restores the same data after reads recover', async () => {
    const { request } = seed();
    render(<TransactionsPreview search={`view=withdrawals&request=${request.requestRef}`} />);
    await screen.findByText(request.requestRef);
    fireEvent.click(screen.getByRole('button', { name: 'จำลองอ่านข้อมูลไม่สำเร็จ' }));
    expect(screen.queryByText(request.requestRef)).toBeNull();
    await screen.findByText('โหลดรายละเอียดคำขอไม่สำเร็จ กรุณาลองอีกครั้ง');
    fireEvent.click(screen.getByRole('button', { name: 'คืนการอ่านข้อมูล' }));
    await screen.findByText(request.requestRef);
  });

  it('keeps the same runtime when navigating away during cancellation and refreshes the mounted history on completion', async () => {
    const { request, current } = seed('golden', 'a', '500000', true);
    const detail = render(
      <TransactionsPreview search={`view=withdrawals&request=${request.requestRef}`} />,
    );
    await screen.findByText(request.requestRef);
    await cancelRequest();
    detail.unmount();
    render(<TransactionsPreview search="view=withdrawals" />);
    expect(runtime()).toBe(current);
    const row = await screen.findByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` });
    await waitFor(() => expect(within(row).getByText('คำขอถูกยกเลิกแล้ว')).toBeVisible());
    expect(current.controller.list().items[0].reserved.minor).toBe('0');
  });

  it('keeps a submitted request alive through same-tab page disposal and shares it with the newly mounted history', async () => {
    const overview = render(<WithdrawalPreview />);
    const start = await screen.findByRole('button', { name: 'ถอนเงิน' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    fireEvent.click(screen.getByRole('radio', { name: 'ระบุจำนวนเงิน' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    const confirm = await screen.findByRole('button', { name: 'ยืนยันถอนเงิน' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    const authority = runtime();
    overview.unmount();
    render(<TransactionsPreview search="view=withdrawals" />);
    await waitFor(() => expect(authority.controller.list().items).toHaveLength(1));
    const request = authority.controller.list().items[0];
    await screen.findByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` });
    expect(runtime()).toBe(authority);
    expect(request.gross.minor).toBe('500000');
  });

  it('preserves scoped history filters across the separate periods lane and restores scope from legacy report return links', async () => {
    const { request } = seed('applies-wht', 'b');
    const returnTo =
      '/withdrawal-preview?scenario=applies-wht&identity=b&from=2026-08-01&toExclusive=2026-09-01';
    const history = render(
      <TransactionsPreview
        search={`view=withdrawals&scenario=applies-wht&identity=b&status=processing&requestedFrom=2000-01-01&returnTo=${encodeURIComponent(returnTo)}`}
      />,
    );
    await screen.findByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` });
    const detailHref = screen
      .getByRole('link', { name: `ดูรายละเอียดคำขอ ${request.requestRef}` })
      .getAttribute('href')!;
    history.rerender(<TransactionsPreview search={searchOf(detailHref)} />);
    await screen.findByText(request.requestRef);
    const periodsHref = screen.getByRole('link', { name: 'ใบสรุปงวดเดิม' }).getAttribute('href')!;
    history.unmount();
    const periods = render(<TransactionsPreview search={searchOf(periodsHref)} />);
    const back = within(screen.getByRole('navigation', { name: 'หน้าธุรกรรม' })).getByRole('link', {
      name: 'คำขอถอนเงิน',
    });
    const backParams = new URL(back.getAttribute('href')!, 'http://localhost').searchParams;
    expect(backParams.get('identity')).toBe('b');
    expect(backParams.get('scenario')).toBe('applies-wht');
    expect(backParams.get('status')).toBe('processing');
    expect(backParams.get('requestedFrom')).toBe('2000-01-01');
    periods.rerender(
      <TransactionsPreview
        segments={['statement-1']}
        search={'returnTo=' + encodeURIComponent(returnTo)}
      />,
    );
    const legacyBack = within(screen.getByRole('navigation', { name: 'หน้าธุรกรรม' })).getByRole(
      'link',
      { name: 'คำขอถอนเงิน' },
    );
    const legacyParams = new URL(legacyBack.getAttribute('href')!, 'http://localhost').searchParams;
    expect(legacyParams.get('identity')).toBe('b');
    expect(legacyParams.get('scenario')).toBe('applies-wht');
    expect(screen.getByRole('link', { name: 'กลับหน้าก่อนหน้า' })).toHaveAttribute(
      'href',
      returnTo,
    );
  });

  it('restores unresolved cancellation after a hard runtime reload and recovers the same durable key', async () => {
    const { request, current } = seed('golden', 'a', '500000', true);
    const view = render(
      <TransactionsPreview search={`view=withdrawals&request=${request.requestRef}`} />,
    );
    await screen.findByText(request.requestRef);
    fireEvent.change(screen.getByRole('combobox', { name: 'ผลการยกเลิกจำลอง' }), {
      target: { value: 'unknown' },
    });
    await cancelRequest();
    await screen.findByText(
      'ยังยืนยันผลการยกเลิกไม่ได้ โปรดตรวจสอบรายการเดิมก่อนเริ่มการยกเลิกใหม่',
    );
    const firstDetail = current.controller.detail(request.requestRef);
    if (firstDetail.state !== 'found') throw new Error('Missing request');
    const key = firstDetail.detail.pendingCancellations[0].operationKey;
    view.unmount();
    releaseWithdrawalRuntime(browserWithdrawalStorage, previewScopeFor('golden', 'a'));
    render(<TransactionsPreview search={`view=withdrawals&request=${request.requestRef}`} />);
    const recovery = await screen.findByRole('button', { name: `ตรวจสอบผลการยกเลิก ${key}` });
    await waitFor(() => expect(recovery).toBeEnabled());
    fireEvent.click(recovery);
    const restored = runtime();
    expect(restored).not.toBe(current);
    await waitFor(() => expect(recovery).toBeEnabled());
    const restoredDetail = restored.controller.detail(request.requestRef);
    if (restoredDetail.state !== 'found') throw new Error('Missing restored request');
    expect(restoredDetail.detail.pendingCancellations.map((item) => item.operationKey)).toEqual([
      key,
    ]);
    expect(restoredDetail.detail.request.reserved.minor).toBe('500000');
    expect(screen.getByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeDisabled();
  });

  it.each(['race', 'operation_failure', 'lost_after_accept'] as const)(
    'shows the actual adapter cancellation mode %s without inventing payment success',
    async (mode) => {
      const { request, current } = seed('golden', 'a', '500000', true);
      render(<TransactionsPreview search={`view=withdrawals&request=${request.requestRef}`} />);
      await screen.findByText(request.requestRef);
      fireEvent.change(screen.getByRole('combobox', { name: 'ผลการยกเลิกจำลอง' }), {
        target: { value: mode },
      });
      await cancelRequest();
      if (mode === 'lost_after_accept') {
        const recovery = await screen.findByRole('button', {
          name: 'ตรวจสอบผลการยกเลิกรายการเดิม',
        });
        await waitFor(() => expect(recovery).toBeEnabled());
        fireEvent.click(recovery);
        await screen.findByText('ยืนยันการยกเลิกคำขอถอนแล้ว');
        expect(current.controller.list().items[0].status).toBe('cancelled');
      } else {
        await screen.findByText(/การดำเนินการยกเลิกไม่สำเร็จ ไม่ใช่สถานะถอนเงินล้มเหลว/);
        expect(current.controller.list().items[0].status).toBe(
          mode === 'race' ? 'processing' : 'requested',
        );
        expect(current.controller.list().items[0].reserved.minor).toBe('500000');
      }
      expect(screen.queryByText('โอนเงินแล้ว')).toBeNull();
    },
  );

  it('can reset only the selected synthetic scope and leaves the other identity intact', async () => {
    const a = seed('golden', 'a');
    const b = seed('golden', 'b');
    render(<TransactionsPreview search="view=withdrawals&identity=b" />);
    await screen.findByRole('link', { name: `ดูรายละเอียดคำขอ ${b.request.requestRef}` });
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มข้อมูลจำลองขอบเขตนี้ใหม่' }));
    await screen.findByText('ยังไม่มีคำขอถอนเงิน');
    expect(a.current.controller.list().items.map((item) => item.requestRef)).toEqual([
      a.request.requestRef,
    ]);
    expect(b.current.controller.list().items).toHaveLength(0);
  });
});

// Preserve regression coverage of the opt-in brand-filter capability.
brandBeforeEach(() => brandVi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true'));
brandAfterEach(() => brandVi.unstubAllEnvs());
