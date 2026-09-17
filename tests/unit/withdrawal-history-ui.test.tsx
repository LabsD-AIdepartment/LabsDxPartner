import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { RequestStatusValue, WithdrawalRequestValue } from '@/contracts/withdrawal-journey';
import {
  WithdrawalHistory,
  type WithdrawalHistoryProps,
} from '@/features/withdrawals/WithdrawalHistory';
import { WithdrawalStatus } from '@/features/withdrawals/WithdrawalStatus';
import { formatMinor } from '@/shared/ui/format-money';
import { timestamp } from '@/shared/ui/format-date';

const money = (minor: string) => ({ currency: 'THB' as const, minor });
function request(
  ref = 'SYNTH-request-1',
  status: RequestStatusValue = 'requested',
): WithdrawalRequestValue {
  return {
    requestRef: ref,
    idempotencyKey: `key-${ref}`,
    scope: {
      userId: 'SYNTH-user',
      partnerId: 'SYNTH-partner',
      permissionRevision: 'SYNTH-permission',
      payerId: 'SYNTH-payer',
      currency: 'THB',
      scenario: 'golden',
    },
    status,
    gross: money('500000'),
    net: money('485000'),
    deductions: [{ kind: 'withholding_tax', label: 'รายการหักที่กำหนด', amount: money('15000') }],
    reserved: money(['paid', 'cancelled', 'failed'].includes(status) ? '0' : '500000'),
    beneficiary: {
      displayName: 'ผู้รับตัวอย่าง',
      bankName: 'ธนาคารตัวอย่าง',
      maskedAccount: '••••1234',
      version: 'SYNTH-beneficiary',
    },
    quoteId: 'SYNTH-quote',
    bindings: {
      balanceRevision: 'SYNTH-balance',
      policyRevision: 'SYNTH-policy',
      beneficiaryVersion: 'SYNTH-beneficiary',
    },
    submittedAt: '2026-09-16T01:00:00Z',
    allowedActions: ['cancel', 'check_status'],
  };
}
function props(overrides: Partial<WithdrawalHistoryProps> = {}): WithdrawalHistoryProps {
  return {
    requests: [request()],
    filters: { status: 'all', from: '', toExclusive: '' },
    onFiltersChange: vi.fn(),
    requestHref: (ref) =>
      `/transactions-preview?view=withdrawals&identity=a&request=${encodeURIComponent(ref)}`,
    state: 'ready',
    ...overrides,
  };
}

