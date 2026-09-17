import { beforeEach, afterEach, beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { StaffAccountProfile } from '@/features/staff-account/StaffAccountProfile';
const fetcher = vi.fn();
const review = {
  partnerId: 'p1',
  reviewId: 'deal-1',
  expectedRevision: '0',
  expectedDigest: 'a'.repeat(64),
  profile: {
    partnerId: 'p1',
    sourceRevision: 'signed-1',
    evidenceRef: 'signed-deal',
    agreement: null,
    termsSummary: null,
    supportUrl: null,
  },
};
const response = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
const originals = Object.fromEntries(
  ['showModal', 'close'].map((k) => [
    k,
    Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, k),
  ]),
);
beforeAll(() => {
  for (const k of ['showModal', 'close'])
    Object.defineProperty(HTMLDialogElement.prototype, k, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = k === 'showModal';
      },
    });
});
afterAll(() => {
  for (const k of ['showModal', 'close']) {
    if (originals[k]) Object.defineProperty(HTMLDialogElement.prototype, k, originals[k]!);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, k);
  }
});
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());
function inspect() {
  fireEvent.change(screen.getByLabelText('รหัสอ้างอิงข้อตกลง'), { target: { value: 'deal-1' } });
  fireEvent.submit(screen.getByRole('button', { name: 'เปิดตรวจข้อตกลง' }).closest('form')!);
}
describe('staff agreement publication', () => {
  it('uses the shared safe source-reference constraint in the input', () => {
    render(<StaffAccountProfile partnerId="p1" partnerName="ดารา" />);
    const input = screen.getByLabelText('รหัสอ้างอิงข้อตกลง') as HTMLInputElement;
    const pattern = new RegExp('^' + input.pattern + '$', 'v');
    for (const value of ['_deal', '-deal', '../deal', 'a'.repeat(129)])
      expect(pattern.test(value)).toBe(false);
    for (const value of ['deal-1', 'A_1', '1']) expect(pattern.test(value)).toBe(true);
  });
  it('requires explicit confirmation and sends only the inspected reference/digest/revision', async () => {
    fetcher
      .mockResolvedValueOnce(response(review))
      .mockResolvedValueOnce(response({ partnerId: 'p1', revision: '1' }));
    render(<StaffAccountProfile partnerId="p1" partnerName="คุณดารา" />);
    inspect();
    fireEvent.click(await screen.findByRole('button', { name: 'นำข้อตกลงขึ้นแสดง' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('คุณดารา')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^ยืนยัน$/ }));
    await screen.findByText('นำข้อตกลงขึ้นแสดงในหน้าบัญชีพาร์ทเนอร์แล้ว');
    const cmd = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(cmd).toMatchObject({
      partnerId: 'p1',
      reviewId: 'deal-1',
      expectedDigest: review.expectedDigest,
      expectedRevision: '0',
    });
    expect(cmd).not.toHaveProperty('profile');
    expect(cmd.idempotencyKey).toBeTruthy();
  });
  it('clears a reviewed source when reference or partner changes', async () => {
    fetcher.mockResolvedValue(response(review));
    const view = render(<StaffAccountProfile partnerId="p1" partnerName="ดารา" />);
    inspect();
    await screen.findByRole('button', { name: 'นำข้อตกลงขึ้นแสดง' });
    fireEvent.change(screen.getByLabelText('รหัสอ้างอิงข้อตกลง'), { target: { value: 'deal-2' } });
    expect(screen.queryByRole('button', { name: 'นำข้อตกลงขึ้นแสดง' })).toBeNull();
    inspect();
    await screen.findByRole('button', { name: 'นำข้อตกลงขึ้นแสดง' });
    view.rerender(<StaffAccountProfile partnerId="p2" partnerName="อีกคน" />);
    expect(screen.queryByRole('button', { name: 'นำข้อตกลงขึ้นแสดง' })).toBeNull();
    expect((screen.getByLabelText('รหัสอ้างอิงข้อตกลง') as HTMLInputElement).value).toBe('');
  });
  it('ignores late inspection responses and rejects mismatched partner responses', async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<StaffAccountProfile partnerId="p1" partnerName="ดารา" />);
    inspect();
    fireEvent.change(screen.getByLabelText('รหัสอ้างอิงข้อตกลง'), { target: { value: 'deal-2' } });
    resolve(response(review));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'เปิดตรวจข้อตกลง' })).not.toBeDisabled(),
    );
    expect(screen.queryByRole('button', { name: 'นำข้อตกลงขึ้นแสดง' })).toBeNull();
    fetcher.mockResolvedValueOnce(response({ ...review, partnerId: 'p2' }));
    inspect();
    await screen.findByText(/เปิดหรือเผยแพร่ข้อตกลงไม่สำเร็จ/);
    expect(screen.queryByRole('button', { name: 'นำข้อตกลงขึ้นแสดง' })).toBeNull();
  });
  it('retains one idempotency key after a failed confirmation', async () => {
    fetcher
      .mockResolvedValueOnce(response(review))
      .mockResolvedValueOnce(response({ code: 'CHANGED' }, 409))
      .mockResolvedValueOnce(response({ partnerId: 'p1', revision: '1' }));
    render(<StaffAccountProfile partnerId="p1" partnerName="ดารา" />);
    inspect();
    fireEvent.click(await screen.findByRole('button', { name: 'นำข้อตกลงขึ้นแสดง' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^ยืนยัน$/ }));
    await screen.findByText(/ข้อตกลงหรือข้อมูลที่แสดงเปลี่ยนแล้ว/);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^ยืนยัน$/ }));
    await screen.findByText('นำข้อตกลงขึ้นแสดงในหน้าบัญชีพาร์ทเนอร์แล้ว');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).idempotencyKey).toBe(
      JSON.parse(fetcher.mock.calls[2][1].body).idempotencyKey,
    );
  });
});
