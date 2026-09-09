import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { createCelebrityJourney } from '../../dev/celebrity-journey';
import { AccessPreview } from '../../dev/AccessPreview';
import {
  ActivatedAccount,
  InvitationContext,
  PasswordChanged,
  PasswordResetContext,
} from '@/contracts/credential-responses';
vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const password = 'celebrity-demo-2026';
async function activate(journey: ReturnType<typeof createCelebrityJourney>) {
  return journey.request(
    '/api/access/invitations/register',
    {
      token: journey.invitationToken,
      username: 'owner.celeb',
      password,
      passwordConfirmation: password,
    },
    ActivatedAccount,
  );
}
describe('isolated celebrity mock journey', () => {
  it('consumes the invitation, checks credentials, resets once and drops session without network or persistence', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network forbidden in mock'));
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const journey = createCelebrityJourney();
    await expect(
      journey.request(
        '/api/access/invitations/inspect',
        { token: journey.invitationToken },
        InvitationContext,
      ),
    ).resolves.toMatchObject({ recipientName: 'คุณ (ดาราพาร์ทเนอร์ตัวอย่าง)' });
    await activate(journey);
    await expect(activate(journey)).rejects.toMatchObject({ code: 'INVALID_INVITE' });
    await expect(journey.signIn('owner.celeb', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_USERNAME_OR_PASSWORD',
    });
    await journey.signIn('owner.celeb', password);
    expect(journey.authenticated).toBe(true);
    const first = journey.issueReset(),
      second = journey.issueReset();
    await expect(
      journey.request('/api/access/passwords/inspect', { token: first }, PasswordResetContext),
    ).rejects.toMatchObject({ code: 'INVALID_RESET' });
    await journey.request(
      '/api/access/passwords/reset',
      { token: second, password: 'new-celebrity-demo', passwordConfirmation: 'new-celebrity-demo' },
      PasswordChanged,
    );
    expect(journey.authenticated).toBe(false);
    await expect(journey.signIn('owner.celeb', password)).rejects.toMatchObject({
      code: 'INVALID_USERNAME_OR_PASSWORD',
    });
    await journey.signIn('owner.celeb', 'new-celebrity-demo');
    await expect(
      journey.request('/api/access/passwords/inspect', { token: second }, PasswordResetContext),
    ).rejects.toMatchObject({ code: 'INVALID_RESET' });
    journey.logout();
    expect(journey.authenticated).toBe(false);
    expect(createCelebrityJourney().username).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it('requires the current password to change it, revokes session and outstanding reset links', async () => {
    const j = createCelebrityJourney();
    await activate(j);
    const input = {
      currentPassword: password,
      password: 'changed-celebrity-demo',
      passwordConfirmation: 'changed-celebrity-demo',
      idempotencyKey: 'change-one',
    };
    await expect(
      j.request('/api/access/passwords/change', input, PasswordChanged),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await j.signIn('owner.celeb', password);
    const token = j.issueReset();
    await expect(
      j.request(
        '/api/access/passwords/change',
        { ...input, currentPassword: 'wrong' },
        PasswordChanged,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    expect(j.authenticated).toBe(true);
    await j.request('/api/access/passwords/change', input, PasswordChanged);
    expect(j.authenticated).toBe(false);
    await expect(
      j.request('/api/access/passwords/inspect', { token }, PasswordResetContext),
    ).rejects.toMatchObject({ code: 'INVALID_RESET' });
    await expect(j.signIn('owner.celeb', password)).rejects.toMatchObject({
      code: 'INVALID_USERNAME_OR_PASSWORD',
    });
    await expect(j.signIn('owner.celeb', input.password)).resolves.toMatchObject({
      user: { id: 'preview-user' },
    });
  });
  it('expires invitations and reset links against the mock clock', async () => {
    let now = Date.now();
    const journey = createCelebrityJourney(() => now);
    await activate(journey);
    const token = journey.issueReset();
    now += 1800000;
    await expect(
      journey.request('/api/access/passwords/inspect', { token }, PasswordResetContext),
    ).rejects.toMatchObject({ code: 'INVALID_RESET' });
    const expired = createCelebrityJourney(() => now);
    now += 7 * 86400000;
    await expect(activate(expired)).rejects.toMatchObject({ code: 'INVALID_INVITE' });
  });
  it('uses shared forms then shows the existing overview, all covers, details and statement totals', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real API'));
    render(<AccessPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'เปิดคำเชิญและตั้งบัญชีของฉัน' }));
    await screen.findByText(/คำเชิญสำหรับ/);
    fireEvent.change(screen.getByLabelText(/^ชื่อผู้ใช้/), { target: { value: 'owner.celeb' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน', { exact: true }), {
      target: { value: password },
    });
    fireEvent.change(screen.getByLabelText('ยืนยันรหัสผ่าน'), { target: { value: password } });
    fireEvent.submit(
      screen.getByRole('button', { name: 'สร้างบัญชีและเข้าสู่ระบบ' }).closest('form')!,
    );
    await screen.findByText('Your content');
    await screen.findByText('คอมมิชชันของฉัน');
    expect(screen.getAllByText('฿37,360').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('link', { name: 'บัญชีของคุณ' }));
    await screen.findByText('ข้อตกลงของคุณ');
    expect(screen.queryByText(/Google|Apple|เชื่อมบัญชี/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('รหัสผ่านปัจจุบัน'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('รหัสผ่านใหม่', { exact: true }), {
      target: { value: 'changed-celebrity-demo' },
    });
    fireEvent.change(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), {
      target: { value: 'changed-celebrity-demo' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน' }).closest('form')!);
    await screen.findByRole('button', { name: 'เข้าสู่ระบบ' });
    fireEvent.change(screen.getByLabelText('ชื่อผู้ใช้', { exact: true }), {
      target: { value: 'owner.celeb' },
    });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน', { exact: true }), {
      target: { value: 'changed-celebrity-demo' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }).closest('form')!);
    await screen.findByText('คอมมิชชันของฉัน');
    fireEvent.click(screen.getAllByRole('link', { name: 'My content' })[0]);
    await screen.findByText('Your content library');
    await waitFor(() =>
      expect(document.querySelectorAll('img[src^="/media/clip-cover-"]')).toHaveLength(6),
    );
    const clip = document.querySelector<HTMLAnchorElement>(
      'a[href^="/access-preview/content/clip-3?"]',
    )!;
    fireEvent.click(clip);
    await screen.findByText('รายได้และวิธีคำนวณ');
    fireEvent.click(screen.getAllByRole('link', { name: 'Transactions' })[0]);
    await screen.findByText('รอบจ่ายของคุณ');
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากระบบตัวอย่าง' }));
    await screen.findByRole('button', { name: 'เข้าสู่ระบบ' });
    fireEvent.click(screen.getByRole('button', { name: 'จำลองได้รับลิงก์ตั้งรหัสใหม่จากผู้ดูแล' }));
    await screen.findByText('บัญชี owner.celeb');
    fireEvent.change(screen.getByLabelText(/^รหัสผ่านใหม่/), {
      target: { value: 'new-celebrity-demo' },
    });
    fireEvent.change(screen.getByLabelText('ยืนยันรหัสผ่าน'), {
      target: { value: 'new-celebrity-demo' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่' }).closest('form')!);
    await screen.findByText('ตั้งรหัสผ่านใหม่แล้ว');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
