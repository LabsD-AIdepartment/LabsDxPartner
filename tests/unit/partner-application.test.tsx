import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PartnerApplication } from '@/features/partner-application/PartnerApplication';
import { CredentialAccount } from '@/features/partner-application/CredentialAccount';
import { selectSessionPartner } from '@/server/modules/access/partner-session';
import { initialReportContext } from '@/shared/routing/report-context';
import type { SessionValue } from '@/contracts/session';
const session: SessionValue = {
  userId: 'user-one',
  displayName: 'คุณพาร์ทเนอร์',
  activePartnerId: 'partner-one',
  access: 'active',
  memberships: [
    {
      partnerId: 'partner-one',
      partnerName: 'พาร์ทเนอร์หนึ่ง',
      permissionRevision: 'p1:m1',
      capabilities: ['view_earnings', 'view_content', 'view_statements'],
    },
  ],
};
const fetcher = vi.fn();
const response = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe('authenticated partner application', () => {
  it('ignores malformed, foreign user, and nonmember selection preferences', () => {
    for (const cookie of [
      '{',
      encodeURIComponent(JSON.stringify(['other-user', 'partner-one'])),
      encodeURIComponent(JSON.stringify(['user-one', 'another-partner'])),
    ])
      expect(selectSessionPartner(session, cookie)).toEqual(session);
  });
  it('keeps the overview layout with unavailable amounts and does not show fixture earnings', async () => {
    fetcher.mockResolvedValue(response(session));
    render(
      <PartnerApplication
        initialSession={session}
        screen={{ kind: 'overview' }}
        initialContext={initialReportContext}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'คอมมิชชันของฉัน' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Small clips Real results' })).toBeVisible();
    expect(screen.getByRole('img', { name: /ภาพโปรไฟล์ พาร์ทเนอร์หนึ่ง/ })).toBeVisible();
    expect(screen.queryByText('฿37,360')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(fetcher.mock.calls.every(([url]) => url === '/api/partner/session')).toBe(true);
  });
  it('removes private content immediately on visibility change and rechecks permissions before showing it again', async () => {
    fetcher.mockResolvedValue(response(session));
    render(
      <PartnerApplication
        initialSession={session}
        screen={{ kind: 'account' }}
        initialContext={initialReportContext}
      />,
    );
    await screen.findByLabelText('รหัสผ่านปัจจุบัน');
    let finish: (value: unknown) => void = () => {};
    fetcher.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByLabelText('รหัสผ่านปัจจุบัน')).not.toBeInTheDocument();
    finish(response({}, 503));
    expect(await screen.findByRole('alert')).toHaveTextContent('ตรวจสอบการเข้าถึงไม่สำเร็จ');
    expect(screen.queryByLabelText('รหัสผ่านปัจจุบัน')).not.toBeInTheDocument();
  });
  it('does not redirect a signed-in account lacking menu permissions back to login', async () => {
    fetcher.mockResolvedValue(
      response({ ...session, memberships: [{ ...session.memberships[0], capabilities: [] }] }),
    );
    render(
      <PartnerApplication
        initialSession={session}
        screen={{ kind: 'overview' }}
        initialContext={initialReportContext}
      />,
    );
    expect(await screen.findByText(/บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลส่วนนี้/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'ออกจากระบบ' })).toBeVisible();
  });
  it('changes credentials through the guarded service with a literal password and clears the account view only after success', async () => {
    fetcher.mockResolvedValue(response({ status: 'requires-login' }));
    const changed = vi.fn();
    render(<CredentialAccount name="คุณพาร์ทเนอร์" onChanged={changed} />);
    fireEvent.change(screen.getByLabelText('รหัสผ่านปัจจุบัน'), {
      target: { value: '  old password  ' },
    });
    fireEvent.change(screen.getByLabelText('รหัสผ่านใหม่'), {
      target: { value: '  new password  ' },
    });
    fireEvent.change(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), {
      target: { value: '  new password  ' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน' }).closest('form')!);
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0][0]).toBe('/api/access/passwords/change');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      currentPassword: '  old password  ',
      password: '  new password  ',
    });
  });
});
