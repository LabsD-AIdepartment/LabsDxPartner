import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type {
  WithdrawalQuoteValue,
  WithdrawalRequestValue,
  WithdrawalResumeValue,
} from '@/contracts/withdrawal-journey';
import {
  WithdrawalRequestSheet,
  type WithdrawalRequestSheetProps,
  type WithdrawalSheetView,
} from '@/features/withdrawals/WithdrawalRequestSheet';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
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
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

const money = (minor: string) => ({ currency: 'THB' as const, minor });
const scope = {
  userId: 'SYNTH-sheet-user',
  partnerId: 'SYNTH-sheet-partner',
  permissionRevision: 'SYNTH-sheet-permission',
  payerId: 'SYNTH-sheet-payer',
  currency: 'THB' as const,
  scenario: 'SYNTH-sheet-scenario',
};
const snapshot = {
  displayName: 'ผู้รับเงินในคำขอเดิม',
  bankName: 'ธนาคารในคำขอเดิม',
  maskedAccount: '••••1234',
  version: 'SYNTH-beneficiary-v1',
};
const quote: Extract<WithdrawalQuoteValue, { state: 'quoted' }> = {
  state: 'quoted',
  quoteId: 'SYNTH-sheet-quote',
  scope,
  gross: money('500000'),
  deductions: [
    { kind: 'withholding_tax', label: 'ภาษีหัก ณ ที่จ่ายตามรายการ', amount: money('15000') },
  ],
  net: money('485000'),
  availableAfterRequest: money('1500000'),
  beneficiary: snapshot,
  bindings: {
    balanceRevision: 'SYNTH-balance-1',
    policyRevision: 'SYNTH-policy-1',
    beneficiaryVersion: snapshot.version,
  },
  issuedAt: '2026-09-16T01:00:00Z',
  expiresAt: '2026-09-16T01:05:00Z',
};
const request: WithdrawalRequestValue = {
  requestRef: 'SYNTH-request-1',
  idempotencyKey: 'SYNTH-key-1',
  scope,
  status: 'requested',
  gross: quote.gross,
  net: quote.net,
  deductions: quote.deductions,
  reserved: quote.gross,
  beneficiary: snapshot,
  quoteId: quote.quoteId,
  bindings: quote.bindings,
  submittedAt: quote.issuedAt,
  allowedActions: ['cancel', 'check_status'],
};
const currentBeneficiary = {
  state: 'known' as const,
  displayName: 'ผู้รับเงินปัจจุบัน',
  bankName: 'ธนาคารปัจจุบัน',
  maskedAccount: '••••9999',
  version: 'SYNTH-beneficiary-v2',
};

