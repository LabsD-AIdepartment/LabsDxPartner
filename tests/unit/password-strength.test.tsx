import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PasswordField } from '@/shared/ui/PasswordField';
import { estimatePasswordStrength } from '@/shared/ui/password-strength';
import { NewPassword } from '@/contracts/credentials';

describe('advisory password strength', () => {
  it('does not reject valid passwords merely because they score low', () => {
    expect(estimatePasswordStrength('admin1234').label).toBe('เดาง่าย');
    expect(NewPassword.safeParse('admin1234').success).toBe(true);
    expect(estimatePasswordStrength('abcd'.repeat(8)).level).toBe(1);
    expect(estimatePasswordStrength('many memorable words together').level).toBe(3);
  });
  it('updates the shared meter on typing and clearing, without intercepting the value', () => {
    const change = vi.fn();
    render(<PasswordField label="รหัสใหม่" showStrength onChange={change} />);
    const input = screen.getByLabelText('รหัสใหม่');
    fireEvent.change(input, { target: { value: 'abcdefgh' } });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', 'พอใช้');
    expect(change).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: 'many memorable words together' } });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '3');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', 'ยังไม่ได้กรอก');
    expect(input).not.toHaveAttribute('pattern');
  });
  it('does not show a meter on ordinary login/current-password inputs', () => {
    render(<PasswordField label="รหัสผ่าน" />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});
