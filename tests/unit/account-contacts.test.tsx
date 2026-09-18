import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountContacts } from '@/features/account/AccountContacts';
import {
  ContactRequestError,
  contactHttp,
  scopedContact,
  type ContactTransport,
} from '@/features/account/contact-http';
import { ContactPhone, type ContactSnapshotValue } from '@/contracts/account-contact';
const scope = { userId: 'user-a', partnerId: 'partner-a', permissionRevision: 'p1:m1' };
const empty: ContactSnapshotValue = {
  ...scope,
  revision: '0',
  contact: { email: null, phone: null },
  verification: 'unverified',
};
function fixture() {
  let stored = empty;
  const transport: ContactTransport = {
    read: vi.fn(async () => stored),
    save: vi.fn(async (_scope, revision, contact) => {
      stored = {
        ..._scope,
        revision: String(Number(revision) + 1),
        contact,
        verification: 'unverified',
      };
      return stored;
    }),
  };
  return { transport };
}
describe('account contact form', () => {
  it('sends the displayed actor and revision as expectations in the native write', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(empty));
    try {
      await contactHttp.save(scope, '0', empty.contact, new AbortController().signal);
      expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
        partnerId: scope.partnerId,
        permissionRevision: scope.permissionRevision,
        expectedUserId: scope.userId,
        expectedRevision: '0',
        contact: empty.contact,
      });
      expect(fetcher.mock.calls[0][1]).toMatchObject({
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } finally {
      fetcher.mockRestore();
    }
  });
  it('validates fields, saves normalized values and reloads the persisted result', async () => {
    const { transport } = fixture();
    const view = render(<AccountContacts scope={scope} transport={transport} />);
    const email = await screen.findByLabelText('อีเมล');
    const phone = screen.getByLabelText('เบอร์โทรศัพท์');
    const save = screen.getByRole('button', { name: 'บันทึกข้อมูลติดต่อ' });
    expect(save).toBeDisabled();
    fireEvent.change(email, { target: { value: 'invalid' } });
    fireEvent.change(phone, { target: { value: 'bad' } });
    fireEvent.click(save);
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(transport.save).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: 'partner@example.test' } });
    fireEvent.change(phone, { target: { value: '+66 81 234-5678' } });
    fireEvent.click(save);
    await screen.findByText('บันทึกข้อมูลติดต่อแล้ว');
    expect(transport.save).toHaveBeenCalledWith(
      scope,
      '0',
      { email: 'partner@example.test', phone: '+66812345678' },
      expect.any(AbortSignal),
    );
    expect(phone).toHaveValue('+66812345678');
    expect(save).toBeDisabled();
    view.unmount();
    render(<AccountContacts scope={scope} transport={transport} />);
    expect(await screen.findByLabelText('อีเมล')).toHaveValue('partner@example.test');
    fireEvent.change(screen.getByLabelText('อีเมล'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('เบอร์โทรศัพท์'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูลติดต่อ' }));
    await screen.findByText('บันทึกข้อมูลติดต่อแล้ว');
    expect(transport.save).toHaveBeenLastCalledWith(
      scope,
      '1',
      { email: null, phone: null },
      expect.any(AbortSignal),
    );
  });
  it('keeps the draft and requires explicit reload after a revision conflict', async () => {
    const { transport } = fixture();
    vi.mocked(transport.save).mockRejectedValue(new ContactRequestError(409));
    render(<AccountContacts scope={scope} transport={transport} />);
    fireEvent.change(await screen.findByLabelText('อีเมล'), {
      target: { value: 'draft@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูลติดต่อ' }));
    await screen.findByText(/ข้อมูลมีการเปลี่ยนแปลง/);
    expect(screen.getByLabelText('อีเมล')).toHaveValue('draft@example.test');
    expect(screen.getByRole('button', { name: 'บันทึกข้อมูลติดต่อ' })).toBeDisabled();
    vi.mocked(transport.read).mockResolvedValue({
      ...empty,
      revision: '2',
      contact: { email: 'new@example.test', phone: null },
    });
    fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }));
    await waitFor(() => expect(screen.getByLabelText('อีเมล')).toHaveValue('new@example.test'));
  });
  it('does not claim success for a lost write response', async () => {
    const { transport } = fixture();
    vi.mocked(transport.save).mockRejectedValue(new Error('Network'));
    render(<AccountContacts scope={scope} transport={transport} />);
    fireEvent.change(await screen.findByLabelText('อีเมล'), {
      target: { value: 'draft@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูลติดต่อ' }));
    await screen.findByText(/ยังยืนยันการบันทึกไม่ได้/);
    expect(screen.queryByText('บันทึกข้อมูลติดต่อแล้ว')).not.toBeInTheDocument();
  });
  it('fences stale reads when the active account changes', async () => {
    let finish!: (value: ContactSnapshotValue) => void;
    const { transport } = fixture();
    vi.mocked(transport.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<AccountContacts scope={scope} transport={transport} />);
    const nextScope = { ...scope, userId: 'user-b', partnerId: 'partner-b' };
    vi.mocked(transport.read).mockResolvedValue({ ...empty, ...nextScope });
    view.rerender(<AccountContacts scope={nextScope} transport={transport} />);
    await screen.findByLabelText('อีเมล');
    await act(async () =>
      finish({ ...empty, contact: { email: 'old@example.test', phone: null } }),
    );
    expect(screen.getByLabelText('อีเมล')).toHaveValue('');
    expect(() => scopedContact(empty, nextScope)).toThrow('scope');
  });
  it('shows retry instead of an editable empty form when loading fails', async () => {
    const { transport } = fixture();
    vi.mocked(transport.read).mockRejectedValue(new Error('Offline'));
    render(<AccountContacts scope={scope} transport={transport} />);
    await screen.findByText('โหลดข้อมูลติดต่อไม่สำเร็จ');
    expect(screen.queryByLabelText('อีเมล')).not.toBeInTheDocument();
  });
  it('accepts local and international phone numbers, rejects letters and misplaced plus', () => {
    expect(ContactPhone.parse('081-234-5678')).toBe('0812345678');
    expect(ContactPhone.parse('+66 (81) 234-5678')).toBe('+66812345678');
    for (const value of ['123', '08+12345678', 'abc0812345678', '1234567890123456'])
      expect(ContactPhone.safeParse(value).success).toBe(false);
  });
});
