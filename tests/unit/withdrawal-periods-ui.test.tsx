import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { WithdrawalPeriodsViewValue } from '@/contracts/withdrawal-journey';
import { StaffWithdrawalPeriods } from '@/features/withdrawals/StaffWithdrawalPeriods';
import { WithdrawalGatewayCard } from '@/features/withdrawals/WithdrawalGatewayCard';
import { formatMinor } from '@/shared/ui/format-money';
import { timestamp } from '@/shared/ui/format-date';

const money = (minor: string) => ({ currency: 'THB' as const, minor });
function sample(): WithdrawalPeriodsViewValue {
  return {
    scope: {
      userId: 'SYNTH-a',
      partnerId: 'SYNTH-partner',
      permissionRevision: '1',
      payerId: 'SYNTH-payer',
      currency: 'THB',
      scenario: 'golden',
    },
    revision: 'periods-1',
    asOf: '2026-09-16T04:00:00Z',
    currentPeriod: {
      periodId: 'SYNTH-current',
      label: 'งวดปัจจุบันตัวอย่าง',
      from: '2026-08-31T17:00:00Z',
      toExclusive: '2026-09-30T17:00:00Z',
    },
    currentPeriodPending: money('700000'),
    released: [
      {
        periodId: 'SYNTH-released',
        label: 'งวดที่ปล่อยแล้วตัวอย่าง',
        releasedAt: '2026-08-01T03:00:00Z',
        releasedAmount: money('2000000'),
        statementId: 'SYNTH-statement',
      },
    ],
    releasable: [
      {
        periodId: 'SYNTH-eligible',
        label: 'งวดเข้าเกณฑ์ตัวอย่าง',
        eligibleAmount: money('600000'),
      },
    ],
  };
}

