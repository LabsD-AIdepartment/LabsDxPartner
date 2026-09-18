import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountIdentityCard } from '@/features/account/AccountIdentityCard';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { CredentialEnvironmentProvider } from '@/features/login/CredentialEnvironment';
import { CredentialError } from '@/features/login/credential-client';
const scope = {
  userId: 'identity-user',
  partnerId: 'identity-partner',
  permissionRevision: 'p1:m1',
};
const envelope = {
  dataState: 'ready',
  generatedAt: '2026-09-18T00:00:00Z',
  dataThrough: null,
  reasons: [],
  requestId: 'identity-test',
  revision: '1',
  partnerId: scope.partnerId,
  permissionRevision: scope.permissionRevision,
  data: {
    userId: scope.userId,
    displayName: 'Partner',
    username: 'partner',
    agreement: null,
    termsSummary: null,
    supportUrl: null,
  },
};
const request = vi.fn();
const done = vi.fn();
const transport = { read: async () => envelope, act: vi.fn() };
function page(currentScope = scope) {
  return (
    <CredentialEnvironmentProvider
      value={{ request, signIn: vi.fn(), navigate: vi.fn(), clearLink: vi.fn() }}
    >
      <ScopedQueryProvider scope={currentScope}>
        <AccountIdentityCard scope={currentScope} transport={transport} onChanged={done} />
      </ScopedQueryProvider>
    </CredentialEnvironmentProvider>
  );
}
beforeEach(() => {
  request.mockReset();
  done.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
});
afterEach(() => vi.restoreAllMocks());
async function edit() {
  fireEvent.click(await screen.findByRole('button', { name: 'แก้ไขบัญชีของคุณ' }));
  await screen.findByRole('dialog');
}
function fill() {
  fireEvent.change(screen.getByLabelText('ชื่อที่แสดง'), { target: { value: 'ชื่อใหม่' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^ชื่อผู้ใช้/ }), {
    target: { value: 'NEW_USER' },
  });
  fireEvent.change(screen.getByLabelText('รหัสผ่านปัจจุบันเพื่อยืนยัน'), {
    target: { value: ' Test password! ' },
  });
}
describe('account identity card', () => {
  it('keeps name/username/password in one card and opens the editor in place', async () => {
    render(page());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'แก้ไขบัญชีของคุณ' })).toBeEnabled(),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    await edit();
    expect(screen.getByRole('textbox', { name: /^ชื่อผู้ใช้/ })).toHaveValue('partner');
    fireEvent.click(screen.getByText('เปลี่ยนรหัสผ่าน', { selector: 'summary' }));
    expect(screen.getByLabelText('รหัสผ่านใหม่')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('sends the expected identity/scope with normalized username and unmodified password', async () => {
    request.mockResolvedValue({ status: 'requires-login' });
    render(page());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'แก้ไขบัญชีของคุณ' })).toBeEnabled(),
    );
    await edit();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกชื่อและชื่อผู้ใช้' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][0]).toBe('/api/access/account/identity');
    expect(request.mock.calls[0][1]).toMatchObject({
      expectedUserId: scope.userId,
      partnerId: scope.partnerId,
      permissionRevision: scope.permissionRevision,
      expectedName: 'Partner',
      expectedUsername: 'partner',
      name: 'ชื่อใหม่',
      username: 'new_user',
      currentPassword: ' Test password! ',
    });
  });
  it('shows collisions without losing the draft or claiming success', async () => {
    request.mockRejectedValue(new CredentialError('USERNAME_UNAVAILABLE'));
    render(page());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'แก้ไขบัญชีของคุณ' })).toBeEnabled(),
    );
    await edit();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกชื่อและชื่อผู้ใช้' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
    expect(screen.getByLabelText('ชื่อที่แสดง')).toHaveValue('ชื่อใหม่');
    expect(done).not.toHaveBeenCalled();
  });
  it('blocks duplicate submissions and close while saving, fences a late completion after unmount', async () => {
    let resolve!: (value: unknown) => void;
    request.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const view = render(page());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'แก้ไขบัญชีของคุณ' })).toBeEnabled(),
    );
    await edit();
    fill();
    const save = screen.getByRole('button', { name: 'บันทึกชื่อและชื่อผู้ใช้' });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(request).toHaveBeenCalledOnce();
    view.unmount();
    resolve({ status: 'requires-login' });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
  });
});