describe('Withdrawal history presentation', () => {
  it('shows the exact supplied gross/net/date/reference and uses only the injected scoped link', () => {
    const item = request();
    const href =
      '/transactions-preview?view=withdrawals&identity=b&scenario=applies-wht&request=safe-ref';
    const requestHref = vi.fn(() => href);
    render(<WithdrawalHistory {...props({ requestHref })} />);
    const row = screen.getByRole('link', { name: `ดูรายละเอียดคำขอ ${item.requestRef}` });
    expect(row).toHaveAttribute('href', href);
    expect(requestHref).toHaveBeenCalledWith(item.requestRef);
    expect(within(row).getByText('฿5,000.00')).toBeVisible();
    expect(within(row).getByText('฿4,850.00')).toBeVisible();
    expect(within(row).getByText(timestamp(item.submittedAt))).toHaveAttribute(
      'datetime',
      item.submittedAt,
    );
    expect(within(row).getByText('รอดำเนินการ')).toBeVisible();
    expect(within(row).queryByText('โอนเงินแล้ว')).toBeNull();
    expect(screen.queryByRole('button', { name: /ยกเลิก|โอน|ถอนเงิน/ })).toBeNull();
  });

  it('renders all 200 supplied rows in supplied order without paging or hiding terminal statuses', () => {
    const statuses: RequestStatusValue[] = [
      'requested',
      'processing',
      'paid',
      'cancelled',
      'failed',
      'reconciling',
    ];
    const items = Array.from({ length: 200 }, (_, i) =>
      request(`SYNTH-${199 - i}`, statuses[i % statuses.length]),
    );
    render(<WithdrawalHistory {...props({ requests: items })} />);
    const list = screen.getByRole('list', { name: 'รายการคำขอถอนเงิน' });
    const links = within(list).getAllByRole('link');
    expect(within(list).getAllByRole('listitem')).toHaveLength(200);
    expect(links[0]).toHaveAccessibleName('ดูรายละเอียดคำขอ SYNTH-199');
    expect(links.at(-1)).toHaveAccessibleName('ดูรายละเอียดคำขอ SYNTH-0');
    expect(screen.queryByRole('button', { name: /ถัดไป|ก่อนหน้า|โหลดเพิ่มเติม/ })).toBeNull();
    for (const label of [
      'รอดำเนินการ',
      'กำลังดำเนินการโอน',
      'โอนเงินแล้ว',
      'คำขอถูกยกเลิกแล้ว',
      'คำขอไม่สำเร็จ',
      'ยังยืนยันผลการโอนไม่ได้',
    ])
      expect(within(list).getAllByText(label).length).toBeGreaterThan(0);
  });

  it('emits raw controlled filter values without filtering rows or rewriting date boundaries itself', () => {
    const onFiltersChange = vi.fn();
    const p = props({ onFiltersChange });
    const { rerender } = render(<WithdrawalHistory {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะคำขอถอน' }), {
      target: { value: 'paid' },
    });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ status: 'paid', from: '', toExclusive: '' });
    expect(screen.getByRole('combobox')).toHaveValue('all');
    fireEvent.change(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่'), {
      target: { value: '2026-09-02' },
    });
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      status: 'all',
      from: '2026-09-02',
      toExclusive: '',
    });
    fireEvent.change(screen.getByLabelText('ถึงก่อนวันที่ (ไม่รวมวันนี้)'), {
      target: { value: '2026-10-01' },
    });
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      status: 'all',
      from: '',
      toExclusive: '2026-10-01',
    });
    rerender(
      <WithdrawalHistory
        {...p}
        filters={{ status: 'paid', from: '2026-09-02', toExclusive: '2026-10-01' }}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('paid');
    // Rows have already been filtered upstream. The view must not silently become an authority.
    expect(screen.getByRole('link', { name: 'ดูรายละเอียดคำขอ SYNTH-request-1' })).toBeVisible();
    expect(
      screen.getByText('กรองตามวันที่ส่งคำขอ ตัวกรองนี้ไม่เปลี่ยนยอดพร้อมถอนสะสม'),
    ).toBeVisible();
  });

  it('distinguishes known empty history from no matching rows and preserves controls', () => {
    const p = props({ requests: [] });
    const { rerender } = render(<WithdrawalHistory {...p} emptyKind="history" />);
    expect(screen.getByRole('status')).toHaveTextContent('ยังไม่มีคำขอถอนเงิน');
    expect(screen.queryByRole('list')).toBeNull();
    rerender(
      <WithdrawalHistory
        {...p}
        emptyKind="filtered"
        filters={{ status: 'paid', from: '', toExclusive: '' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้');
    expect(screen.getByRole('combobox')).toHaveValue('paid');
    expect(screen.queryByText('฿0')).toBeNull();
  });

  it.each([
    ['loading', 'กำลังโหลดคำขอถอนเงิน'],
    ['read-error', 'โหลดคำขอถอนเงินไม่สำเร็จ กรุณาลองอีกครั้ง'],
    ['invalid', 'ตรวจสอบความถูกต้องของข้อมูลคำขอไม่ได้ กรุณาโหลดข้อมูลล่าสุด'],
    ['unavailable', 'ยังไม่มีข้อมูลประวัติคำขอถอนเงินจากต้นทาง'],
  ] as const)('hides previously supplied private rows in %s state', (state, message) => {
    const requestHref = vi.fn(() => '/safe');
    const onRetry = vi.fn();
    render(<WithdrawalHistory {...props({ state, requestHref, onRetry })} />);
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('เลขอ้างอิง SYNTH-request-1')).toBeNull();
    expect(screen.queryByText('฿5,000.00')).toBeNull();
    expect(requestHref).not.toHaveBeenCalled();
    if (state === 'loading') {
      expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('button')).toBeNull();
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    }
  });

  it('preserves explicitly stale rows with a freshness notice and retry, but has no financial mutation actions', () => {
    const onRetry = vi.fn();
    render(<WithdrawalHistory {...props({ state: 'stale', onRetry })} />);
    expect(screen.getByRole('status')).toHaveTextContent('แสดงคำขอครั้งล่าสุด');
    expect(screen.getByRole('link')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('updates visible identity and links directly from new parent props without retaining old rows', () => {
    const first = props();
    const { rerender } = render(<WithdrawalHistory {...first} />);
    rerender(
      <WithdrawalHistory
        {...first}
        requests={[request('SYNTH-other-ref', 'paid')]}
        requestHref={(ref) => `/other-scope?request=${ref}`}
      />,
    );
    expect(screen.queryByText('เลขอ้างอิง SYNTH-request-1')).toBeNull();
    const row = screen.getByRole('link', { name: 'ดูรายละเอียดคำขอ SYNTH-other-ref' });
    expect(row).toHaveAttribute('href', '/other-scope?request=SYNTH-other-ref');
    expect(within(row).getByText('โอนเงินแล้ว')).toBeVisible();
  });

  it('preserves huge exact minor amounts and long references without Number conversion or text truncation', () => {
    const ref = 'SYNTH-' + 'r'.repeat(190);
    const gross = '9999999999999999999999999999999999999999';
    const net = '9999999999999999999999999999999999999998';
    render(
      <WithdrawalHistory
        {...props({
          requests: [
            {
              ...request(ref),
              gross: money(gross),
              net: money(net),
              reserved: money(gross),
              deductions: [{ kind: 'other', label: 'รายการหักหนึ่งสตางค์', amount: money('1') }],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(`เลขอ้างอิง ${ref}`)).toBeVisible();
    expect(screen.getByText(formatMinor(gross, false))).toBeVisible();
    expect(screen.getByText(formatMinor(net, false))).toBeVisible();
  });

  it('renders supplied filter error with an accessible group description without applying its own validation', () => {
    const message = 'วันที่สิ้นสุดต้องอยู่หลังวันที่เริ่ม';
    render(<WithdrawalHistory {...props({ filterError: message })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('group', { name: 'ตัวกรองคำขอถอนเงิน' })).toHaveAccessibleDescription(
      expect.stringContaining(message),
    );
  });
});

describe('Withdrawal status presentation', () => {
  it.each([
    ['requested', 'รอดำเนินการ'],
    ['processing', 'กำลังดำเนินการโอน'],
    ['paid', 'โอนเงินแล้ว'],
    ['cancelled', 'คำขอถูกยกเลิกแล้ว'],
    ['failed', 'คำขอไม่สำเร็จ'],
    ['reconciling', 'ยังยืนยันผลการโอนไม่ได้'],
  ] as const)('labels only the supplied %s state without inventing an action', (status, label) => {
    render(<WithdrawalStatus status={status} />);
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
