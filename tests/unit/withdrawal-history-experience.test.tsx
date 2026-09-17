import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  WithdrawalCancelCommandValue,
  WithdrawalCancellationReceiptValue,
  WithdrawalRequestDetailValue,
  WithdrawalScopeValue,
} from '@/contracts/withdrawal-journey';
import {
  WithdrawalHistoryExperience,
  type WithdrawalHistoryExperienceProps,
} from '@/features/withdrawals/WithdrawalHistoryExperience';
import { withdrawalKeys, type WithdrawalHistoryTransport } from '@/features/withdrawals/model';
import { createWithdrawalScenario } from '../../dev/withdrawals/transport';
import { memoryStorage } from '../../dev/withdrawals/store';

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
  userId: 'SYNTH-a',
  partnerId: 'SYNTH-partner',
  permissionRevision: 'perm-a',
  payerId: 'payer-a',
  currency: 'THB',
  scenario: 'golden',
};
const money = (minor: string) => ({ currency: 'THB' as const, minor });
function sample(ref = 'request-one', scopeValue = scope): WithdrawalRequestDetailValue {
  return {
    request: {
      requestRef: ref,
      idempotencyKey: `submit-${ref}`,
      scope: scopeValue,
      status: 'requested',
      gross: money('500000'),
      net: money('485000'),
      reserved: money('500000'),
      deductions: [
        { kind: 'withholding_tax', label: 'รายการหักที่บันทึกไว้', amount: money('15000') },
      ],
      beneficiary: {
        displayName: `ผู้รับ ${ref}`,
        bankName: 'ธนาคารตัวอย่าง',
        maskedAccount: '••••1234',
        version: 'beneficiary-1',
      },
      quoteId: 'quote-1',
      bindings: {
        balanceRevision: 'balance-1',
        policyRevision: 'policy-1',
        beneficiaryVersion: 'beneficiary-1',
      },
      submittedAt: '2026-09-16T00:00:00Z',
      allowedActions: ['cancel', 'check_status'],
    },
    timeline: [
      { seq: 1, at: '2026-09-16T00:00:00Z', kind: 'submitted', status: 'requested', detail: null },
    ],
    historyComplete: true,
    sourceContext: { state: 'known', periods: [], allocationModeled: false },
    documents: { state: 'pending', reasons: ['เอกสารยังไม่พร้อม'] },
    pendingCancellations: [],
    revision: 'revision-1',
  };
}
function terminal(
  value: WithdrawalRequestDetailValue,
  status: 'cancelled' | 'paid' = 'cancelled',
): WithdrawalRequestDetailValue {
  return {
    ...value,
    revision: 'revision-terminal',
    request: { ...value.request, status, reserved: money('0'), allowedActions: ['check_status'] },
    timeline: [
      ...value.timeline,
      { seq: 2, at: '2026-09-16T02:00:00Z', kind: status, status, detail: null },
    ],
    pendingCancellations: [],
  };
}
function receipt(
  command: WithdrawalCancelCommandValue,
  outcome: WithdrawalCancellationReceiptValue['outcome'] = 'unknown',
  code: WithdrawalCancellationReceiptValue['code'] = null,
): WithdrawalCancellationReceiptValue {
  return {
    ...command,
    outcome,
    code,
    detail: null,
    createdAt: '2026-09-16T01:00:00Z',
    resolvedAt: outcome === 'unknown' ? null : '2026-09-16T02:00:00Z',
  };
}
function pending(value: WithdrawalRequestDetailValue, key: string) {
  return receipt({
    scope: value.request.scope,
    requestRef: value.request.requestRef,
    requestIdempotencyKey: value.request.idempotencyKey,
    expectedRevision: value.revision,
    operationKey: key,
  });
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(value = sample()) {
  const responses = { detail: value, rows: [value.request] };
  const authority = createWithdrawalScenario({
    scope: value.request.scope,
    storage: memoryStorage(),
    latencyMs: 0,
  });
  const transport = {
    summary: vi.fn<WithdrawalHistoryTransport['summary']>(authority.transport.summary),
    quote: vi.fn(async () => {
      throw new Error('Unused WU01 quote');
    }),
    submit: vi.fn(async () => {
      throw new Error('Unused WU01 submit');
    }),
    recover: vi.fn(async () => {
      throw new Error('Unused WU01 recovery');
    }),
    list: vi.fn<WithdrawalHistoryTransport['list']>(async () => ({
      scope: value.request.scope,
      asOf: '2026-09-16T00:00:00Z',
      items: responses.rows,
      nextCursor: null,
      revision: 'list-1',
    })),
    detail: vi.fn<WithdrawalHistoryTransport['detail']>(async () => ({
      state: 'found',
      detail: responses.detail,
    })),
    cancel: vi.fn<WithdrawalHistoryTransport['cancel']>(async ({ command }) => ({
      outcome: 'unknown',
      receipt: receipt(command),
    })),
    recoverCancellation: vi.fn<WithdrawalHistoryTransport['recoverCancellation']>(
      async (input) => ({
        state: 'missing',
        scope: input.scope,
        requestRef: input.requestRef ?? null,
        operationKey: input.operationKey ?? null,
      }),
    ),
  } satisfies WithdrawalHistoryTransport;
  return { responses, transport, authority };
}
function mount(
  transport: WithdrawalHistoryTransport,
  overrides: Partial<WithdrawalHistoryExperienceProps> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
  const props: WithdrawalHistoryExperienceProps = {
    scope,
    transport,
    requestRef: 'request-one',
    refreshKey: 0,
    requestHref: (ref) => `/safe?request=${ref}`,
    backHref: '/safe-history',
    ...overrides,
  };
  const tree = () => (
    <QueryClientProvider client={client}>
      <WithdrawalHistoryExperience {...props} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    ...view,
    client,
    update: (next: Partial<WithdrawalHistoryExperienceProps>) => {
      Object.assign(props, next);
      view.rerender(tree());
    },
  };
}
async function openReview() {
  const cancel = await screen.findByRole('button', { name: 'ยกเลิกคำขอถอน' });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  return screen.getByRole('dialog', { name: 'ยืนยันการยกเลิกคำขอถอน' });
}
async function confirm() {
  await openReview();
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกคำขอ' }));
}

describe('Withdrawal history experience', () => {
  it('renders the authoritative cumulative balance above filters even when history is empty', async () => {
    const { transport, responses, authority } = fixture();
    responses.rows = [];
    const snapshot = authority.controller.summary();
    if (snapshot.balance.state !== 'known') throw new Error('Expected known fixture balance');
    snapshot.balance.available = money('1234567');
    transport.summary.mockResolvedValue(snapshot);
    mount(transport, { requestRef: null });
    const region = await screen.findByRole('region', { name: 'ยอดพร้อมถอน' });
    expect(await within(region).findByText('฿12,345.67')).toBeVisible();
    expect(
      region.compareDocumentPosition(screen.getByRole('group', { name: 'ตัวกรองคำขอถอนเงิน' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(await screen.findByText('ยังไม่มีคำขอถอนเงิน')).toBeVisible();
    expect(transport.summary.mock.calls[0][0].scope).toEqual(scope);
  });

  it('does not request or render the list balance on a request detail page', async () => {
    const { transport } = fixture();
    mount(transport);
    await screen.findByText('request-one');
    expect(transport.summary).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'ยอดพร้อมถอน' })).toBeNull();
    const facts = within(screen.getByRole('article', { name: 'รายละเอียดคำขอถอน' }));
    expect(facts.getByText('฿5,000.00')).toBeVisible();
    expect(facts.getByText('฿150.00')).toBeVisible();
    expect(facts.queryByText('ยอดรับเข้าบัญชีหลังหักรายการต่าง ๆ')).toBeNull();
    expect(facts.queryByText('ยอดที่กันไว้สำหรับคำขอนี้')).toBeNull();
    expect(facts.queryByText('฿4,850.00')).toBeNull();
  });

  it.each(['outage', 'foreign', 'unavailable'] as const)(
    'replaces the prior balance with unknown after a version changes to %s',
    async (kind) => {
      const { transport, authority } = fixture();
      const view = mount(transport, { requestRef: null });
      const balance = within(screen.getByRole('region', { name: 'ยอดพร้อมถอน' }));
      await balance.findByText('฿20,000');
      const response = authority.controller.summary();
      if (kind === 'outage') transport.summary.mockRejectedValueOnce(new Error('offline'));
      else if (kind === 'foreign')
        transport.summary.mockResolvedValueOnce({
          ...response,
          scope: { ...scope, payerId: 'foreign' },
        });
      // An unavailable response must retain the requested envelope scope; its nested balance
      // and readiness scopes remain the same payer/partner/currency in the fixture.
      if (kind === 'unavailable') {
        const unknown = createWithdrawalScenario({
          scope: { ...scope, scenario: 'balance-unknown' },
          storage: memoryStorage(),
          latencyMs: 0,
        }).controller.summary();
        transport.summary.mockResolvedValueOnce({ ...unknown, scope });
      }
      view.update({ refreshKey: 1 });
      expect(balance.queryByText('฿20,000')).toBeNull();
      await balance.findByRole('button', { name: 'ลองอีกครั้ง' });
      if (kind === 'unavailable') expect(balance.queryByRole('alert')).toBeNull();
      expect(balance.queryByText('฿0')).toBeNull();
      expect(balance.getByLabelText('ยังไม่มีข้อมูลยอดพร้อมถอน')).toHaveTextContent('—');
      transport.summary.mockResolvedValue(response);
      fireEvent.click(balance.getByRole('button', { name: 'ลองอีกครั้ง' }));
      expect(await balance.findByText('฿20,000')).toBeVisible();
    },
  );

  it('marks cached balance stale during a scope invalidation and removes it on read failure', async () => {
    const { transport } = fixture();
    const view = mount(transport, { requestRef: null });
    const balance = within(screen.getByRole('region', { name: 'ยอดพร้อมถอน' }));
    await balance.findByText('฿20,000');
    const next = deferred();
    transport.summary.mockImplementationOnce(() => next.promise);
    await act(async () => {
      void view.client.invalidateQueries({ queryKey: withdrawalKeys.summary(scope, '0') });
    });
    expect(balance.getByText('฿20,000')).toBeVisible();
    expect(await balance.findByText('แสดงยอดครั้งล่าสุด กำลังตรวจสอบยอดพร้อมถอน')).toBeVisible();
    await act(async () => next.reject(new Error('offline')));
    await balance.findByText('โหลดข้อมูลยอดพร้อมถอนไม่สำเร็จ');
    expect(balance.queryByText('฿20,000')).toBeNull();
  });

  it('fences pending balance reads across full identity changes', async () => {
    const old = fixture();
    const pending = deferred();
    old.transport.summary.mockImplementationOnce(() => pending.promise);
    const view = mount(old.transport, { requestRef: null });
    await waitFor(() => expect(old.transport.summary).toHaveBeenCalledTimes(1));
    expect(screen.getByText('กำลังตรวจสอบยอดพร้อมถอน')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'ยอดพร้อมถอน' })).queryByText('฿0'),
    ).toBeNull();
    const otherScope = {
      ...scope,
      userId: 'other-user',
      partnerId: 'other-partner',
      permissionRevision: 'other-permission',
      payerId: 'other-payer',
    };
    const other = fixture(sample('other', otherScope));
    other.transport.summary.mockRejectedValue(new Error('offline'));
    view.update({ scope: otherScope, transport: other.transport });
    const balance = within(screen.getByRole('region', { name: 'ยอดพร้อมถอน' }));
    await balance.findByText('โหลดข้อมูลยอดพร้อมถอนไม่สำเร็จ');
    await act(async () => pending.resolve(old.authority.controller.summary()));
    expect(old.transport.summary.mock.calls[0][0].signal.aborted).toBe(true);
    expect(other.transport.summary.mock.calls[0][0].scope).toEqual(otherScope);
    expect(balance.queryByText('฿20,000')).toBeNull();
    expect(balance.getByLabelText('ยังไม่มีข้อมูลยอดพร้อมถอน')).toHaveTextContent('—');
  });

  it('refreshes balance on a runtime version and displays an authoritative zero', async () => {
    const { transport, authority } = fixture();
    const view = mount(transport, { requestRef: null });
    const balance = within(screen.getByRole('region', { name: 'ยอดพร้อมถอน' }));
    await balance.findByText('฿20,000');
    const next = authority.controller.summary();
    if (next.balance.state !== 'known') throw new Error('Expected known fixture balance');
    next.balance.available = money('0');
    transport.summary.mockResolvedValue(next);
    view.update({ refreshKey: 1 });
    expect(await balance.findByText('฿0')).toBeVisible();
    expect(balance.queryByText('฿20,000')).toBeNull();
    expect(transport.summary).toHaveBeenCalledTimes(2);
    expect(view.client.getQueryData(withdrawalKeys.summary(scope, '1'))).toEqual(next);
  });

  it('defaults to all-time history and filters Bangkok dates with a half-open midnight boundary without refetching money', async () => {
    const { responses, transport } = fixture();
    responses.rows = [
      '2026-09-15T16:59:59Z',
      '2026-09-15T17:00:00Z',
      '2026-09-16T16:59:59Z',
      '2026-09-16T17:00:00Z',
    ].map((at, index) => ({ ...sample(`row-${index}`).request, submittedAt: at }));
    mount(transport, { requestRef: null });
    await screen.findByRole('link', { name: 'ดูรายละเอียดคำขอ row-0' });
    const balance = within(screen.getByRole('region', { name: 'ยอดพร้อมถอน' }));
    expect(await balance.findByText('฿20,000')).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่'), {
      target: { value: '2026-09-16' },
    });
    fireEvent.change(screen.getByLabelText('ถึงก่อนวันที่ (ไม่รวมวันนี้)'), {
      target: { value: '2026-09-17' },
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'ดูรายละเอียดคำขอ row-1' })).toHaveAttribute(
      'href',
      '/safe?request=row-1',
    );
    expect(screen.getByRole('link', { name: 'ดูรายละเอียดคำขอ row-2' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'paid' } });
    expect(screen.getByText('ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้')).toBeVisible();
    expect(transport.list).toHaveBeenCalledTimes(1);
    expect(transport.summary).toHaveBeenCalledTimes(1);
    expect(balance.getByText('฿20,000')).toBeVisible();
    expect(transport.detail).not.toHaveBeenCalled();
    expect(transport.quote).not.toHaveBeenCalled();
    expect(transport.submit).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'all' as const, from: '2026-02-30', toExclusive: '' },
    { status: 'all' as const, from: '2026-09-17', toExclusive: '2026-09-16' },
  ])('reports invalid dates/ranges without pretending that history is empty', async (filters) => {
    const { transport } = fixture();
    mount(transport, { requestRef: null, filters });
    await screen.findByRole('link', { name: 'ดูรายละเอียดคำขอ request-one' });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByText('ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้')).toBeNull();
  });

  it('shows a validated empty snapshot as known empty, including during a read-only refresh', async () => {
    const { responses, transport } = fixture();
    responses.rows = [];
    const view = mount(transport, { requestRef: null });
    await screen.findByText('ยังไม่มีคำขอถอนเงิน');
    const delayed = deferred();
    transport.list.mockImplementationOnce(() => delayed.promise as never);
    act(() => {
      void view.client.invalidateQueries({ queryKey: withdrawalKeys.list(scope, '0') });
    });
    await screen.findByText(/แสดงคำขอครั้งล่าสุด/);
    expect(screen.getByText('ยังไม่มีคำขอถอนเงิน')).toBeVisible();
    view.unmount();
  });

  it('fences an old scope list response and aborts its read before exposing a new identity', async () => {
    const old = fixture();
    const delayed = deferred();
    old.transport.list.mockImplementationOnce(() => delayed.promise as never);
    const view = mount(old.transport, { requestRef: null });
    await waitFor(() => expect(old.transport.list).toHaveBeenCalledTimes(1));
    const otherScope = { ...scope, permissionRevision: 'perm-b', payerId: 'payer-b' };
    const other = fixture(sample('other-private-ref', otherScope));
    view.update({ scope: otherScope, transport: other.transport });
    expect(old.transport.list.mock.calls[0][0].signal.aborted).toBe(true);
    await screen.findByRole('link', { name: 'ดูรายละเอียดคำขอ other-private-ref' });
    await act(async () =>
      delayed.resolve({
        scope,
        items: [sample().request],
        revision: 'old',
        nextCursor: null,
        asOf: '2026-09-16T00:00:00Z',
      }),
    );
    expect(screen.queryByRole('link', { name: 'ดูรายละเอียดคำขอ request-one' })).toBeNull();
  });

  it.each(['outage', 'foreign'] as const)(
    'discards cached history after a %s response instead of showing a false empty list',
    async (kind) => {
      const { transport } = fixture();
      const view = mount(transport, { requestRef: null });
      await screen.findByRole('link', { name: 'ดูรายละเอียดคำขอ request-one' });
      if (kind === 'outage') transport.list.mockRejectedValueOnce(new Error('read unavailable'));
      else
        transport.list.mockResolvedValueOnce({
          scope: { ...scope, partnerId: 'other' },
          items: [sample().request],
          nextCursor: null,
          asOf: '2026-09-16T00:00:00Z',
          revision: 'foreign',
        });
      view.update({ refreshKey: 1 });
      expect(screen.queryByRole('link')).toBeNull();
      await screen.findByRole('button', { name: 'ลองอีกครั้ง' });
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByText('ยังไม่มีคำขอถอนเงิน')).toBeNull();
      expect(screen.queryByText('ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้')).toBeNull();
    },
  );

  it('fences a late detail response after navigating to another request', async () => {
    const { transport } = fixture();
    const delayed = deferred();
    transport.detail.mockImplementationOnce(() => delayed.promise as never);
    const view = mount(transport);
    await waitFor(() => expect(transport.detail).toHaveBeenCalledTimes(1));
    transport.detail.mockResolvedValue({ state: 'found', detail: sample('request-two') });
    view.update({ requestRef: 'request-two' });
    await screen.findByText('request-two');
    await act(async () => delayed.resolve({ state: 'found', detail: sample() }));
    expect(screen.queryByText('request-one')).toBeNull();
    expect(screen.queryByText('ผู้รับ request-one')).toBeNull();
    expect(transport.detail.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('uses one distinct immutable cancellation command for same-tick clicks and keeps it alive after dialog close', async () => {
    const { responses, transport } = fixture();
    const delayed = deferred();
    transport.cancel.mockImplementationOnce(() => delayed.promise);
    const view = mount(transport);
    const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    const dialog = await openReview();
    expect(within(dialog).getByText('฿4,850.00')).toBeVisible();
    const button = within(dialog).getByRole('button', { name: 'ยืนยันยกเลิกคำขอ' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(transport.cancel).toHaveBeenCalledTimes(1);
    const input = transport.cancel.mock.calls[0][0];
    expect(input.command.operationKey).not.toBe(input.command.requestIdempotencyKey);
    expect(input.command.expectedRevision).toBe('revision-1');
    expect(input.command.scope).toEqual(scope);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input.signal.aborted).toBe(false);
    responses.detail = terminal(responses.detail);
    await act(async () =>
      delayed.resolve({
        outcome: 'cancelled',
        receipt: receipt(input.command, 'accepted'),
        request: responses.detail.request,
      }),
    );
    await waitFor(() => expect(screen.getAllByText('คำขอถูกยกเลิกแล้ว').length).toBeGreaterThan(0));
    expect(transport.cancel).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        'withdrawal',
        scope.userId,
        scope.partnerId,
        scope.permissionRevision,
        scope.payerId,
        'THB',
        'golden',
      ],
    });
    expect(
      view.client.getQueryData(withdrawalKeys.detail(scope, 'request-one', '0')),
    ).toMatchObject({
      state: 'found',
      detail: { request: { status: 'cancelled', reserved: money('0') } },
    });
    expect(screen.queryByText('ยอดที่กันไว้สำหรับคำขอนี้')).toBeNull();
  });

  it('requires a new explicit review after an authoritative version changes while the dialog is open', async () => {
    const { responses, transport } = fixture();
    const view = mount(transport);
    await openReview();
    responses.detail = { ...responses.detail, revision: 'revision-2' };
    view.update({ refreshKey: 1 });
    expect(screen.queryByRole('button', { name: 'ยืนยันยกเลิกคำขอ' })).toBeNull();
    await screen.findByRole('button', { name: 'ตรวจสอบรายการล่าสุด' });
    expect(transport.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการล่าสุด' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกคำขอ' }));
    await waitFor(() => expect(transport.cancel).toHaveBeenCalledTimes(1));
    expect(transport.cancel.mock.calls[0][0].command.expectedRevision).toBe('revision-2');
  });

  it('shows a completed cancellation notice after the refreshed detail is ready, without a stale loading claim', async () => {
    const { responses, transport } = fixture();
    transport.cancel.mockImplementationOnce(async ({ command }) => {
      responses.detail = terminal(responses.detail);
      return {
        outcome: 'cancelled',
        receipt: receipt(command, 'accepted'),
        request: responses.detail.request,
      };
    });
    const view = mount(transport);
    await confirm();
    await screen.findAllByText('คำขอถูกยกเลิกแล้ว');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอ' })).toBeEnabled(),
    );
    expect(
      view.client.getQueryData(withdrawalKeys.detail(scope, 'request-one', '0')),
    ).toMatchObject({
      state: 'found',
      detail: { request: { status: 'cancelled', reserved: money('0') } },
    });
    expect(screen.queryByText('ยอดที่กันไว้สำหรับคำขอนี้')).toBeNull();
    expect(screen.getByText('ยืนยันการยกเลิกคำขอถอนแล้ว')).toHaveAttribute('role', 'status');
    expect(screen.queryByText(/กำลังโหลดสถานะและยอดล่าสุด/)).toBeNull();
    expect(screen.queryByText(/แสดงรายละเอียดครั้งล่าสุด/)).toBeNull();
  });

  it('keeps a cached detail read-only during refresh and cannot confirm against the old snapshot', async () => {
    const { transport } = fixture();
    const view = mount(transport);
    await openReview();
    const delayed = deferred();
    transport.detail.mockImplementationOnce(() => delayed.promise);
    act(() => {
      void view.client.invalidateQueries({
        queryKey: withdrawalKeys.detail(scope, 'request-one', '0'),
      });
    });
    await screen.findByText(/อ่านได้อย่างเดียวจนกว่าจะตรวจสอบข้อมูลล่าสุด/);
    expect(screen.queryByRole('button', { name: 'ยืนยันยกเลิกคำขอ' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ตรวจสอบรายการล่าสุด' })).toBeDisabled();
    expect(transport.cancel).not.toHaveBeenCalled();
    view.unmount();
  });

  it('locks same-tick recovery clicks and retains the same handle after an authoritative version update', async () => {
    const { transport } = fixture();
    const view = mount(transport);
    await confirm();
    const command = transport.cancel.mock.calls[0][0].command;
    const button = await screen.findByRole('button', { name: 'ตรวจสอบผลการยกเลิกรายการเดิม' });
    await waitFor(() => expect(button).toBeEnabled());
    const delayed = deferred();
    transport.recoverCancellation.mockImplementationOnce(() => delayed.promise);
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(transport.recoverCancellation).toHaveBeenCalledTimes(1);
    const read = transport.recoverCancellation.mock.calls[0][0];
    view.update({ refreshKey: 1 });
    expect(read.signal.aborted).toBe(true);
    await act(async () =>
      delayed.resolve({
        state: 'found',
        receipt: receipt(command, 'accepted'),
        request: terminal(sample()).request,
      }),
    );
    expect(screen.queryByText('ยืนยันการยกเลิกคำขอถอนแล้ว')).toBeNull();
    const retry = await screen.findByRole('button', { name: 'ตรวจสอบผลการยกเลิกรายการเดิม' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(transport.recoverCancellation).toHaveBeenCalledTimes(2));
    expect(transport.recoverCancellation.mock.calls[1][0].operationKey).toBe(command.operationKey);
    expect(transport.cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown and missing cancellation results on the same key without resubmitting', async () => {
    const { responses, transport } = fixture();
    mount(transport);
    await confirm();
    const command = transport.cancel.mock.calls[0][0].command;
    const recovery = await screen.findByRole('button', { name: 'ตรวจสอบผลการยกเลิกรายการเดิม' });
    await waitFor(() => expect(recovery).toBeEnabled());
    fireEvent.click(recovery);
    await screen.findByText(/ยังไม่พบผลของรหัสการยกเลิกเดิม/);
    expect(screen.getByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeDisabled();
    responses.detail = terminal(responses.detail);
    transport.recoverCancellation.mockResolvedValueOnce({
      state: 'found',
      receipt: receipt(command, 'accepted'),
      request: responses.detail.request,
    });
    const retry = await screen.findByRole('button', { name: 'ตรวจสอบผลการยกเลิกรายการเดิม' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await screen.findByText('ยืนยันการยกเลิกคำขอถอนแล้ว');
    expect(transport.cancel).toHaveBeenCalledTimes(1);
    expect(transport.recoverCancellation.mock.calls.map(([input]) => input.operationKey)).toEqual([
      command.operationKey,
      command.operationKey,
    ]);
    expect(
      transport.recoverCancellation.mock.calls.every(
        ([input]) => input.requestRef === command.requestRef,
      ),
    ).toBe(true);
  });

  it('preserves the command after a lost accepted response and recovers its accepted receipt', async () => {
    const { responses, transport } = fixture();
    transport.cancel.mockImplementationOnce(async () => {
      responses.detail = terminal(responses.detail);
      throw new Error('response lost');
    });
    mount(transport);
    await confirm();
    const command = transport.cancel.mock.calls[0][0].command;
    const button = await screen.findByRole('button', { name: 'ตรวจสอบผลการยกเลิกรายการเดิม' });
    transport.recoverCancellation.mockResolvedValueOnce({
      state: 'found',
      receipt: receipt(command, 'accepted'),
      request: responses.detail.request,
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText('ยืนยันการยกเลิกคำขอถอนแล้ว');
    expect(transport.cancel).toHaveBeenCalledTimes(1);
  });

  it('loads all durable pending descriptors after remount and recovers the selected original operation', async () => {
    const { responses, transport } = fixture();
    responses.detail.pendingCancellations = [
      pending(responses.detail, 'operation-old-one'),
      pending(responses.detail, 'operation-old-two'),
    ];
    const first = mount(transport);
    await screen.findByText('operation-old-one');
    first.unmount();
    mount(transport);
    const button = await screen.findByRole('button', {
      name: 'ตรวจสอบผลการยกเลิก operation-old-two',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(transport.recoverCancellation).toHaveBeenCalledTimes(1));
    expect(transport.recoverCancellation.mock.calls[0][0]).toMatchObject({
      operationKey: 'operation-old-two',
      requestRef: 'request-one',
    });
    expect(transport.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeDisabled();
  });

  it('does not abort a financial command or paint its late result into a new scope', async () => {
    const old = fixture();
    const delayed = deferred();
    old.transport.cancel.mockImplementationOnce(() => delayed.promise);
    const view = mount(old.transport);
    await confirm();
    const input = old.transport.cancel.mock.calls[0][0];
    const newScope = { ...scope, userId: 'SYNTH-b' };
    const other = fixture(sample('private-b', newScope));
    view.update({ scope: newScope, transport: other.transport, requestRef: 'private-b' });
    expect(screen.queryByText('ผู้รับ request-one')).toBeNull();
    await screen.findByText('private-b');
    await act(async () =>
      delayed.resolve({
        outcome: 'cancelled',
        receipt: receipt(input.command, 'accepted'),
        request: terminal(old.responses.detail).request,
      }),
    );
    expect(input.signal.aborted).toBe(false);
    expect(screen.queryByText('ยืนยันการยกเลิกคำขอถอนแล้ว')).toBeNull();
    expect(screen.queryByText('request-one')).toBeNull();
    expect(screen.getByText('private-b')).toBeVisible();
  });

  it('does not abort cancellation on unmount and reloads the authoritative result on return', async () => {
    const { responses, transport } = fixture();
    const delayed = deferred();
    transport.cancel.mockImplementationOnce(() => delayed.promise);
    const view = mount(transport);
    await confirm();
    const input = transport.cancel.mock.calls[0][0];
    view.unmount();
    responses.detail = terminal(responses.detail);
    await act(async () =>
      delayed.resolve({
        outcome: 'cancelled',
        receipt: receipt(input.command, 'accepted'),
        request: responses.detail.request,
      }),
    );
    expect(input.signal.aborted).toBe(false);
    mount(transport);
    await screen.findByText('request-one');
    expect(screen.getAllByText('คำขอถูกยกเลิกแล้ว').length).toBeGreaterThan(0);
    expect(transport.cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['not_cancellable', 'stale_revision'] as const)(
    'explains a %s rejection, refreshes, and never reports a successful cancellation',
    async (code) => {
      const { responses, transport } = fixture();
      transport.cancel.mockImplementationOnce(async ({ command }) => {
        if (code === 'not_cancellable') responses.detail = terminal(responses.detail, 'paid');
        else responses.detail = { ...responses.detail, revision: 'revision-2' };
        return { outcome: 'rejected', receipt: receipt(command, 'rejected', code) };
      });
      mount(transport);
      await confirm();
      await screen.findByText(
        code === 'not_cancellable'
          ? 'คำขอนี้ไม่สามารถยกเลิกได้แล้ว โปรดตรวจสอบสถานะล่าสุด'
          : 'ข้อมูลคำขอเปลี่ยนแล้ว กรุณาตรวจสอบรายการล่าสุดอีกครั้งก่อนยืนยัน',
      );
      expect(screen.queryByText('คำขอถูกยกเลิกแล้ว')).toBeNull();
      await waitFor(() => expect(transport.detail.mock.calls.length).toBeGreaterThan(1));
      if (code === 'not_cancellable') {
        await screen.findAllByText('โอนเงินแล้ว');
        expect(screen.queryByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeNull();
      }
      expect(transport.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('distinguishes cancellation operation failure from withdrawal failure and requires a fresh reviewed operation', async () => {
    const { transport } = fixture();
    transport.cancel.mockImplementationOnce(async ({ command }) => ({
      outcome: 'operation_failed',
      receipt: receipt(command, 'operation_failed', 'not_cancellable'),
    }));
    mount(transport);
    await confirm();
    await screen.findByText(/การดำเนินการยกเลิกไม่สำเร็จ ไม่ใช่สถานะถอนเงินล้มเหลว/);
    expect(screen.queryByText('คำขอไม่สำเร็จ')).toBeNull();
    const previous = transport.cancel.mock.calls[0][0].command;
    await confirm();
    expect(transport.cancel).toHaveBeenCalledTimes(2);
    expect(transport.cancel.mock.calls[1][0].command.operationKey).not.toBe(previous.operationKey);
    expect(transport.cancel.mock.calls[1][0].command.expectedRevision).toBe('revision-1');
  });

  it('keeps a malformed or foreign cancellation response uncertain rather than trusting its claimed success', async () => {
    const { transport } = fixture();
    transport.cancel.mockImplementationOnce(async ({ command }) => ({
      outcome: 'cancelled',
      receipt: receipt({ ...command, operationKey: 'foreign' }, 'accepted'),
      request: terminal(sample()).request,
    }));
    mount(transport);
    await confirm();
    await screen.findByText(/ตรวจสอบความถูกต้องของผลไม่ได้/);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ตรวจสอบผลการยกเลิกรายการเดิม' })).toBeEnabled(),
    );
    expect(screen.queryByText('คำขอถูกยกเลิกแล้ว')).toBeNull();
    expect(screen.getByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeDisabled();
    expect(transport.cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects an operation recovery that swaps the original reviewed revision', async () => {
    const { transport } = fixture();
    mount(transport);
    await confirm();
    const command = transport.cancel.mock.calls[0][0].command;
    transport.recoverCancellation.mockResolvedValueOnce({
      state: 'found',
      receipt: receipt({ ...command, expectedRevision: 'foreign-revision' }),
      request: null,
    });
    const button = await screen.findByRole('button', { name: 'ตรวจสอบผลการยกเลิกรายการเดิม' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText(/ตรวจสอบความถูกต้องของผลไม่ได้/);
    expect(transport.cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['outage', 'foreign', 'malformed', 'missing'] as const)(
    'hides the previous detail on %s refresh and provides a read-only recovery path',
    async (kind) => {
      const { transport } = fixture();
      const view = mount(transport);
      await screen.findByText('ผู้รับ request-one');
      if (kind === 'outage') transport.detail.mockRejectedValueOnce(new Error('unread'));
      else if (kind === 'foreign')
        transport.detail.mockResolvedValueOnce({
          state: 'found',
          detail: sample('request-one', { ...scope, payerId: 'foreign' }),
        });
      else if (kind === 'malformed')
        transport.detail.mockResolvedValueOnce({ state: 'found', detail: {} } as never);
      else
        transport.detail.mockResolvedValueOnce({
          state: 'missing',
          scope,
          requestRef: 'request-one',
        } as never);
      view.update({ refreshKey: 1 });
      expect(screen.queryByText('ผู้รับ request-one')).toBeNull();
      await screen.findByRole('button', { name: 'ลองอีกครั้ง' });
      expect(screen.queryByText('request-one')).toBeNull();
      expect(screen.queryByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeNull();
      expect(transport.cancel).not.toHaveBeenCalled();
    },
  );
});
