import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe('authenticated partner application', () => {
  it('loads native scoped account metadata while preserving the shared password form', async () => {
    fetcher.mockImplementation(async (url: string) => {
      if (url === '/api/partner/session') return response(session);
      if (url.startsWith('/api/v1/partner/account?'))
        return response({
          dataState: 'ready',
          generatedAt: '2026-09-11T00:00:00Z',
          dataThrough: null,
          reasons: [],
          requestId: 'account-native',
          revision: '1',
          partnerId: 'partner-one',
          permissionRevision: 'p1:m1',
          data: {
            userId: 'user-one',
            displayName: 'คุณพาร์ทเนอร์',
            username: 'celeb_native',
            agreement: null,
            termsSummary: null,
            supportUrl: null,
          },
        });
      return response({}, 503);
    });
    render(
      <PartnerApplication
        initialSession={session}
        screen={{ kind: 'account' }}
        initialContext={initialReportContext}
      />,
    );
    expect(await screen.findByText('ชื่อผู้ใช้: celeb_native')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'ข้อตกลงของคุณ' })).toBeVisible();
    expect(screen.getAllByLabelText('รหัสผ่านปัจจุบัน')).toHaveLength(1);
    expect(
      fetcher.mock.calls.some(([url]) =>
        url.includes('partnerId=partner-one&permissionRevision=p1%3Am1'),
      ),
    ).toBe(true);
  });
  it('uses changed overview dates in the native request, top navigation and reload URL', async () => {
    window.history.replaceState(null, '', '/overview');
    fetcher.mockImplementation(async (url: string) =>
      url === '/api/partner/session' ? response(session) : response({}, 503),
    );
    const view = render(
      <PartnerApplication
        initialSession={session}
        screen={{ kind: 'overview' }}
        initialContext={initialReportContext}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'เดือน 1' }), {
      target: { value: '08' },
    });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' })).getByRole('button', {
        name: '2026-08-01',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) =>
            url.startsWith('/api/v1/partner/overview?') &&
            new URLSearchParams(url.split('?')[1]).get('from') === '2026-08-01',
        ),
      ).toBe(true),
    );
    for (const link of screen.getAllByRole('link', { name: 'My content' })) {
      const next = new URL(link.getAttribute('href')!, 'https://example.test');
      expect(next.searchParams.get('from')).toBe('2026-08-01');
      expect(next.searchParams.get('toExclusive')).toBe('2026-09-01');
      expect(next.searchParams.has('generation')).toBe(false);
    }
    expect(new URLSearchParams(window.location.search).get('from')).toBe('2026-08-01');
    view.unmount();
    window.history.replaceState(null, '', '/');
  });
  it('ignores malformed, foreign user, and nonmember selection preferences', () => {
    for (const cookie of [
      '{',
      encodeURIComponent(JSON.stringify(['other-user', 'partner-one'])),
      encodeURIComponent(JSON.stringify(['user-one', 'another-partner'])),
    ])
      expect(selectSessionPartner(session, cookie)).toEqual(session);
  });
  it('keeps the overview layout with unavailable amounts and does not show fixture earnings', async () => {
    fetcher.mockImplementation(async (url: string) => {
      if (
        url.startsWith('/api/v1/partner/overview?') ||
        url.startsWith('/api/v1/partner/notifications?')
      )
        return response({}, 503);
      return response(
        url.startsWith('/api/v1/partner/changes?')
          ? {
              partnerId: 'partner-one',
              permissionRevision: 'p1:m1',
              earningsRevision: '0',
              settlementsRevision: '0',
              metricsRevision: '0',
              noticesRevision: '0',
              publishedAt: '1970-01-01T00:00:00.000Z',
              sources: [],
            }
          : session,
      );
    });
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
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) =>
            url ===
            '/api/v1/partner/changes?partnerId=partner-one&permissionRevision=p1%3Am1&capability=view_earnings',
        ),
      ).toBe(true),
    );
    expect(
      fetcher.mock.calls.every(
        ([url]) =>
          url === '/api/partner/session' ||
          url.startsWith('/api/v1/partner/changes?') ||
          url.startsWith('/api/v1/partner/overview?') ||
          url.startsWith('/api/v1/partner/notifications?'),
      ),
    ).toBe(true);
  });
  it('rechecks the session and removes the private view when metadata denies membership', async () => {
    let sessionReads = 0;
    fetcher.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/partner/changes?')) return response({}, 403);
      if (url.startsWith('/api/v1/partner/overview?')) return response({}, 403);
      sessionReads++;
      return response(
        sessionReads === 1 ? session : { ...session, access: 'suspended', memberships: [] },
      );
    });
    render(
      <PartnerApplication
        initialSession={session}
        screen={{ kind: 'overview' }}
        initialContext={initialReportContext}
      />,
    );
    expect(
      await screen.findByText('สิทธิ์เข้าถึงถูกระงับ กรุณาติดต่อผู้ดูแล Labs D'),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'คอมมิชชันของฉัน' })).not.toBeInTheDocument();
    expect(sessionReads).toBe(2);
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
    fireEvent.click(screen.getByRole('button', { name: 'เมนูโปรไฟล์' }));
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
