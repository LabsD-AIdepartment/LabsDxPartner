import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { RequestStatusValue, WithdrawalRequestValue } from '@/contracts/withdrawal-journey';
import {
  StaffWithdrawalQueue,
  type StaffWithdrawalQueueProps,
} from '@/features/withdrawals/StaffWithdrawalQueue';
import { formatMinor } from '@/shared/ui/format-money';
import { timestamp } from '@/shared/ui/format-date';

const money = (minor: string) => ({ currency: 'THB' as const, minor });
function row(partner = 'a', ref = 'SYNTH-ref', status: RequestStatusValue = 'requested') {
  const request: WithdrawalRequestValue = {
    requestRef: ref,
    idempotencyKey: `SYNTH-key-${ref}`,
    scope: {
      userId: `SYNTH-user-${partner}`,
      partnerId: `SYNTH-partner-${partner}`,
      permissionRevision: '1',
      payerId: 'SYNTH-payer',
      currency: 'THB',
      scenario: 'golden',
    },
    status,
    gross: money('500000'),
    net: money('485000'),
    deductions: [{ kind: 'withholding_tax', label: 'ภาษีตัวอย่าง', amount: money('15000') }],
    reserved: money(['paid', 'cancelled', 'failed'].includes(status) ? '0' : '500000'),
    beneficiary: {
      displayName: 'ผู้รับตัวอย่าง',
      bankName: 'ธนาคารตัวอย่าง',
      maskedAccount: '••••1234',
      version: '1',
    },
    quoteId: 'SYNTH-quote',
    bindings: { balanceRevision: '1', policyRevision: '1', beneficiaryVersion: '1' },
    submittedAt: '2026-09-15T17:01:00Z',
    allowedActions: ['cancel', 'check_status'],
  };
  return {
    partnerLabel: `พาร์ตเนอร์ ${partner}`,
    request,
    href: `/ops-preview/requests?identity=${partner}&request=${encodeURIComponent(ref)}`,
  };
}
function props(overrides: Partial<StaffWithdrawalQueueProps> = {}): StaffWithdrawalQueueProps {
  return {
    rows: [row()],
    partnerOptions: [
      { id: 'a', label: 'พาร์ตเนอร์ a' },
      { id: 'b', label: 'พาร์ตเนอร์ b' },
    ],
    filters: { partner: '', status: 'all', from: '', toExclusive: '' },
    onFiltersChange: vi.fn(),
    state: 'ready',
    ...overrides,
  };
}

