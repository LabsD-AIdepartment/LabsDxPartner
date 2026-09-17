import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PayoutBeneficiaryPanel } from '@/features/withdrawals/PayoutBeneficiaryPanel';
import { createWithdrawalController } from '../../dev/withdrawals/controller';
import { previewScopeFor } from '../../dev/withdrawals/navigation';

function config() {
  return createWithdrawalController({ scope: previewScopeFor('golden', 'a') }).beneficiaryConfig();
}
describe('controlled current payout beneficiary', () => {
  it('renders masked current metadata and demo verification, without payment or provider actions', () => {
    const value = config();
    render(<PayoutBeneficiaryPanel config={value} state="ready" onEdit={vi.fn()} compact />);
    expect(screen.getByText(value.displayName!)).toBeInTheDocument();
    expect(screen.getByText(value.maskedAccount!)).toBeInTheDocument();
    expect(screen.queryByText('ยืนยันบัญชีรับเงินแล้วใน DEMO')).not.toBeInTheDocument();
    expect(screen.getByText(/แยกจากผู้รับเงินที่บันทึกไว้ในคำขอเดิม/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
  it('pending retains the saved name and masked identity without claiming verified', () => {
    render(<PayoutBeneficiaryPanel config={{ ...config(), state: 'pending' }} state="ready" />);
    expect(screen.getByText('รอตรวจสอบบัญชีรับเงินใน DEMO')).toBeInTheDocument();
    expect(screen.getByText(config().displayName!)).toBeInTheDocument();
    expect(screen.queryByText('ยืนยันบัญชีรับเงินแล้วใน DEMO')).not.toBeInTheDocument();
  });
  it.each(['loading', 'read-error', 'invalid', 'unavailable'] as const)(
    '%s hides previous private data and editing',
    (state) => {
      render(<PayoutBeneficiaryPanel config={config()} state={state} onEdit={vi.fn()} />);
      expect(screen.queryByText(config().displayName!)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'ดู/แก้ไขบัญชีรับเงิน' }),
      ).not.toBeInTheDocument();
    },
  );
  it('stale retains only caller-authorized read facts and cannot edit', () => {
    render(<PayoutBeneficiaryPanel config={config()} state="stale" onEdit={vi.fn()} />);
    expect(screen.getByText(config().maskedAccount!)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ดู/แก้ไขบัญชีรับเงิน' })).not.toBeInTheDocument();
  });
  it('unknown offers only an explicit current read and disables it while checking', () => {
    const check = vi.fn();
    const view = render(
      <PayoutBeneficiaryPanel config={config()} state="ready" uncertain onCheckCurrent={check} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูลปัจจุบัน' }));
    expect(check).toHaveBeenCalledTimes(1);
    view.rerender(
      <PayoutBeneficiaryPanel
        config={config()}
        state="ready"
        uncertain
        checking
        onCheckCurrent={check}
      />,
    );
    expect(screen.getByRole('button', { name: 'กำลังตรวจสอบข้อมูลปัจจุบัน…' })).toBeDisabled();
  });
});