function props(
  view: WithdrawalSheetView,
  overrides: Partial<WithdrawalRequestSheetProps> = {},
): WithdrawalRequestSheetProps {
  return {
    open: true,
    view,
    available: money('2000000'),
    beneficiary: currentBeneficiary,
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('Withdrawal request sheet presentation', () => {
  it('passes raw partial text and all/partial selection to controlled callbacks without parsing it', () => {
    const onAmountChange = vi.fn();
    const onModeChange = vi.fn();
    const onReview = vi.fn();
    render(
      <WithdrawalRequestSheet
        {...props(
          { state: 'editing', mode: 'partial', amountText: '5000', canReview: true },
          { onAmountChange, onModeChange, onReview },
        )}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'ยอดที่ขอถอน (บาท)' });
    expect(field).toHaveAttribute('inputmode', 'decimal');
    fireEvent.change(field, { target: { value: '1,5.000oops' } });
    expect(onAmountChange).toHaveBeenCalledWith('1,5.000oops');
    expect(field).toHaveValue('5000');
    fireEvent.click(screen.getByRole('radio', { name: 'ถอนทั้งหมด' }));
    expect(onModeChange).toHaveBeenCalledWith('all');
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(screen.getByText('฿20,000')).toBeVisible();
  });

  it('shows missing recipient and unknown available without inventing zero, and honors supplied review eligibility', () => {
    const onReview = vi.fn();
    render(
      <WithdrawalRequestSheet
        {...props(
          {
            state: 'editing',
            mode: 'all',
            amountText: '',
            canReview: false,
            reasons: ['ข้อมูลภาษียังไม่พร้อม'],
          },
          {
            available: null,
            beneficiary: { state: 'missing', reasons: ['ยังไม่มีบัญชีผู้รับเงิน'] },
            onReview,
          },
        )}
      />,
    );
    expect(screen.getByLabelText('ยังไม่มีข้อมูลยอดพร้อมถอน')).toHaveTextContent('—');
    expect(screen.queryByText('฿0')).toBeNull();
    expect(screen.getByText('ยังไม่มีข้อมูลบัญชีรับเงิน')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('ข้อมูลภาษียังไม่พร้อม');
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบรายการ' }));
    expect(onReview).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('announces a supplied field error and focuses the invalid amount field', () => {
    render(
      <WithdrawalRequestSheet
        {...props({
          state: 'editing',
          mode: 'partial',
          amountText: '1.234',
          fieldError: 'ระบุทศนิยมได้ไม่เกิน 2 ตำแหน่ง',
          canReview: false,
        })}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'ยอดที่ขอถอน (บาท)' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('ระบุทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
  });

  it('disables repeated review and amount changes while quoting', () => {
    const onReview = vi.fn();
    render(
      <WithdrawalRequestSheet
        {...props({ state: 'quoting', mode: 'partial', amountText: '5000' }, { onReview })}
      />,
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'ถอนทั้งหมด' })).toBeDisabled();
    const button = screen.getByRole('button', { name: 'กำลังตรวจสอบ…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onReview).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังตรวจสอบยอดและรายการหัก');
  });

  it('shows only supplied quote values and immutable beneficiary, with explicit edit/confirm callbacks', () => {
    const onEdit = vi.fn();
    const onConfirm = vi.fn();
    render(
      <WithdrawalRequestSheet
        {...props({ state: 'review', quote, canConfirm: true }, { onEdit, onConfirm })}
      />,
    );
    for (const amount of ['฿5,000.00', '฿150.00', '฿4,850.00', '฿15,000.00'])
      expect(screen.getByText(amount)).toBeVisible();
    expect(screen.getByText('ผู้รับเงินในคำขอเดิม')).toBeVisible();
    expect(screen.getByText('••••1234')).toBeVisible();
    expect(screen.queryByText('••••9999')).toBeNull();
    expect(screen.getByText(/ระบบจะเริ่มดำเนินการถอน/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไขจำนวนเงิน' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'ตรวจสอบก่อนถอนเงิน' })).toHaveFocus();
  });

  it('keeps a changed quote unconfirmable according to supplied eligibility', () => {
    const onConfirm = vi.fn();
    render(
      <WithdrawalRequestSheet
        {...props(
          { state: 'review', quote, canConfirm: false, notice: 'ยอดเปลี่ยนแล้ว กรุณาตรวจสอบใหม่' },
          { onConfirm },
        )}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('ยอดเปลี่ยนแล้ว');
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอนเงิน' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables duplicate confirm while submitting; close and Escape are visibility callbacks only', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <WithdrawalRequestSheet {...props({ state: 'submitting', quote }, { onConfirm, onClose })} />,
    );
    const button = screen.getByRole('button', { name: 'กำลังดำเนินการ…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('รายการยังคงดำเนินต่อ');
    expect(screen.queryByRole('button', { name: /ยกเลิก/ })).toBeNull();
    expect(screen.getByText('฿4,850.00')).toBeVisible();
  });

  it('keeps unknown outcome separate from success and recovers the supplied handle unchanged', () => {
    const onRecover = vi.fn();
    const handle = { idempotencyKey: 'SYNTH-unknown-key' };
    const view: WithdrawalSheetView = { state: 'uncertain', handle, canRecover: true };
    const p = props(view, { onRecover });
    const { rerender } = render(<WithdrawalRequestSheet {...p} />);
    expect(screen.getByRole('heading', { name: 'ยังยืนยันผลคำขอไม่ได้' })).toBeVisible();
    expect(screen.queryByText('รอดำเนินการ')).toBeNull();
    expect(screen.queryByText('โอนเงินแล้ว')).toBeNull();
    expect(screen.queryByText('฿5,000.00')).toBeNull();
    expect(screen.queryByText('••••9999')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอเดิม' }));
    expect(onRecover).toHaveBeenCalledWith(handle);
    rerender(<WithdrawalRequestSheet {...p} view={{ ...view, checking: true }} />);
    expect(screen.getByRole('button', { name: 'กำลังตรวจสอบ…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'ขอถอนเงินเพิ่ม' })).toBeNull();
  });

  it('shows reserved amounts and old beneficiary for a supplied uncertain request', () => {
    render(
      <WithdrawalRequestSheet
        {...props(
          {
            state: 'uncertain',
            handle: { idempotencyKey: request.idempotencyKey, requestRef: request.requestRef },
            request: {
              ...request,
              status: 'reconciling',
              allowedActions: ['check_status', 'contact_support'],
            },
            canRecover: true,
          },
          { onRecover: vi.fn() },
        )}
      />,
    );
    expect(screen.getByText('ยอดที่กันไว้สำหรับคำขอนี้')).toBeVisible();
    expect(screen.getAllByText('฿5,000.00')).toHaveLength(2);
    expect(screen.getByText('••••1234')).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /โอนใหม่|ติดต่อ|ยกเลิก/ })).toBeNull();
  });

  it('does not infer paid from a result and only labels paid when explicitly supplied', () => {
    const p = props({ state: 'result', request, canRecover: true }, { onRecover: vi.fn() });
    const { rerender } = render(<WithdrawalRequestSheet {...p} />);
    expect(screen.getByRole('heading', { name: 'รอดำเนินการ' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('ยังรอดำเนินการ');
    expect(screen.queryByRole('heading', { name: 'โอนเงินแล้ว' })).toBeNull();
    expect(screen.queryByRole('button', { name: /ยกเลิก/ })).toBeNull();
    rerender(
      <WithdrawalRequestSheet
        {...p}
        view={{
          state: 'result',
          request: { ...request, status: 'paid', reserved: money('0'), allowedActions: [] },
          canRecover: false,
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'โอนเงินแล้ว' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ตรวจสอบสถานะ' })).toBeNull();
  });

  it('renders every supplied active handle and recovers the chosen one rather than the first', () => {
    const onRecover = vi.fn();
    const onNewRequest = vi.fn();
    const entries: WithdrawalResumeValue[] = Array.from({ length: 51 }, (_, i) => ({
      requestRef: `SYNTH-ref-${i}`,
      idempotencyKey: `SYNTH-key-${i}`,
      status: i === 50 ? 'reconciling' : 'requested',
      gross: request.gross,
      net: request.net,
      reserved: request.reserved,
      submittedAt: request.submittedAt,
      allowedActions: ['check_status'],
    }));
    const p = props({ state: 'active', entries }, { onRecover, onNewRequest, canStartNew: true });
    const { rerender } = render(<WithdrawalRequestSheet {...p} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(51);
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบคำขอ SYNTH-ref-50' }));
    expect(onRecover).toHaveBeenCalledWith({
      idempotencyKey: 'SYNTH-key-50',
      requestRef: 'SYNTH-ref-50',
    });
    fireEvent.click(screen.getByRole('button', { name: 'ขอถอนเงินเพิ่ม' }));
    expect(onNewRequest).toHaveBeenCalledTimes(1);
    rerender(
      <WithdrawalRequestSheet
        {...p}
        view={{ state: 'active', entries, checkingKey: 'SYNTH-key-50' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'ตรวจสอบคำขอ SYNTH-ref-0' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ตรวจสอบคำขอ SYNTH-ref-50' })).toBeDisabled();
  });

  it('omits unsupported actions and preserves long reference and beneficiary text', () => {
    const longRef = 'SYNTH-' + 'x'.repeat(200);
    const longName = 'ชื่อผู้รับเงิน'.repeat(10);
    render(
      <WithdrawalRequestSheet
        {...props(
          {
            state: 'result',
            request: {
              ...request,
              requestRef: longRef,
              beneficiary: { ...snapshot, displayName: longName },
              allowedActions: ['cancel', 'contact_support'],
            },
            canRecover: true,
          },
          { onRecover: vi.fn() },
        )}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'ถอนเงิน' });
    expect(within(dialog).getByText(longRef)).toBeVisible();
    expect(within(dialog).getByText(longName)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ตรวจสอบสถานะ' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
