import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  accessReasons,
  accessCopy,
  parseAccessReason,
  safeReturnTo,
  loginHref,
} from '@/features/login/access';
import { LoginPage } from '@/features/login/LoginPage';
import { AccessPage } from '@/features/login/AccessPage';
import { Navigation } from '@/features/shell/Navigation';

describe('untrusted access URL inputs', () => {
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/content/%2f%2fevil',
    '/content/../login',
    '/overview?next=//evil',
    '/overview#x',
    '/overview\n',
    ['content'],
    null,
    '/api/auth',
    '/access?reason=active',
    '/content/%252e%252e',
  ])('rejects unsafe or ambiguous destination %j', (value) => {
    expect(safeReturnTo(value)).toBe('/overview');
    expect(loginHref(value)).toBe('/login?next=%2Foverview');
  });
  it.each([
    '/overview',
    '/content/clip-1',
    '/content/clip-1/ads/ad-2',
    '/transactions/stmt_1',
    '/account',
  ])('retains known relative destination %s', (value) => {
    expect(safeReturnTo(value)).toBe(value);
    expect(decodeURIComponent(loginHref(value).split('next=')[1])).toBe(value);
  });
  it('unknown, inherited and repeated reasons cannot become access', () => {
    for (const value of ['active', '__proto__', 'constructor', ['pending'], undefined])
      expect(parseAccessReason(value)).toBe('invite-required');
  });
});

describe('public access presentation', () => {
  it('uses invited username/password accounts and explains setup without public signup', () => {
    render(<LoginPage next="/content/clip-1" />);
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveAttribute('autocomplete', 'current-password');
    expect(
      screen.queryByText(/เข้าสู่ระบบด้วย Google|เข้าสู่ระบบด้วย LINE|เข้าสู่ระบบด้วย Apple/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ได้รับคำเชิญแล้ว' }));
    expect(screen.getByRole('button', { name: 'ได้รับคำเชิญแล้ว' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(/เปิดลิงก์คำเชิญที่ทีม Labs D ส่งให้/)).toBeVisible();
  });
  it('all access variants explain a recovery path without financial content', () => {
    for (const reason of accessReasons) {
      render(<AccessPage reason={reason} next="/transactions/stmt-1" />);
      expect(screen.getByRole('heading', { name: accessCopy[reason].title })).toBeVisible();
      expect(screen.getByRole('link', { name: accessCopy[reason].action })).toHaveAttribute(
        'href',
        '/login?next=%2Ftransactions%2Fstmt-1',
      );
      expect(screen.queryByText(/฿/)).not.toBeInTheDocument();
      cleanup();
    }
  });
  it('preview transitions are explicitly injected and separate from public behavior', () => {
    const transition = vi.fn();
    render(<LoginPage next="/overview" onPreview={transition} />);
    fireEvent.change(screen.getByLabelText('ชื่อผู้ใช้'), { target: { value: 'partner_test' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'test-password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }).closest('form')!);
    expect(transition).toHaveBeenCalledWith();
    expect(screen.getByText(/ไม่เชื่อมบัญชีจริง/)).toBeVisible();
  });
  it('link mode has real destinations and preserves legacy gallery callbacks', () => {
    render(
      <Navigation
        active="content"
        hrefs={{ overview: '/overview', content: '/content', transactions: '/transactions' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'My content' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
      'href',
      '/transactions',
    );
    cleanup();
    const navigate = vi.fn();
    render(<Navigation active="overview" onNavigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'My content' }));
    expect(navigate).toHaveBeenCalledWith('content');
  });
});