describe('StaffWithdrawalQueue controlled presentation', () => {
  it('shows partner/ref/status, supplied exact amounts, Bangkok date and caller URL without financial actions', () => {
    const item = row();
    item.href = '/ops-preview/requests?identity=a&scenario=golden&request=caller-ref';
    render(<StaffWithdrawalQueue {...props({ rows: [item] })} />);
    const link = screen.getByRole('link', { name: 'ดูรายละเอียดคำขอ SYNTH-ref ของ พาร์ตเนอร์ a' });
    expect(link).toHaveAttribute('href', item.href);
    expect(within(link).getByRole('heading', { name: 'พาร์ตเนอร์ a' })).toBeVisible();
    expect(within(link).getByText('รอดำเนินการ')).toBeVisible();
    expect(within(link).getByText('฿5,000.00')).toBeVisible();
    expect(within(link).getByText('฿4,850.00')).toBeVisible();
    expect(within(link).getByText(timestamp(item.request.submittedAt))).toHaveAttribute(
      'datetime',
      item.request.submittedAt,
    );
    expect(within(link).getByText(/16 ก.ย. 2569/)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('renders all 200 rows in supplied order, despite filters, with each distinct status', () => {
    const statuses: RequestStatusValue[] = [
      'requested',
      'processing',
      'paid',
      'cancelled',
      'failed',
      'reconciling',
    ];
    const rows = Array.from({ length: 200 }, (_, i) =>
      row(i % 2 ? 'b' : 'a', `SYNTH-${199 - i}`, statuses[i % 6]),
    );
    render(
      <StaffWithdrawalQueue
        {...props({
          rows,
          filters: { partner: 'a', status: 'paid', from: '2030-01-01', toExclusive: '' },
        })}
      />,
    );
    const list = screen.getByRole('list');
    const links = within(list).getAllByRole('link');
    expect(within(list).getAllByRole('listitem')).toHaveLength(200);
    expect(links[0]).toHaveAccessibleName('ดูรายละเอียดคำขอ SYNTH-199 ของ พาร์ตเนอร์ a');
    expect(links.at(-1)).toHaveAccessibleName('ดูรายละเอียดคำขอ SYNTH-0 ของ พาร์ตเนอร์ b');
    for (const label of [
      'รอดำเนินการ',
      'กำลังดำเนินการโอน',
      'โอนเงินแล้ว',
      'คำขอถูกยกเลิกแล้ว',
      'คำขอไม่สำเร็จ',
      'ยังยืนยันผลการโอนไม่ได้',
    ]) {
      expect(within(list).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps duplicate local references distinct across scopes and replaces rows directly on scope changes', () => {
    const consoleError = vi.spyOn(console, 'error');
    try {
      const a = row('a');
      const b = row('b');
      const otherPayer = {
        ...a,
        href: '/other-payer',
        request: { ...a.request, scope: { ...a.request.scope, payerId: 'SYNTH-other-payer' } },
      };
      const { rerender } = render(
        <StaffWithdrawalQueue {...props({ rows: [a, b, otherPayer] })} />,
      );
      expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
        a.href,
        b.href,
        otherPayer.href,
      ]);
      rerender(<StaffWithdrawalQueue {...props({ rows: [b] })} />);
      expect(screen.getAllByRole('link')).toHaveLength(1);
      expect(screen.getByRole('link')).toHaveAttribute('href', b.href);
      expect(screen.queryByRole('heading', { name: a.partnerLabel })).toBeNull();
      expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key|unique.*key/i);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('emits controlled partner/status/date selections without retaining or interpreting them', () => {
    const onFiltersChange = vi.fn();
    const initial = props({ onFiltersChange });
    const { rerender } = render(<StaffWithdrawalQueue {...initial} />);
    for (const [label, key, value] of [
      ['พาร์ตเนอร์', 'partner', 'b'],
      ['สถานะคำขอถอน', 'status', 'reconciling'],
      ['วันที่ส่งคำขอ ตั้งแต่', 'from', '2026-09-16'],
      ['ถึงก่อนวันที่ (ไม่รวมวันนี้)', 'toExclusive', '2026-09-17'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(onFiltersChange).toHaveBeenLastCalledWith({ ...initial.filters, [key]: value });
    }
    expect(screen.getByRole('combobox', { name: 'พาร์ตเนอร์' })).toHaveValue('');
    rerender(
      <StaffWithdrawalQueue
        {...initial}
        filters={{
          partner: 'b',
          status: 'reconciling',
          from: '2026-09-16',
          toExclusive: '2026-09-17',
        }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'พาร์ตเนอร์' })).toHaveValue('b');
    expect(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่')).toHaveValue('2026-09-16');
    expect(screen.getByRole('link')).toBeVisible();
  });

  it.each(['loading', 'read-error', 'invalid', 'unavailable'] as const)(
    'hides previous private rows immediately in %s',
    (state) => {
      const onRetry = vi.fn();
      const p = props({ onRetry });
      const { rerender } = render(<StaffWithdrawalQueue {...p} />);
      rerender(<StaffWithdrawalQueue {...p} state={state} />);
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByText('เลขอ้างอิง SYNTH-ref')).toBeNull();
      expect(screen.queryByText('฿5,000.00')).toBeNull();
      if (state === 'loading') {
        expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByRole('button')).toBeNull();
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each([true, false])(
    'warns partial history is incomplete with rows=%s and never claims empty',
    (hasRows) => {
      const onRetry = vi.fn();
      render(
        <StaffWithdrawalQueue
          {...props({ rows: hasRows ? [row()] : [], state: 'partial-error', onRetry })}
        />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        'รายการนี้ยังไม่ครบทุกพาร์ตเนอร์ที่เลือก',
      );
      expect(screen.queryByText(/ยังไม่มีคำขอถอนเงินของ|ไม่มีคำขอถอนเงินที่ตรง/)).toBeNull();
      expect(screen.queryAllByRole('link')).toHaveLength(hasRows ? 1 : 0);
      fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('฿0')).toBeNull();
    },
  );

  it('shows a read-only stale snapshot and retry without mutations or an unqualified empty claim', () => {
    const p = props({ state: 'stale', onRetry: vi.fn() });
    const { rerender } = render(<StaffWithdrawalQueue {...p} />);
    expect(screen.getByRole('status')).toHaveTextContent('เพื่ออ่านเท่านั้น');
    expect(screen.getByRole('link')).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    rerender(<StaffWithdrawalQueue {...p} rows={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('แสดงข้อมูลครั้งล่าสุด');
    expect(screen.queryByText(/ยังไม่มีคำขอถอนเงินของ|ไม่มีคำขอถอนเงินที่ตรง/)).toBeNull();
  });

  it('distinguishes ready empty from filtered empty and never hides a filter error behind known-empty copy', () => {
    const p = props({ rows: [] });
    const { rerender } = render(<StaffWithdrawalQueue {...p} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'ยังไม่มีคำขอถอนเงินของพาร์ตเนอร์ที่เลือก',
    );
    rerender(<StaffWithdrawalQueue {...p} emptyKind="filtered" />);
    expect(screen.getByRole('status')).toHaveTextContent('ไม่มีคำขอถอนเงินที่ตรงกับตัวกรองนี้');
    const error = 'วันที่สิ้นสุดต้องอยู่หลังวันที่เริ่ม';
    rerender(<StaffWithdrawalQueue {...p} filterError={error} />);
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('group')).toHaveAccessibleDescription(expect.stringContaining(error));
    expect(screen.getByLabelText('วันที่ส่งคำขอ ตั้งแต่')).toHaveAttribute('aria-invalid', 'true');
  });

  it('retains long labels/references and exact huge amounts without truncating or aggregating them', () => {
    const item = row('a', 'SYNTH-' + 'r'.repeat(190));
    item.partnerLabel = 'พาร์ตเนอร์ตัวอย่าง'.repeat(30);
    item.request.gross = money('9999999999999999999999999999999999999999');
    item.request.net = money('9999999999999999999999999999999999999998');
    render(<StaffWithdrawalQueue {...props({ rows: [item] })} />);
    const link = screen.getByRole('link');
    expect(within(link).getByText(item.partnerLabel)).toBeVisible();
    expect(within(link).getByText(`เลขอ้างอิง ${item.request.requestRef}`)).toBeVisible();
    expect(within(link).getByText(formatMinor(item.request.gross.minor, false))).toBeVisible();
    expect(within(link).getByText(formatMinor(item.request.net!.minor, false))).toBeVisible();
  });
});
