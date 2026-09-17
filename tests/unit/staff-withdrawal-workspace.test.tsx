import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  WithdrawalRequestDetailValue,
  WithdrawalScopeValue,
} from '@/contracts/withdrawal-journey';
import {
  StaffWithdrawalWorkspace,
  type StaffWithdrawalWorkspaceProps,
  type StaffWithdrawalRosterEntry,
} from '@/features/withdrawals/StaffWithdrawalWorkspace';
import type { WithdrawalHistoryTransport } from '@/features/withdrawals/model';

const money = (minor: string) => ({ currency: 'THB' as const, minor });
function fixture(id = 'a') {
  const scope: WithdrawalScopeValue = {
    userId: `user-${id}`,
    partnerId: `partner-${id}`,
    permissionRevision: '1',
    payerId: `payer-${id}`,
    currency: 'THB',
    scenario: 'golden',
  };
  const detail: WithdrawalRequestDetailValue = {
    request: {
      scope,
      requestRef: 'shared-ref',
      idempotencyKey: 'shared-key',
      status: 'requested',
      gross: money('500000'),
      net: money('485000'),
      reserved: money('500000'),
      deductions: [{ kind: 'withholding_tax', label: 'ภาษีตัวอย่าง', amount: money('15000') }],
      beneficiary: {
        displayName: `ผู้รับ ${id}`,
        bankName: 'ธนาคารตัวอย่าง',
        maskedAccount: '••••1234',
        version: '1',
      },
      quoteId: 'quote-1',
      bindings: { balanceRevision: '1', policyRevision: '1', beneficiaryVersion: '1' },
      submittedAt: '2026-09-16T00:00:00Z',
      allowedActions: ['cancel', 'check_status'],
    },
    revision: 'detail-1',
    historyComplete: true,
    timeline: [
      { seq: 1, at: '2026-09-16T00:00:00Z', kind: 'submitted', status: 'requested', detail: null },
    ],
    sourceContext: { state: 'known', periods: [], allocationModeled: false },
    documents: { state: 'pending', reasons: ['เอกสารตัวอย่างยังไม่พร้อม'] },
    pendingCancellations: [],
  };
  const response = { detail, rows: [detail.request] };
  const unused = vi.fn(async () => {
    throw new Error('No financial/config command permitted');
  });
  const envelope = () => ({
    scope,
    asOf: '2026-09-16T01:00:00Z',
    revision: 'list-1',
    nextCursor: null,
    items: response.rows,
  });
  const transport = {
    summary: unused,
    quote: unused,
    submit: unused,
    recover: unused,
    cancel: unused,
    recoverCancellation: unused,
    list: vi.fn<WithdrawalHistoryTransport['list']>(async () => envelope()),
    detail: vi.fn<WithdrawalHistoryTransport['detail']>(async () => ({
      state: 'found',
      detail: response.detail,
    })),
  } satisfies WithdrawalHistoryTransport;
  const entry: StaffWithdrawalRosterEntry = {
    id,
    label: `พาร์ตเนอร์ ${id}`,
    scope,
    transport,
    refreshKey: 0,
  };
  return { entry, transport, response, unused, envelope };
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function mount(
  roster: readonly StaffWithdrawalRosterEntry[],
  overrides: Partial<StaffWithdrawalWorkspaceProps> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
  let props: StaffWithdrawalWorkspaceProps = {
    roster,
    filters: { partner: '', status: 'all', from: '', toExclusive: '' },
    onFiltersChange: vi.fn(),
    requestHref: (id, ref) => `/ops-preview/requests?identity=${id}&request=${ref}`,
    backHref: '/caller-back',
    ...overrides,
  };
  const tree = () => (
    <QueryClientProvider client={client}>
      <StaffWithdrawalWorkspace {...props} />
    </QueryClientProvider>
  );
  const result = render(tree());
  return {
    ...result,
    client,
    update: (next: Partial<StaffWithdrawalWorkspaceProps>) => {
      props = { ...props, ...next };
      result.rerender(tree());
    },
  };
}
const queueLink = (id: string) =>
  screen.getByRole('link', { name: `ดูรายละเอียดคำขอ shared-ref ของ พาร์ตเนอร์ ${id}` });

describe('StaffWithdrawalWorkspace validated read controller', () => {
  it('shows same local ref in two namespaces using caller URLs and makes no financial commands', async () => {
    const a = fixture('a');
    const b = fixture('b');
    const requestHref = vi.fn((id: string, ref: string) => `/safe/${id}/${ref}`);
    mount([a.entry, b.entry], { requestHref });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(queueLink('a')).toHaveAttribute('href', '/safe/a/shared-ref');
    expect(queueLink('b')).toHaveAttribute('href', '/safe/b/shared-ref');
    expect(within(queueLink('a')).getByText('฿5,000.00')).toBeVisible();
    expect(a.unused).not.toHaveBeenCalled();
    expect(b.unused).not.toHaveBeenCalled();
    expect(a.transport.detail).not.toHaveBeenCalled();
  });

  it('reads only the selected partner and ignores unselected outage and refresh notifications', async () => {
    const a = fixture('a');
    const b = fixture('b');
    b.transport.list.mockRejectedValue(new Error('unavailable'));
    const view = mount([a.entry, b.entry], {
      filters: { partner: 'a', status: 'all', from: '', toExclusive: '' },
    });
    await waitFor(() => expect(queueLink('a')).toBeVisible());
    expect(b.transport.list).not.toHaveBeenCalled();
    view.update({ roster: [a.entry, { ...b.entry, refreshKey: 1 }] });
    expect(queueLink('a')).toBeVisible();
    expect(a.transport.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([true, false])(
    'shows incomplete rather than complete empty on partial error with valid rows=%s',
    async (hasRows) => {
      const a = fixture('a');
      const b = fixture('b');
      if (!hasRows) a.response.rows = [];
      b.transport.list.mockRejectedValue(new Error('offline'));
      mount([a.entry, b.entry]);
      expect(await screen.findByRole('alert')).toHaveTextContent('รายการนี้ยังไม่ครบ');
      expect(screen.queryAllByRole('listitem')).toHaveLength(hasRows ? 1 : 0);
      expect(screen.queryByText(/ยังไม่มีคำขอถอนเงินของ|ไม่มีคำขอถอนเงินที่ตรง/)).toBeNull();
    },
  );

  it('shows read error after all reads fail and retry only performs reads', async () => {
    const a = fixture();
    a.transport.list.mockRejectedValueOnce(new Error('offline'));
    mount([a.entry]);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดคำขอถอนเงินไม่สำเร็จ');
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    await waitFor(() => expect(queueLink('a')).toBeVisible());
    expect(a.transport.list).toHaveBeenCalledTimes(2);
    expect(a.unused).not.toHaveBeenCalled();
  });

  it('aborts obsolete reads and hides their late reply after a partner switch', async () => {
    const a = fixture('a');
    const b = fixture('b');
    const slow = deferred();
    a.transport.list.mockReturnValue(slow.promise);
    const view = mount([a.entry, b.entry], {
      filters: { partner: 'a', status: 'all', from: '', toExclusive: '' },
    });
    await waitFor(() => expect(a.transport.list).toHaveBeenCalledTimes(1));
    const signal = a.transport.list.mock.calls[0][0].signal;
    view.update({ filters: { partner: 'b', status: 'all', from: '', toExclusive: '' } });
    expect(screen.queryByRole('list')).toBeNull();
    await waitFor(() => expect(queueLink('b')).toBeVisible());
    expect(signal.aborted).toBe(true);
    await act(async () => slow.resolve(a.envelope()));
    expect(screen.queryByRole('link', { name: /ของ พาร์ตเนอร์ a/ })).toBeNull();
    expect(queueLink('b')).toBeVisible();
  });

  it('hides an old same-id scope synchronously and rejects a foreign response envelope', async () => {
    const a = fixture('a');
    const foreign = fixture('b');
    const slow = deferred();
    const view = mount([a.entry]);
    await waitFor(() => expect(queueLink('a')).toBeVisible());
    foreign.transport.list.mockReturnValue(slow.promise);
    view.update({ roster: [{ ...foreign.entry, id: 'a', label: 'NEW SCOPE' }] });
    expect(screen.queryByRole('list')).toBeNull();
    await act(async () => slow.resolve(a.envelope()));
    expect(await screen.findByRole('alert')).toHaveTextContent('ตรวจสอบความถูกต้อง');
    expect(screen.queryByText('฿5,000.00')).toBeNull();
  });

  it('does not trust a foreign nested row even if the list envelope has the selected scope', async () => {
    const a = fixture('a');
    const b = fixture('b');
    a.response.rows = [b.response.detail.request];
    mount([a.entry]);
    expect(await screen.findByRole('alert')).toHaveTextContent('ตรวจสอบความถูกต้อง');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('filters Bangkok midnight half-open dates and status without re-querying financial scope', async () => {
    const a = fixture();
    a.response.rows = [
      ['before', '2026-09-15T16:59:59Z'],
      ['start', '2026-09-15T17:00:00Z'],
      ['end-inside', '2026-09-16T16:59:59Z'],
      ['end', '2026-09-16T17:00:00Z'],
    ].map(([requestRef, submittedAt]) => ({
      ...a.response.detail.request,
      requestRef,
      idempotencyKey: requestRef,
      submittedAt,
    }));
    const view = mount([a.entry]);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4));
    view.update({
      filters: { partner: '', status: 'requested', from: '2026-09-16', toExclusive: '2026-09-17' },
    });
    const links = within(screen.getByRole('list')).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAccessibleName('ดูรายละเอียดคำขอ start ของ พาร์ตเนอร์ a');
    expect(links[1]).toHaveAccessibleName('ดูรายละเอียดคำขอ end-inside ของ พาร์ตเนอร์ a');
    expect(a.transport.list).toHaveBeenCalledTimes(1);
    view.update({ filters: { partner: '', status: 'paid', from: '', toExclusive: '' } });
    expect(screen.getByRole('status')).toHaveTextContent('ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้');
    expect(a.transport.list).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['2026-02-30', '', 'กรุณาระบุวันที่ให้ถูกต้อง'],
    ['2026-09-17', '2026-09-16', 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น'],
  ])(
    'announces date errors instead of known-empty for %s/%s',
    async (from, toExclusive, message) => {
      const a = fixture();
      a.response.rows = [];
      mount([a.entry], { filters: { partner: '', status: 'all', from, toExclusive } });
      await waitFor(() => expect(screen.queryByText('กำลังโหลดคำขอถอนเงิน')).toBeNull());
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByText(/ยังไม่มีคำขอถอนเงินของ|ไม่มีคำขอถอนเงินที่ตรง/)).toBeNull();
      expect(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    },
  );

  it.each(['partner', 'status'] as const)(
    'treats invalid %s as invalid selection without marking dates invalid',
    async (field) => {
      const a = fixture();
      const view = mount([a.entry]);
      await waitFor(() => expect(queueLink('a')).toBeVisible());
      view.update({
        filters: {
          partner: '',
          status: 'all',
          from: '',
          toExclusive: '',
          [field]: 'foreign',
        } as StaffWithdrawalWorkspaceProps['filters'],
      });
      expect(screen.getByRole('alert')).toHaveTextContent('ตรวจสอบความถูกต้อง');
      expect(screen.queryByRole('list')).toBeNull();
      expect(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่')).toHaveAttribute(
        'aria-invalid',
        'false',
      );
      expect(screen.getByLabelText('ถึงก่อนวันที่ (ไม่รวมวันนี้)')).toHaveAttribute(
        'aria-invalid',
        'false',
      );
    },
  );

  it('refreshKey hides previous content while fresh read is pending and never flashes known empty', async () => {
    const a = fixture();
    const slow = deferred();
    const view = mount([a.entry]);
    await waitFor(() => expect(queueLink('a')).toBeVisible());
    a.transport.list.mockReturnValueOnce(slow.promise);
    view.update({ roster: [{ ...a.entry, refreshKey: 1 }] });
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดคำขอถอนเงิน');
    expect(screen.queryByText(/ยังไม่มีคำขอถอนเงินของ|ไม่มีคำขอถอนเงินที่ตรง/)).toBeNull();
    await act(async () => slow.resolve(a.envelope()));
    await waitFor(() => expect(queueLink('a')).toBeVisible());
    expect(a.transport.list).toHaveBeenCalledTimes(2);
  });

  it('preserves the focused date input and controlled draft during an automatic same-scope refresh', async () => {
    const a = fixture();
    const slow = deferred();
    const onFiltersChange = vi.fn();
    const filters = { partner: '', status: 'all' as const, from: '2026-09-16', toExclusive: '' };
    const view = mount([a.entry], { filters, onFiltersChange });
    await waitFor(() => expect(queueLink('a')).toBeVisible());
    const field = screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่');
    field.focus();
    expect(field).toHaveFocus();
    a.transport.list.mockReturnValueOnce(slow.promise);
    view.update({ roster: [{ ...a.entry, refreshKey: 1 }] });
    expect(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่')).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveValue('2026-09-16');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดคำขอถอนเงิน');
    fireEvent.change(field, { target: { value: '2026-09-15' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, from: '2026-09-15' });
    view.update({ filters: { ...filters, from: '2026-09-15' } });
    await act(async () => slow.resolve(a.envelope()));
    await waitFor(() => expect(queueLink('a')).toBeVisible());
    expect(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่')).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveValue('2026-09-15');
    expect(a.transport.list).toHaveBeenCalledTimes(2);
  });

  it('opens detail only for the selected partner/ref and permits only an allowed read-only status check', async () => {
    const a = fixture('a');
    const b = fixture('b');
    const view = mount([a.entry, b.entry], {
      selection: { selectionId: 'b', requestRef: 'shared-ref' },
    });
    expect(await screen.findByText('ผู้รับ b')).toBeVisible();
    const detailCard = within(screen.getByRole('article', { name: 'รายละเอียดคำขอถอน' }));
    const backNavigation = within(
      screen.getByRole('navigation', { name: 'กลับรายการคำขอถอนเงิน' }),
    );
    for (const back of [
      backNavigation.getByRole('link', { name: 'กลับคำขอถอนเงินทั้งหมด' }),
      detailCard.getByRole('link', { name: 'กลับคำขอถอนเงินทั้งหมด' }),
    ]) {
      expect(back).toHaveAttribute('href', '/caller-back');
    }
    expect(a.transport.detail).not.toHaveBeenCalled();
    expect(a.transport.list).not.toHaveBeenCalled();
    expect(b.transport.list).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /ยกเลิก/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอ' }));
    await waitFor(() => expect(b.transport.detail).toHaveBeenCalledTimes(2));
    expect(b.unused).not.toHaveBeenCalled();
    b.response.detail = {
      ...b.response.detail,
      request: { ...b.response.detail.request, allowedActions: ['cancel'] },
    };
    view.update({ roster: [a.entry, { ...b.entry, refreshKey: 1 }] });
    expect(await screen.findByText('ผู้รับ b')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ตรวจสอบสถานะคำขอ' })).toBeNull();
    expect(screen.queryByRole('button', { name: /ยกเลิก/ })).toBeNull();
  });

  it('fences late detail after switching identical refs between partners and hides foreign replies', async () => {
    const a = fixture('a');
    const b = fixture('b');
    const slow = deferred();
    a.transport.detail.mockReturnValue(slow.promise);
    const view = mount([a.entry, b.entry], {
      selection: { selectionId: 'a', requestRef: 'shared-ref' },
    });
    await waitFor(() => expect(a.transport.detail).toHaveBeenCalledTimes(1));
    view.update({ selection: { selectionId: 'b', requestRef: 'shared-ref' } });
    expect(await screen.findByText('ผู้รับ b')).toBeVisible();
    await act(async () => slow.resolve({ state: 'found', detail: a.response.detail }));
    expect(screen.queryByText('ผู้รับ a')).toBeNull();
    b.transport.detail.mockResolvedValue({ state: 'found', detail: a.response.detail });
    view.update({ roster: [a.entry, { ...b.entry, refreshKey: 1 }] });
    expect(screen.queryByText('ผู้รับ b')).toBeNull();
    expect(await screen.findByRole('alert')).toHaveTextContent('ตรวจสอบความถูกต้องของรายละเอียด');
    expect(screen.queryByText('ผู้รับ a')).toBeNull();
  });

  it('handles missing/unknown selection and empty roster without inventing empty history', async () => {
    const a = fixture();
    a.transport.detail.mockResolvedValue({
      state: 'missing',
      scope: a.entry.scope,
      requestRef: 'shared-ref',
    });
    const view = mount([a.entry], { selection: { selectionId: 'a', requestRef: 'shared-ref' } });
    expect(await screen.findByText('ไม่พบคำขอถอนเงินในขอบเขตนี้')).toBeVisible();
    view.update({ selection: { selectionId: 'foreign', requestRef: 'shared-ref' } });
    expect(screen.getByRole('alert')).toHaveTextContent('ตรวจสอบความถูกต้องของรายละเอียด');
    expect(a.transport.detail).toHaveBeenCalledTimes(1);
    view.update({ selection: null, roster: [] });
    expect(screen.getByRole('status')).toHaveTextContent('ยังไม่มีข้อมูลคำขอถอนเงินจากต้นทาง');
    expect(screen.queryByText('ยังไม่มีคำขอถอนเงินของพาร์ตเนอร์ที่เลือก')).toBeNull();
  });
});