describe('StaffWithdrawalPeriods controlled presentation', () => {
  it('separates current pending, released and eligible supplied amounts without claiming transfer or adding actions', () => {
    const periods = sample();
    render(<StaffWithdrawalPeriods periods={periods} state="ready" />);
    const current = screen.getByRole('region', { name: 'งวดปัจจุบันที่รอยืนยัน' });
    expect(within(current).getByText('งวดปัจจุบันตัวอย่าง')).toBeVisible();
    expect(within(current).getByText('฿7,000.00')).toBeVisible();
    const released = screen.getByRole('region', { name: 'งวดที่ปล่อยยอดแล้ว' });
    expect(within(released).getByText('ยอดที่ปล่อยเข้าสู่ยอดสะสม')).toBeVisible();
    expect(within(released).getByText('฿20,000.00')).toBeVisible();
    const eligible = screen.getByRole('region', { name: 'งวดที่เข้าเกณฑ์รอปล่อยยอด' });
    expect(within(eligible).getByText('฿6,000.00')).toBeVisible();
    expect(within(eligible).getByText('ยอดส่วนนี้ยังไม่ได้ปล่อยเข้าสู่ยอดสะสม')).toBeVisible();
    expect(
      screen.getByText('การปล่อยยอดเพิ่มยอดสะสมของพาร์ตเนอร์ ไม่ใช่การโอนเงินเข้าบัญชี'),
    ).toBeVisible();
    expect(screen.queryByText('฿33,000.00')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/โอนเงินแล้ว|กำหนดโอน|อนุมัติแล้ว/)).toBeNull();
  });

  it('shows the supplied Bangkok period window as half-open plus actual release/asOf times', () => {
    const periods = sample();
    render(<StaffWithdrawalPeriods periods={periods} state="ready" />);
    const current = screen.getByRole('region', { name: 'งวดปัจจุบันที่รอยืนยัน' });
    const from = periods.currentPeriod!.from;
    const to = periods.currentPeriod!.toExclusive;
    expect(within(current).getByText(timestamp(from))).toHaveAttribute('datetime', from);
    expect(within(current).getByText(timestamp(to))).toHaveAttribute('datetime', to);
    expect(within(current).getByText(/ถึงก่อน/)).toHaveTextContent('(เวลาไทย)');
    expect(within(current).getByText(/1 ก.ย. 2569 00:00/)).toBeVisible();
    const releasedAt = periods.released[0].releasedAt!;
    expect(screen.getByText(timestamp(releasedAt))).toHaveAttribute('datetime', releasedAt);
    expect(screen.getByText(timestamp(periods.asOf))).toHaveAttribute('datetime', periods.asOf);
  });

  it('keeps legacy unknown release amount/time honest without substituting asOf or zero', () => {
    const periods = sample();
    periods.released[0] = {
      ...periods.released[0],
      releasedAmount: null,
      releasedAt: null,
      statementId: null,
    };
    render(<StaffWithdrawalPeriods periods={periods} state="ready" />);
    const released = screen.getByRole('region', { name: 'งวดที่ปล่อยยอดแล้ว' });
    expect(within(released).getByText('ยังไม่มีข้อมูลเวลาที่ปล่อยยอด')).toBeVisible();
    expect(within(released).getByLabelText('ยังไม่มีข้อมูลจำนวนเงินที่ปล่อย')).toHaveTextContent(
      '—',
    );
    expect(within(released).queryByText(timestamp(periods.asOf))).toBeNull();
    expect(released.querySelector('time')).toBeNull();
    expect(within(released).queryByText('฿0.00')).toBeNull();
  });

  it('distinguishes unknown current period and pending from a known zero amount', () => {
    const periods = { ...sample(), currentPeriod: null, currentPeriodPending: null };
    const { rerender } = render(<StaffWithdrawalPeriods periods={periods} state="ready" />);
    const current = screen.getByRole('region', { name: 'งวดปัจจุบันที่รอยืนยัน' });
    expect(within(current).getByText('ยังไม่มีข้อมูลระบุงวดปัจจุบัน')).toBeVisible();
    expect(
      within(current).getByLabelText('ยังไม่มีข้อมูลรายได้งวดปัจจุบันที่รอยืนยัน'),
    ).toHaveTextContent('—');
    expect(within(current).queryByText('฿0.00')).toBeNull();
    rerender(
      <StaffWithdrawalPeriods
        periods={{ ...periods, currentPeriodPending: money('0') }}
        state="ready"
      />,
    );
    expect(within(current).getByText('฿0.00')).toBeVisible();
    expect(
      within(current).queryByLabelText('ยังไม่มีข้อมูลรายได้งวดปัจจุบันที่รอยืนยัน'),
    ).toBeNull();
  });

  it('shows known-empty sections only with a visible validated snapshot; absent data remains unavailable', () => {
    const periods = { ...sample(), released: [], releasable: [] };
    const { rerender } = render(<StaffWithdrawalPeriods periods={periods} state="ready" />);
    expect(screen.getByText('ยังไม่มีงวดที่ปล่อยยอดในข้อมูลนี้')).toBeVisible();
    expect(screen.getByText('ไม่มีงวดที่เข้าเกณฑ์รอปล่อยยอดในข้อมูลนี้')).toBeVisible();
    rerender(<StaffWithdrawalPeriods periods={null} state="ready" />);
    expect(screen.getByRole('status')).toHaveTextContent('ยังไม่มีข้อมูลงวดจากต้นทาง');
    expect(screen.queryByText('ยังไม่มีงวดที่ปล่อยยอดในข้อมูลนี้')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it.each(['loading', 'read-error', 'invalid', 'unavailable'] as const)(
    'hides prior scoped data in %s',
    (state) => {
      const periods = sample();
      const onRetry = vi.fn();
      const { rerender } = render(<StaffWithdrawalPeriods periods={periods} state="ready" />);
      rerender(<StaffWithdrawalPeriods periods={periods} state={state} onRetry={onRetry} />);
      expect(screen.queryByText('งวดปัจจุบันตัวอย่าง')).toBeNull();
      expect(screen.queryByText('งวดที่ปล่อยแล้วตัวอย่าง')).toBeNull();
      expect(screen.queryByText('งวดเข้าเกณฑ์ตัวอย่าง')).toBeNull();
      expect(screen.queryByText('฿20,000.00')).toBeNull();
      expect(screen.queryByRole('region')).toBeNull();
      if (state === 'loading') {
        expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByRole('button')).toBeNull();
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('allows stale scoped reading with a notice and retry only; stale without a snapshot is unavailable', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <StaffWithdrawalPeriods periods={sample()} state="stale" onRetry={onRetry} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('เพื่ออ่านเท่านั้น');
    expect(screen.getByText('งวดที่ปล่อยแล้วตัวอย่าง')).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<StaffWithdrawalPeriods periods={null} state="stale" />);
    expect(screen.getByRole('status')).toHaveTextContent('ยังไม่มีข้อมูลงวดจากต้นทาง');
    expect(screen.queryByText(/แสดงข้อมูลงวดครั้งล่าสุด/)).toBeNull();
  });

  it('renders every supplied period in order with exact huge amounts and complete long labels', () => {
    const periods = sample();
    const huge = '9999999999999999999999999999999999999999';
    const label = 'ชื่อรอบรายได้ตัวอย่าง'.repeat(7);
    periods.released = Array.from({ length: 30 }, (_, index) => ({
      periodId: `period-${29 - index}`,
      label: `${label}-${29 - index}`,
      releasedAmount: money(huge),
      releasedAt: null,
      statementId: null,
    }));
    render(<StaffWithdrawalPeriods periods={periods} state="ready" />);
    const list = screen.getByRole('list', { name: 'รายการงวดที่ปล่อยยอดแล้ว' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(30);
    expect(within(list).getAllByRole('heading')[0]).toHaveTextContent(`${label}-29`);
    expect(within(list).getAllByRole('heading').at(-1)).toHaveTextContent(`${label}-0`);
    expect(within(list).getAllByText(formatMinor(huge, false))).toHaveLength(30);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('WithdrawalGatewayCard static readiness', () => {
  it('shows not-connected and each supplied reason without credentials, provider selection or transfer actions', () => {
    render(
      <WithdrawalGatewayCard
        gateway={{
          state: 'not_connected',
          reasons: ['ข้อมูลตัวอย่างเท่านั้น', 'ยังไม่ได้ตั้งค่าช่องทางโอนเงิน'],
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ยังไม่ได้เชื่อมต่อระบบโอนเงินจริง');
    const list = screen.getByRole('list', { name: 'เหตุผลที่ยังไม่ได้เชื่อมต่อ' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['ข้อมูลตัวอย่างเท่านั้น', 'ยังไม่ได้ตั้งค่าช่องทางโอนเงิน']);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
