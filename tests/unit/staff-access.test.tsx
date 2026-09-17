import { beforeEach, afterEach, beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { StaffAccessConsole } from '@/features/staff-access/StaffAccessConsole';
import { InvitationForm, ResetForm } from '@/features/staff-access/AccessForms';
import { safeReturnTo } from '@/shared/routing/partner-paths';
const session = { userId: 'staff-one', displayName: 'ทีม LabsD', revision: '1' };
const partner = { id: 'partner-one', name: 'คุณพาร์ทเนอร์', status: 'active' };
const page = (items: unknown[]) => ({ items, nextCursor: null, totalCount: null });
const snapshot = {
  session,
  partners: page([partner]),
  selected: { partner, members: page([]), invitations: page([]) },
};
const member = {
  id: 'member-one',
  userId: 'user-one',
  displayName: 'คุณผู้รับ',
  username: 'recipient',
  status: 'active' as const,
  revision: '2',
  verifiedContactRef: 'contact-verified',
  capabilities: ['view_earnings' as const],
  resetAllowed: true,
};
const fetcher = vi.fn();
const response = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
const token = 'a'.repeat(43);
const originals = Object.fromEntries(
  ['showModal', 'close'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key),
  ]),
);
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterAll(() => {
  for (const key of ['showModal', 'close']) {
    const original = originals[key];
    if (original) Object.defineProperty(HTMLDialogElement.prototype, key, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe('staff access UI', () => {
  it('searches as typing, hides old choices immediately and resets selection and paging', async () => {
    const found = { ...partner, id: 'found', name: 'คุณมดดำ' };
    fetcher.mockImplementation(async (_url, options) => {
      const input = JSON.parse(options.body);
      const items = input.partnerSearch ? [found] : [partner];
      return response({
        ...snapshot,
        partners: page(items),
        selected: input.partnerId ? snapshot.selected : null,
      });
    });
    render(<StaffAccessConsole session={session} />);
    fireEvent.click(await screen.findByRole('button', { name: partner.name }));
    await screen.findByText('สร้างคำเชิญใหม่');
    const before = fetcher.mock.calls.length;
    fireEvent.change(screen.getByLabelText('ค้นหาพาร์ทเนอร์'), { target: { value: ' มด ' } });
    expect(screen.queryByRole('button', { name: partner.name })).toBeNull();
    expect(screen.queryByText('สร้างคำเชิญใหม่')).toBeNull();
    expect(fetcher.mock.calls.length).toBe(before);
    await screen.findByRole('button', { name: found.name });
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toEqual({
      expectedRevision: '1',
      partnerSearch: 'มด',
      partnerCursor: null,
      memberCursor: null,
      inviteCursor: null,
    });
    fireEvent.change(screen.getByLabelText('ค้นหาพาร์ทเนอร์'), { target: { value: '' } });
    await screen.findByRole('button', { name: partner.name });
  });
  it('keeps a late prior search response out of the current results and shows empty feedback', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    fetcher.mockImplementation(async (_url, options) => {
      const input = JSON.parse(options.body);
      if (input.partnerSearch === 'old')
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return response({
        ...snapshot,
        partners: page(input.partnerSearch ? [] : [partner]),
        selected: null,
      });
    });
    render(<StaffAccessConsole session={session} />);
    await screen.findByRole('button', { name: partner.name });
    fireEvent.change(screen.getByLabelText('ค้นหาพาร์ทเนอร์'), { target: { value: 'old' } });
    await waitFor(() => expect(resolveOld).toBeDefined());
    fireEvent.change(screen.getByLabelText('ค้นหาพาร์ทเนอร์'), { target: { value: 'new' } });
    await screen.findByText('ไม่พบพาร์ทเนอร์ที่ตรงกับคำค้น');
    resolveOld!(response({ ...snapshot, selected: null }));
    await waitFor(() => expect(screen.getByText('ไม่พบพาร์ทเนอร์ที่ตรงกับคำค้น')).toBeVisible());
    expect(screen.queryByRole('button', { name: partner.name })).toBeNull();
  });
  it('uses staff navigation with the real routes and hides disabled marketing entry', async () => {
    fetcher.mockImplementation(async () => response({ ...snapshot, selected: null }));
    const view = render(<StaffAccessConsole session={session} marketingEnabled />);
    const nav = within(screen.getByRole('navigation', { name: 'เมนูเจ้าหน้าที่' }));
    expect(nav.getByRole('link', { name: /^พาร์ทเนอร์$/ })).toHaveAttribute('href', '/ops/access');
    expect(nav.getByRole('link', { name: /^พาร์ทเนอร์$/ })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'แอดและการเชื่อมต่อ' })).toHaveAttribute(
      'href',
      '/ops/ads',
    );
    expect(nav.getByRole('link', { name: 'งวดและการชำระ' })).toHaveAttribute(
      'href',
      '/ops/periods',
    );
    expect(screen.queryByRole('complementary', { name: 'ทางลัด' })).toBeNull();
    await screen.findByRole('button', { name: partner.name });
    view.rerender(<StaffAccessConsole session={session} marketingEnabled={false} />);
    expect(nav.queryByRole('link', { name: 'แอดและการเชื่อมต่อ' })).toBeNull();
    expect(nav.queryByRole('link', { name: 'ข้อมูลนำเข้า' })).toBeNull();
  });
  it('allows only the concrete staff return path and leaves role authorization to the server', () => {
    expect(safeReturnTo('/ops/access')).toBe('/ops/access');
    for (const value of ['/ops/arbitrary', '//foreign.test/ops/access', '/ops/access?bypass=true'])
      expect(safeReturnTo(value)).toBe('/overview');
  });
  it('requires deal/contact confirmation and reviews selected recipient/capabilities without issuing anything', () => {
    const review = vi.fn();
    render(<InvitationForm partnerId={partner.id} onReview={review} />);
    fireEvent.change(screen.getByLabelText('ชื่อผู้รับคำเชิญ'), { target: { value: 'คุณผู้รับ' } });
    fireEvent.change(screen.getByLabelText(/^อ้างอิงช่องทางติดต่อที่ตรวจสอบแล้ว/), {
      target: { value: 'contact-verified' },
    });
    const form = screen.getByRole('button', { name: 'ตรวจคำเชิญก่อนสร้างลิงก์' }).closest('form')!;
    fireEvent.submit(form);
    expect(review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/ดีลกับผู้รับเรียบร้อย/));
    fireEvent.submit(form);
    expect(review.mock.calls[0][0]).toMatchObject({
      action: 'invite',
      input: {
        partnerId: partner.id,
        recipientName: 'คุณผู้รับ',
        verifiedContactRef: 'contact-verified',
        capabilities: ['view_content', 'view_earnings', 'view_statements'],
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('pins password recovery to the selected account, stored verified contact and current revision', () => {
    const review = vi.fn();
    render(<ResetForm partnerId={partner.id} member={member} onReview={review} />);
    fireEvent.click(screen.getByText('ช่วยตั้งรหัสผ่านใหม่'));
    fireEvent.change(screen.getByLabelText('อ้างอิงหลักฐานการตรวจสอบครั้งนี้'), {
      target: { value: 'support-evidence' },
    });
    fireEvent.click(screen.getByLabelText(/ตรวจสอบเจ้าของบัญชีผ่านช่องทาง/));
    fireEvent.submit(
      screen.getByRole('button', { name: 'ตรวจการออกลิงก์ตั้งรหัสใหม่' }).closest('form')!,
    );
    expect(review.mock.calls[0][0]).toMatchObject({
      action: 'reset',
      input: {
        partnerId: partner.id,
        userId: 'user-one',
        expectedRevision: '2',
        verifiedContactRef: 'contact-verified',
        verificationEvidenceRef: 'support-evidence',
      },
    });
    expect(screen.queryByLabelText('รหัสผ่าน')).not.toBeInTheDocument();
  });
  it('does not show another staff identity response inside the prior staff scope', async () => {
    fetcher.mockResolvedValue(
      response({ ...snapshot, session: { ...session, userId: 'different-staff' } }),
    );
    render(<StaffAccessConsole session={session} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('ตรวจสอบสิทธิ์');
    expect(screen.queryByText('เลือกพาร์ทเนอร์')).not.toBeInTheDocument();
  });
  it('shows an issued link only after confirmation, keeps it out of storage/cache requests, and removes it on close', async () => {
    fetcher.mockImplementation(async (path: string, options: { body: string }) =>
      path.endsWith('/staff/access')
        ? response({
            ...snapshot,
            selected: JSON.parse(options.body).partnerId ? snapshot.selected : null,
          })
        : response({ id: 'invite-one', partnerId: partner.id, token, replayed: false }),
    );
    render(<StaffAccessConsole session={session} />);
    await screen.findByText('เลือกพาร์ทเนอร์');
    fireEvent.click(screen.getByRole('button', { name: 'คุณพาร์ทเนอร์' }));
    fireEvent.click(await screen.findByText('สร้างคำเชิญใหม่'));
    fireEvent.change(screen.getByLabelText('ชื่อผู้รับคำเชิญ'), { target: { value: 'คุณผู้รับ' } });
    fireEvent.change(screen.getByLabelText(/^อ้างอิงช่องทางติดต่อที่ตรวจสอบแล้ว/), {
      target: { value: 'contact-verified' },
    });
    fireEvent.click(screen.getByLabelText(/ดีลกับผู้รับเรียบร้อย/));
    fireEvent.submit(
      screen.getByRole('button', { name: 'ตรวจคำเชิญก่อนสร้างลิงก์' }).closest('form')!,
    );
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/invitations/issue'))).toBe(false);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('คุณผู้รับ');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));
    const link = await screen.findByLabelText('ลิงก์ที่สร้าง');
    expect(link).toHaveValue(window.location.origin + '/invite#token=' + token);
    expect(window.location.href).not.toContain(token);
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
    expect(fetcher.mock.calls.every(([path]) => !String(path).includes(token))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'ปิดลิงก์' }));
    await waitFor(() => expect(screen.queryByLabelText('ลิงก์ที่สร้าง')).not.toBeInTheDocument());
  });
});
