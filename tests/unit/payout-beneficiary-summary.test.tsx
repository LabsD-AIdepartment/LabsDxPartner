import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PayoutBeneficiaryValue } from '@/contracts/withdrawal-journey';
import {
  BeneficiaryAccountRevealProvider,
  type BeneficiaryAccountRevealEntry,
} from '@/features/withdrawals/BeneficiaryAccountRevealContext';
import { PayoutBeneficiarySummary } from '@/features/withdrawals/PayoutBeneficiarySummary';

const beneficiary: Extract<PayoutBeneficiaryValue, { state: 'known' }> = {
  state: 'known',
  version: 'test-beneficiary-1',
  displayName: 'ผู้รับตัวอย่าง',
  bankName: 'ธนาคารกสิกรไทย',
  maskedAccount: 'XXX-X-X1234-5',
};

const full = '1234512345';
const formattedFull = '123-4-51234-5';
const entry: BeneficiaryAccountRevealEntry = { ...beneficiary, fullAccount: full };
function summary({
  value = beneficiary as PayoutBeneficiaryValue,
  entries = [entry],
  identityKey = 'demo-a:g4',
} = {}) {
  return (
    <BeneficiaryAccountRevealProvider identityKey={identityKey} entries={entries}>
      <PayoutBeneficiarySummary beneficiary={value} />
    </BeneficiaryAccountRevealProvider>
  );
}

describe('beneficiary account presentation', () => {
  it.each([
    ['XXX-X-X1234-5', '1234512345', '123-4-51234-5'],
    ['•••• •••• 2345', '001122332345', '0011 2233 2345'],
    ['***-**-1234', '001231234', '001-23-1234'],
    ['••••1234', '1234512345', '1234512345'],
    ['SCB ••••1234', '1234512345', '1234512345'],
    ['XXX/X/12345', '1234512345', '1234512345'],
    ['XXX-X-X1234-5', '123-4-51234-5', '123-4-51234-5'],
  ])('uses only a complete recognized mask template %s', (mask, number, expected) => {
    const value = { ...beneficiary, maskedAccount: mask };
    const view = render(summary({ value, entries: [{ ...value, fullAccount: number }] }));
    expect(view.container.innerHTML).not.toContain(number);
    fireEvent.click(screen.getByRole('button', { name: 'แสดงเลขบัญชี' }));
    expect(screen.getByText(expected)).toBeVisible();
    expect(screen.getByText(expected).textContent?.replace(/[^0-9]/g, '')).toBe(
      number.replace(/[^0-9]/g, ''),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนเลขบัญชี' }));
    expect(screen.getByText(mask)).toBeVisible();
    expect(view.container.innerHTML).not.toContain(number);
  });

  it('reveals only after an explicit toggle and removes the full number on hide', () => {
    const view = render(summary());
    expect(view.container.textContent).not.toContain(full);
    expect(view.container.innerHTML).not.toContain(full);
    expect(view.container.innerHTML).not.toContain(formattedFull);
    const show = screen.getByRole('button', { name: 'แสดงเลขบัญชี' });
    expect(show).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(show);
    expect(screen.getByText(formattedFull)).toBeVisible();
    expect(screen.queryByText(beneficiary.maskedAccount)).toBeNull();
    const hide = screen.getByRole('button', { name: 'ซ่อนเลขบัญชี' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hide);
    expect(view.container.innerHTML).not.toContain(full);
    expect(view.container.innerHTML).not.toContain(formattedFull);
    expect(screen.getByText(beneficiary.maskedAccount)).toBeVisible();
  });

  it('keeps a reveal through unrelated rerenders but remasks on provider identity changes', () => {
    const view = render(summary());
    fireEvent.click(screen.getByRole('button', { name: 'แสดงเลขบัญชี' }));
    view.rerender(summary({ entries: [{ ...entry }] }));
    expect(screen.getByText(formattedFull)).toBeVisible();
    view.rerender(summary({ identityKey: 'demo-b:g4' }));
    expect(view.container.innerHTML).not.toContain(full);
    expect(view.container.innerHTML).not.toContain(formattedFull);
    expect(screen.getByRole('button', { name: 'แสดงเลขบัญชี' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it.each(['version', 'displayName', 'bankName', 'maskedAccount'] as const)(
    'remasks a changed %s even when its replacement can reveal the same number',
    (field) => {
      const view = render(summary());
      fireEvent.click(screen.getByRole('button', { name: 'แสดงเลขบัญชี' }));
      const next = { ...beneficiary, [field]: beneficiary[field] + '-new' };
      view.rerender(summary({ value: next, entries: [{ ...next, fullAccount: full }] }));
      expect(view.container.innerHTML).not.toContain(full);
      expect(view.container.innerHTML).not.toContain(formattedFull);
      expect(screen.getByText(next.maskedAccount)).toBeVisible();
      expect(screen.getByRole('button', { name: 'แสดงเลขบัญชี' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    },
  );

  it('remasks when a number changes and removes the control when capability is revoked', () => {
    const view = render(summary());
    fireEvent.click(screen.getByRole('button', { name: 'แสดงเลขบัญชี' }));
    const replacement = '5432112345';
    view.rerender(summary({ entries: [{ ...entry, fullAccount: replacement }] }));
    expect(view.container.innerHTML).not.toContain(full);
    expect(view.container.innerHTML).not.toContain(formattedFull);
    expect(view.container.innerHTML).not.toContain(replacement);
    expect(view.container.innerHTML).not.toContain('543-2-11234-5');
    fireEvent.click(screen.getByRole('button', { name: 'แสดงเลขบัญชี' }));
    expect(screen.getByText('543-2-11234-5')).toBeVisible();
    view.rerender(summary({ entries: [] }));
    expect(screen.queryByRole('button', { name: /เลขบัญชี/ })).toBeNull();
    expect(view.container.innerHTML).not.toContain(replacement);
    expect(view.container.innerHTML).not.toContain('543-2-11234-5');
    expect(screen.getByText(beneficiary.maskedAccount)).toBeVisible();
  });

  it.each(['missing', 'pending'] as const)(
    'removes account data when beneficiary becomes %s',
    (state) => {
      const view = render(summary());
      fireEvent.click(screen.getByRole('button', { name: 'แสดงเลขบัญชี' }));
      const value: PayoutBeneficiaryValue =
        state === 'missing'
          ? { state, reasons: ['ไม่มีบัญชี'] }
          : { state, version: 'pending-2', reasons: ['กำลังตรวจสอบ'] };
      view.rerender(summary({ value }));
      expect(view.container.innerHTML).not.toContain(full);
      expect(view.container.innerHTML).not.toContain(formattedFull);
      expect(screen.queryByRole('button', { name: /เลขบัญชี/ })).toBeNull();
      expect(screen.queryByText(beneficiary.maskedAccount)).toBeNull();
    },
  );

  it('keeps the native destination masked without a reveal capability', () => {
    render(<PayoutBeneficiarySummary beneficiary={beneficiary} />);
    expect(screen.getByText('เลขบัญชี')).toBeVisible();
    expect(screen.getByText(beneficiary.maskedAccount)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'แสดงเลขบัญชี' })).toBeNull();
  });
});
