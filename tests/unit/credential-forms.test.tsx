import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '@/features/login/LoginPage';
import { InvitePage } from '@/features/login/InvitePage';
import { ResetPasswordPage } from '@/features/login/ResetPasswordPage';
const token = 'a'.repeat(43);
const fetcher = vi.fn();
const response = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset();
  window.history.replaceState(null, '', '/#token=' + token);
});
afterEach(() => vi.unstubAllGlobals());
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
const submit = (button: string) =>
  fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);
describe('invitation credential forms', () => {
  it('login uses password-manager fields, preserves literal password and shows generic failure', async () => {
    fetcher.mockResolvedValue(
      response({ code: 'INVALID_USERNAME_OR_PASSWORD', message: 'internal-secret' }, 401),
    );
    render(<LoginPage next="//foreign.test" />);
    fill('ชื่อผู้ใช้', ' Partner_Name ');
    fill('รหัสผ่าน', '  literal password  ');
    fireEvent.click(screen.getByRole('button', { name: 'แสดงรหัสผ่าน' }));
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveAttribute('type', 'text');
    submit('เข้าสู่ระบบ');
    expect(await screen.findByRole('alert')).not.toHaveTextContent('internal-secret');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      username: 'partner_name',
      password: '  literal password  ',
      callbackURL: '/overview',
    });
    fireEvent.click(screen.getByRole('button', { name: 'ลืมรหัสผ่าน' }));
    expect(screen.getByText(/ยืนยันเจ้าของบัญชี/)).toBeVisible();
  });
  it('inspects by POST without a bearer in the URL and leaves rejected validation unsubmitted', async () => {
    fetcher.mockResolvedValue(
      response({
        partnerName: 'LabsD',
        recipientName: 'คุณดารา',
        expiresAt: '2026-09-10T00:00:00.000Z',
      }),
    );
    render(<InvitePage />);
    await screen.findByText(/คำเชิญสำหรับ คุณดารา/);
    expect(fetcher.mock.calls.every(([path]) => !path.includes(token))).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ token });
    fill('ชื่อผู้ใช้', 'star');
    fill('รหัสผ่าน', 'test-password-12');
    fill('ยืนยันรหัสผ่าน', 'different-password');
    submit('สร้างบัญชีและเข้าสู่ระบบ');
    expect(screen.getByRole('alert')).toHaveTextContent('ยืนยันรหัสผ่าน');
    expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/register'))).toHaveLength(0);
  });
  it('never resubmits registration after committed creation followed by failed login', async () => {
    fetcher.mockImplementation(async (path) =>
      path.endsWith('/inspect')
        ? response({
            partnerName: 'LabsD',
            recipientName: 'คุณดารา',
            expiresAt: '2026-09-10T00:00:00.000Z',
          })
        : path.endsWith('/register')
          ? response({
              userId: 'user-1',
              partnerId: 'partner-1',
              membershipId: 'member-1',
              status: 'active',
            })
          : response({ code: 'IDENTITY_UNAVAILABLE' }, 503),
    );
    render(<InvitePage />);
    await screen.findByText(/คำเชิญสำหรับ/);
    fill('ชื่อผู้ใช้', 'star');
    fill('รหัสผ่าน', 'test-password-12');
    fill('ยืนยันรหัสผ่าน', 'test-password-12');
    submit('สร้างบัญชีและเข้าสู่ระบบ');
    await screen.findByRole('heading', { name: 'บัญชีของคุณพร้อมแล้ว' });
    await screen.findByRole('alert');
    expect(window.location.hash).toBe('');
    expect(
      screen.queryByRole('button', { name: 'สร้างบัญชีและเข้าสู่ระบบ' }),
    ).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/register'))).toHaveLength(1);
  });
  it('invalid fragment never requests the API', async () => {
    window.history.replaceState(null, '', '/');
    render(<InvitePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('เปิดลิงก์');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reset success removes the fragment and requires new login', async () => {
    fetcher.mockImplementation(async (path) =>
      path.endsWith('/inspect')
        ? response({ username: 'star', expiresAt: '2026-09-10T00:00:00.000Z' })
        : response({ status: 'requires-login' }),
    );
    render(<ResetPasswordPage />);
    await screen.findByText('บัญชี star');
    fill('รหัสผ่านใหม่', 'new-password-123');
    fill('ยืนยันรหัสผ่าน', 'new-password-123');
    submit('บันทึกรหัสผ่านใหม่');
    await screen.findByRole('heading', { name: 'ตั้งรหัสผ่านใหม่แล้ว' });
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('link', { name: 'เข้าสู่ระบบ' })).toHaveAttribute('href', '/login');
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/reset'))).toHaveLength(1),
    );
  });
});
