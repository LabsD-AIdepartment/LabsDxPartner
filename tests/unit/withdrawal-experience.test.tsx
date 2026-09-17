import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  WithdrawalScopeValue,
  WithdrawalSubmissionValue,
} from '@/contracts/withdrawal-journey';
import { WithdrawalExperience } from '@/features/withdrawals/WithdrawalExperience';
import { withdrawalKeys, type WithdrawalTransport } from '@/features/withdrawals/model';
import { createWithdrawalScenario } from '../../dev/withdrawals/transport';
import { memoryStorage } from '../../dev/withdrawals/store';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
});
afterAll(() => {
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
const scope: WithdrawalScopeValue = {
  userId: 'SYNTH-ui-user',
  partnerId: 'SYNTH-ui-partner',
  permissionRevision: 'SYNTH-ui-permission',
  payerId: 'SYNTH-ui-payer',
  currency: 'THB',
  scenario: 'golden',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(overrides: Partial<WithdrawalScopeValue> = {}) {
  return createWithdrawalScenario({
    scope: { ...scope, ...overrides },
    storage: memoryStorage(),
    latencyMs: 0,
  });
}
function mount(transport: WithdrawalTransport, initialScope = scope) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
  const props = {
    scope: initialScope,
    transport,
    refreshKey: 0,
    grid: true,
    date: '2026-09',
    brand: 'all',
  };
  const tree = () => (
    <QueryClientProvider client={client}>
      <WithdrawalExperience
        scope={props.scope}
        transport={props.transport}
        refreshKey={props.refreshKey}
      >
        {({ renderSummary, persistenceWarning }) => (
          <>
            <div data-testid="earnings">
              {props.date}/{props.brand}
            </div>
            {props.grid && renderSummary('test-grid')}
            {persistenceWarning && <p role="status">{persistenceWarning}</p>}
          </>
        )}
      </WithdrawalExperience>
    </QueryClientProvider>
  );
  const rendered = render(tree());
  return {
    ...rendered,
    client,
    update: (next: Partial<typeof props>) => {
      Object.assign(props, next);
      rendered.rerender(tree());
    },
  };
}
async function open() {
  const button = await screen.findByRole('button', { name: 'ถอนเงิน' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
async function review(raw = '5000') {
  await open();
  fireEvent.click(screen.getByRole('radio', { name: 'ระบุจำนวนเงิน' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: raw } });
  fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
  await screen.findByRole('heading', { name: 'ตรวจสอบก่อนถอนเงิน' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' })).toBeEnabled());
}
async function confirmed() {
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
  await screen.findByRole('heading', { name: 'กำลังดำเนินการโอน' });
}

describe('Withdrawal experience orchestration', () => {
  it('uses supplied golden balances, reserves a partial request, and permits a fresh review of remaining funds', async () => {
    const f = fixture();
    const submit = vi.spyOn(f.transport, 'submit');
    mount(f.transport);
    await review();
    expect(screen.getAllByText('฿15,000.00')[0]).toBeVisible();
    await confirmed();
    const card = within(screen.getByRole('article', { name: 'สรุปยอดพร้อมถอน' }));
    await waitFor(() => expect(card.getByText('฿15,000')).toBeVisible());
    expect(f.controller.summary().balance).toMatchObject({
      state: 'known',
      reserved: { minor: '500000' },
    });
    expect(card.queryByText('฿5,000')).toBeNull();
    expect(card.getByText('฿7,000')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'โอนเงินแล้ว' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'เสร็จสิ้น' }));
    await open();
    fireEvent.click(screen.getByRole('radio', { name: 'ถอนทั้งหมด' }));
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    await screen.findByRole('heading', { name: 'ตรวจสอบก่อนถอนเงิน' });
    expect(screen.getAllByText('฿15,000.00')[0]).toBeVisible();
    await confirmed();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0].submission.idempotencyKey).not.toBe(
      submit.mock.calls[1][0].submission.idempotencyKey,
    );
  });

  it('locks same-tick duplicate submits; closing/reopening cannot cancel or replace the pending command', async () => {
    const f = fixture();
    const response = deferred<unknown>();
    let submitted!: WithdrawalSubmissionValue;
    let signal!: AbortSignal;
    const submit = vi.fn(async (input: Parameters<WithdrawalTransport['submit']>[0]) => {
      submitted = input.submission;
      signal = input.signal;
      return response.promise;
    });
    mount({ ...f.transport, submit });
    await review();
    const button = screen.getByRole('button', { name: 'ยืนยันถอนเงิน' });
    act(() => {
      button.click();
      button.click();
    });
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'ถอนเงิน' }));
    expect(screen.getByRole('button', { name: 'กำลังดำเนินการ…' })).toBeDisabled();
    await act(async () => response.resolve(f.controller.submit(submitted)));
    await screen.findByRole('heading', { name: 'กำลังดำเนินการโอน' });
    expect(f.controller.summary().resume).toHaveLength(1);
  });

  it('keeps the same key after timeout-after-accept and recovers without another submit', async () => {
    const f = fixture();
    const submit = vi.fn(async ({ submission }: Parameters<WithdrawalTransport['submit']>[0]) => {
      f.controller.submit(submission);
      throw new Error('timeout');
    });
    const recover = vi.spyOn(f.transport, 'recover');
    mount({ ...f.transport, submit });
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
    await screen.findByRole('heading', { name: 'ยังยืนยันผลคำขอไม่ได้' });
    expect(screen.queryByRole('button', { name: 'ขอถอนเงินเพิ่ม' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอเดิม' }));
    await screen.findByRole('heading', { name: 'กำลังดำเนินการโอน' });
    expect(recover.mock.calls[0][0].idempotencyKey).toBe(
      submit.mock.calls[0][0].submission.idempotencyKey,
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(f.controller.summary().resume).toHaveLength(1);
  });

  it('preserves all persisted descriptors and resumes the unresolved operation directly after reload', async () => {
    const storage = memoryStorage();
    const f = createWithdrawalScenario({ scope, storage, latencyMs: 0 });
    for (let i = 0; i < 3; i++) {
      if (i === 2) f.controller.setUnknownOutcome(true);
      const quote = f.controller.quote('10000');
      if (quote.state !== 'quoted') throw new Error('fixture quote unavailable');
      f.controller.submit({
        scope,
        idempotencyKey: `SYNTH-reload-${i}`,
        quoteId: quote.quoteId,
        gross: quote.gross,
        net: quote.net,
        bindings: quote.bindings,
      });
    }
    const restored = createWithdrawalScenario({ scope, storage, latencyMs: 0 });
    const recover = vi.spyOn(restored.transport, 'recover');
    mount(restored.transport);
    const openRecovery = await screen.findByRole('button', { name: 'ถอนเงิน' });
    await waitFor(() => expect(openRecovery).toBeEnabled());
    fireEvent.click(openRecovery);
    expect(screen.queryByRole('heading', { name: 'คำขอที่ยังดำเนินการ' })).toBeNull();
    const last = restored.controller
      .summary()
      .resume.find((item) => item.status === 'reconciling')!;
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอเดิม' }));
    await screen.findByRole('heading', { name: 'ยังยืนยันผลคำขอไม่ได้' });
    expect(recover.mock.calls[0][0]).toMatchObject({
      idempotencyKey: last.idempotencyKey,
      requestRef: last.requestRef,
    });
    expect(screen.queryByRole('heading', { name: 'โอนเงินแล้ว' })).toBeNull();
    expect(restored.controller.summary().resume).toHaveLength(3);
  });

  it('retains key and uncertainty after recovery missing; never enables a fresh request', async () => {
    const f = fixture();
    const submit = vi.fn(async () => {
      throw new Error('network');
    });
    const recover = vi.fn(async () => ({ state: 'missing' }));
    mount({ ...f.transport, submit, recover });
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
    await screen.findByRole('heading', { name: 'ยังยืนยันผลคำขอไม่ได้' });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอเดิม' }));
    await screen.findByText(/ยังไม่พบผลคำขอเดิม/);
    expect(screen.queryByRole('button', { name: 'ขอถอนเงินเพิ่ม' })).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('fences old-scope quote and summary responses and closes the old sheet immediately', async () => {
    const a = fixture();
    const b = fixture({
      partnerId: 'SYNTH-other-partner',
      payerId: 'SYNTH-other-payer',
      scenario: 'missing-beneficiary',
    });
    const pending = deferred<unknown>();
    let readSignal!: AbortSignal;
    const quote = vi.fn(async (input: Parameters<WithdrawalTransport['quote']>[0]) => {
      readSignal = input.signal;
      return pending.promise;
    });
    const mounted = mount({ ...a.transport, quote });
    await open();
    fireEvent.click(screen.getByRole('radio', { name: 'ถอนทั้งหมด' }));
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    await screen.findByRole('heading', { name: 'กำลังตรวจสอบรายการ' });
    mounted.update({ scope: b.controller.currentScope(), transport: b.transport });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readSignal.aborted).toBe(true);
    await act(async () => pending.resolve(a.controller.quote('2000000')));
    await screen.findByText('บัญชีรับเงินยังไม่พร้อม ต้องตรวจสอบข้อมูลก่อนถอน');
    expect(screen.queryByRole('heading', { name: 'ตรวจสอบก่อนถอนเงิน' })).toBeNull();
  });

  it('does not abort an old-scope money operation or display its late result in the new scope', async () => {
    const a = fixture();
    const b = fixture({ partnerId: 'SYNTH-other-partner' });
    const pending = deferred<unknown>();
    let input!: Parameters<WithdrawalTransport['submit']>[0];
    const mounted = mount({
      ...a.transport,
      submit: async (value) => {
        input = value;
        return pending.promise;
      },
    });
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
    mounted.update({ scope: b.controller.currentScope(), transport: b.transport });
    expect(input.signal.aborted).toBe(false);
    await act(async () => pending.resolve(a.controller.submit(input.submission)));
    await waitFor(() => expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeEnabled());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      within(screen.getByRole('article', { name: 'สรุปยอดพร้อมถอน' })).getByText('฿20,000'),
    ).toBeVisible();
    expect(a.controller.summary().resume).toHaveLength(1);
    expect(b.controller.summary().resume).toHaveLength(0);
  });

  it('keeps the request controller and financial query key when earnings date/brand reload unmounts the grid', async () => {
    const f = fixture();
    const submit = vi.spyOn(f.transport, 'submit');
    const mounted = mount(f.transport);
    await review();
    mounted.update({ grid: false, date: '2026-08', brand: 'Tendrix' });
    expect(screen.getByRole('heading', { name: 'ตรวจสอบก่อนถอนเงิน' })).toBeVisible();
    mounted.update({ grid: true });
    await confirmed();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      mounted.client
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ).toEqual([withdrawalKeys.summary(scope)]);
  });

  it('expires a reviewed quote before confirmation and requires fresh review', async () => {
    const f = fixture();
    const submit = vi.spyOn(f.transport, 'submit');
    mount({
      ...f.transport,
      quote: async (input) => {
        const value = (await f.transport.quote(input)) as Record<string, unknown>;
        return { ...value, expiresAt: new Date(Date.now() + 90).toISOString() };
      },
    });
    await review();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('ตรวจสอบรายการใหม่');
  });

  it('quarantines a substituted submit record, retaining only the original recovery key', async () => {
    const f = fixture();
    let key = '';
    mount({
      ...f.transport,
      submit: async ({ submission }) => {
        key = submission.idempotencyKey;
        const value = f.controller.submit(submission);
        if (value.outcome === 'rejected') throw new Error('fixture submit rejected');
        return {
          ...value,
          request: {
            ...value.request,
            idempotencyKey: 'FOREIGN-KEY',
            beneficiary: { ...value.request.beneficiary, displayName: 'FOREIGN-NAME' },
          },
        };
      },
    });
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
    await screen.findByRole('heading', { name: 'ยังยืนยันผลคำขอไม่ได้' });
    expect(screen.getByText(key)).toBeVisible();
    expect(screen.queryByText('FOREIGN-NAME')).toBeNull();
    expect(screen.queryByText('FOREIGN-KEY')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ขอถอนเงินเพิ่ม' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอเดิม' }));
    await screen.findByRole('heading', { name: 'กำลังดำเนินการโอน' });
  });

  it('drops a late old-scope summary without showing its money under the new identity', async () => {
    const a = fixture();
    const b = fixture({ partnerId: 'SYNTH-summary-other', scenario: 'zero-balance' });
    const pending = deferred<unknown>();
    const mounted = mount({ ...a.transport, summary: async () => pending.promise });
    mounted.update({ scope: b.controller.currentScope(), transport: b.transport });
    await screen.findByText('ยังไม่มียอดพร้อมถอนในขณะนี้');
    await act(async () => pending.resolve(a.controller.summary()));
    expect(screen.queryByText('฿20,000')).toBeNull();
    expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeDisabled();
  });

  it('composes the existing six-card Overview and catches a denied sessionStorage getter', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
    try {
      render(<WithdrawalPreview />);
      await screen.findByRole('article', { name: 'สรุปยอดพร้อมถอน' });
      await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(6));
      expect(screen.getByRole('button', { name: /^การแจ้งเตือน/ })).toBeVisible();
      expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeDisabled();
      expect(screen.getByRole('img', { name: 'ภาพโปรไฟล์ มดดำ คชาภา' })).toBeVisible();
      expect(
        screen
          .getAllByRole('status')
          .some((item) => /บันทึก|อ่าน|รีโหลด/.test(item.textContent ?? '')),
      ).toBe(true);
    } finally {
      Object.defineProperty(window, 'sessionStorage', descriptor);
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['', 'กรุณาระบุจำนวนเงิน'],
    ['1e3', 'กรุณาระบุจำนวนเงินให้ถูกต้อง'],
    ['-1', 'กรุณาระบุจำนวนเงินให้ถูกต้อง'],
    ['1.001', 'ระบุทศนิยมได้ไม่เกิน 2 ตำแหน่ง'],
    ['0', 'จำนวนเงินต้องมากกว่าศูนย์'],
    ['9'.repeat(41), 'จำนวนเงินเกินขอบเขตที่ระบบรองรับ'],
  ])('rejects partial input %s through the shared exact parser', async (raw, message) => {
    const f = fixture();
    const quote = vi.spyOn(f.transport, 'quote');
    mount(f.transport);
    await open();
    fireEvent.click(screen.getByRole('radio', { name: 'ระบุจำนวนเงิน' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: raw } });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(quote).not.toHaveBeenCalled();
  });

  it('submits one satang exactly and lets the transport reject over-balance input', async () => {
    const f = fixture();
    const mounted = mount(f.transport);
    await review('0.01');
    await confirmed();
    expect(f.controller.summary().resume[0].gross.minor).toBe('1');
    mounted.unmount();
    mount(fixture().transport);
    await open();
    fireEvent.click(screen.getByRole('radio', { name: 'ระบุจำนวนเงิน' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '999999999999999999999999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.queryByRole('button', { name: 'ยืนยันถอนเงิน' })).toBeNull();
  });

  it('invalidates a reviewed quote when revision or beneficiary changes and requires another review', async () => {
    const f = fixture();
    const submit = vi.spyOn(f.transport, 'submit');
    const mounted = mount(f.transport);
    await review();
    f.controller.changeBeneficiary();
    mounted.update({ refreshKey: 1 });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไขจำนวนเงิน' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ตรวจสอบรายการ' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    await screen.findByRole('heading', { name: 'ตรวจสอบก่อนถอนเงิน' });
    await confirmed();
    expect(submit.mock.calls[0][0].submission.bindings.beneficiaryVersion).toBe(
      f.controller.summary().beneficiary.state === 'known'
        ? (f.controller.summary().beneficiary as { version: string }).version
        : 'missing',
    );
  });

  it('refreshes changed source facts between summary and quote so a fresh review can proceed', async () => {
    const f = fixture();
    mount(f.transport);
    await open();
    fireEvent.click(screen.getByRole('radio', { name: 'ถอนทั้งหมด' }));
    f.controller.changeBeneficiary();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    await screen.findByText('ข้อมูลหรือใบตรวจสอบเปลี่ยนแล้ว กรุณาตรวจสอบรายการใหม่ก่อนยืนยัน');
    expect(screen.queryByRole('button', { name: 'ยืนยันถอนเงิน' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ตรวจสอบรายการ' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    await screen.findByRole('heading', { name: 'ตรวจสอบก่อนถอนเงิน' });
    await confirmed();
  });

  it('shows an unavailable all-amount reason and refreshes the remaining balance for re-review', async () => {
    const f = fixture();
    mount(f.transport);
    await open();
    fireEvent.click(screen.getByRole('radio', { name: 'ถอนทั้งหมด' }));
    const quote = f.controller.quote('500000');
    if (quote.state !== 'quoted') throw new Error('fixture quote unavailable');
    f.controller.submit({
      scope,
      idempotencyKey: 'SYNTH-concurrent',
      quoteId: quote.quoteId,
      gross: quote.gross,
      net: quote.net,
      bindings: quote.bindings,
    });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    await screen.findByText('จำนวนที่ขอถอนเกินยอดที่พร้อมถอน');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ตรวจสอบรายการ' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    await screen.findByRole('heading', { name: 'ตรวจสอบก่อนถอนเงิน' });
    expect(screen.getAllByText('฿15,000.00')[0]).toBeVisible();
  });

  it('keeps read-outage snapshots distinct from invalid cross-identity responses', async () => {
    const f = fixture();
    let invalid = false;
    const transport = {
      ...f.transport,
      summary: async (input: Parameters<WithdrawalTransport['summary']>[0]) =>
        invalid
          ? { ...f.controller.summary(), scope: { ...scope, userId: 'FOREIGN' } }
          : f.transport.summary(input),
    };
    const mounted = mount(transport);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeEnabled());
    f.controller.setReadError(true);
    mounted.update({ refreshKey: 1 });
    await screen.findByText('แสดงยอดครั้งล่าสุด ต้องอัปเดตข้อมูลก่อนขอถอน');
    expect(
      within(screen.getByRole('article', { name: 'สรุปยอดพร้อมถอน' })).getByText('฿20,000'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeDisabled();
    f.controller.setReadError(false);
    invalid = true;
    mounted.update({ refreshKey: 2 });
    await screen.findByText('โหลดข้อมูลการถอนไม่สำเร็จ');
    expect(screen.queryByText('฿20,000')).toBeNull();
  });

  it.each([
    'missing-beneficiary',
    'pending-beneficiary',
    'unknown-tax',
    'balance-unknown',
    'zero-balance',
  ])('blocks requests for %s without inventing readiness', async (scenario) => {
    const f = fixture({ scenario });
    const quote = vi.spyOn(f.transport, 'quote');
    mount(f.transport, f.controller.currentScope());
    await waitFor(() => expect(screen.queryByText('กำลังตรวจสอบยอดพร้อมถอน')).toBeNull());
    expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeDisabled();
    expect(quote).not.toHaveBeenCalled();
    if (scenario === 'balance-unknown') expect(screen.queryByText('฿0')).toBeNull();
  });
});
