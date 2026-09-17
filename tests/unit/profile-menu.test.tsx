import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileMenu } from '@/features/shell/ProfileMenu';

describe('shared profile actions', () => {
  it('keeps account and logout inside the profile disclosure and forwards logout once', () => {
    const logout = vi.fn();
    render(<ProfileMenu accountHref="/account" onLogout={logout} />);
    expect(screen.queryByRole('link', { name: 'จัดการบัญชี' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'เมนูโปรไฟล์' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'จัดการบัญชี' })).toHaveAttribute('href', '/account');
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
  it('dismisses on Escape and outside pointer, returning keyboard focus to the avatar', () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole('button', { name: 'เมนูโปรไฟล์' });
    fireEvent.click(trigger);
    screen.getByRole('link', { name: 'จัดการบัญชี' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'โปรไฟล์' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
  it('preserves partner selection inside the disclosure and disables a pending logout', () => {
    render(
      <ProfileMenu onLogout={vi.fn()} busy>
        <select aria-label="เลือกพาร์ทเนอร์">
          <option>Partner</option>
        </select>
      </ProfileMenu>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'เมนูโปรไฟล์' }));
    expect(screen.getByRole('combobox', { name: 'เลือกพาร์ทเนอร์' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'กำลังออกจากระบบ…' })).toBeDisabled();
  });
});
