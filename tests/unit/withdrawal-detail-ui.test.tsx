import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type {
  WithdrawalCancellationReceiptValue,
  WithdrawalRequestDetailValue,
} from '@/contracts/withdrawal-journey';
import {
  WithdrawalDetail,
  type WithdrawalDetailProps,
} from '@/features/withdrawals/WithdrawalDetail';
import { WithdrawalRequestFacts } from '@/features/withdrawals/WithdrawalRequestFacts';
import { formatMinor } from '@/shared/ui/format-money';

const money = (minor: string) => ({ currency: 'THB' as const, minor });
function detail(): WithdrawalRequestDetailValue {
  return {
    request: {
      requestRef: 'SYNTH-private-ref',
      idempotencyKey: 'SYNTH-submit-key',
      scope: {
        userId: 'SYNTH-user',
        partnerId: 'SYNTH-partner',
        permissionRevision: 'SYNTH-permission',
        payerId: 'SYNTH-payer',
        currency: 'THB',
        scenario: 'golden',
      },
      status: 'requested',
      gross: money('500000'),
      net: money('485000'),
      reserved: money('500000'),
      deductions: [{ kind: 'withholding_tax', label: 'ภาษีที่บันทึกไว้', amount: money('15000') }],
      beneficiary: {
        displayName: 'ผู้รับที่บันทึกไว้',
        bankName: 'ธนาคารตัวอย่าง',
        maskedAccount: '••••1234',
        version: 'beneficiary-1',
      },
      quoteId: 'quote-1',
      bindings: {
        balanceRevision: 'balance-1',
        policyRevision: 'policy-1',
        beneficiaryVersion: 'beneficiary-1',
      },
      submittedAt: '2026-09-16T01:00:00Z',
      allowedActions: ['cancel', 'check_status'],
    },
    timeline: [
      {
        seq: 1,
        at: '2026-09-16T01:00:00Z',
        kind: 'submitted',
        status: 'requested',
        detail: 'รับคำขอจากต้นทาง',
      },
    ],
    historyComplete: true,
    sourceContext: {
      state: 'known',
      allocationModeled: false,
      periods: [
        {
          periodId: 'period-1',
          label: 'งวดตัวอย่างหนึ่ง',
          releasedAt: '2026-09-01T00:00:00Z',
          releasedAmount: money('1000000'),
          statementId: 'statement-1',
        },
        {
          periodId: 'period-2',
          label: 'งวดตัวอย่างสอง',
          releasedAt: null,
          releasedAmount: null,
          statementId: null,
        },
      ],
    },
    documents: { state: 'pending', reasons: ['ยังไม่มีเอกสารจากต้นทาง'] },
    pendingCancellations: [],
    revision: 'revision-1',
  };
}
function receipt(
  value: WithdrawalRequestDetailValue,
  key: string,
): WithdrawalCancellationReceiptValue {
  return {
    scope: value.request.scope,
    operationKey: key,
    requestRef: value.request.requestRef,
    requestIdempotencyKey: value.request.idempotencyKey,
    expectedRevision: value.revision,
    outcome: 'unknown',
    code: null,
    detail: 'ผลการยกเลิกยังไม่ชัดเจน',
    createdAt: '2026-09-16T02:00:00Z',
    resolvedAt: null,
  };
}
function props(overrides: Partial<WithdrawalDetailProps> = {}): WithdrawalDetailProps {
  return {
    detail: detail(),
    state: 'ready',
    backHref: '/transactions-preview?view=withdrawals&identity=b',
    periodHref: (id) => `/transactions-preview/${id}?returnTo=safe`,
    ...overrides,
  };
}
const actions = () => ({
  cancel: { enabled: true, onClick: vi.fn() },
  checkStatus: { enabled: true, onClick: vi.fn() },
  recoverCancellation: { enabled: true, onClick: vi.fn() },
});

describe('Withdrawal detail presentation', () => {
  it('retains net and reserved facts by default for other review surfaces', () => {
    render(<WithdrawalRequestFacts request={detail().request} />);
    expect(screen.getByText('ยอดรับเข้าบัญชีหลังหักรายการต่าง ๆ')).toBeVisible();
    expect(screen.getByText('฿4,850.00')).toBeVisible();
    expect(screen.getByText('ยอดที่กันไว้สำหรับคำขอนี้')).toBeVisible();
    expect(screen.getAllByText('฿5,000.00')).toHaveLength(2);
  });
  it('reuses exact financial facts, beneficiary snapshot and the caller back link', () => {
    render(<WithdrawalDetail {...props()} />);
    const facts = within(screen.getByRole('article', { name: 'รายละเอียดคำขอถอน' }));
    expect(facts.getByText('SYNTH-private-ref')).toBeVisible();
    expect(facts.getAllByText('฿5,000.00')).toHaveLength(2);
    expect(facts.getByText('฿4,850.00')).toBeVisible();
    expect(facts.getByText('฿150.00')).toBeVisible();
    expect(facts.getByText('ภาษีที่บันทึกไว้')).toBeVisible();
    expect(facts.getByText('ผู้รับที่บันทึกไว้')).toBeVisible();
    expect(facts.getByText('••••1234')).toBeVisible();
    expect(facts.queryByText('รอดำเนินการ')).toBeNull();
    const timeline = within(screen.getByRole('article', { name: 'ลำดับสถานะคำขอ' }));
    expect(timeline.getByText('รอดำเนินการ')).toBeVisible();
    expect(screen.queryByText('โอนเงินแล้ว')).toBeNull();
    const backNavigation = within(
      screen.getByRole('navigation', { name: 'กลับรายการคำขอถอนเงิน' }),
    );
    for (const back of [
      backNavigation.getByRole('link', { name: 'กลับคำขอถอนเงินทั้งหมด' }),
      facts.getByRole('link', { name: 'กลับคำขอถอนเงินทั้งหมด' }),
    ]) {
      expect(back).toHaveAttribute('href', '/transactions-preview?view=withdrawals&identity=b');
    }
    expect(screen.queryByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeNull();
  });

  it('preserves authoritative sequence order even when the clock moves backwards', () => {
    const value = detail();
    value.request.status = 'processing';
    value.timeline.push({
      seq: 2,
      at: '2026-09-15T23:00:00Z',
      kind: 'processing',
      status: 'processing',
      detail: 'เหตุการณ์ลำดับสอง',
    });
    render(<WithdrawalDetail {...props({ detail: value })} />);
    const items = within(screen.getByRole('article', { name: 'ลำดับสถานะคำขอ' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('รับคำขอจากต้นทาง');
    expect(items[1]).toHaveTextContent('เหตุการณ์ลำดับสอง');
    expect(items[1].querySelector('time')).toHaveAttribute('datetime', '2026-09-15T23:00:00Z');
  });

  it('labels an incomplete legacy snapshot without inventing when that status occurred', () => {
    const value = detail();
    value.historyComplete = false;
    value.request.status = 'paid';
    value.request.reserved = money('0');
    value.request.allowedActions = ['check_status'];
    value.timeline = [
      {
        seq: 0,
        at: value.request.submittedAt,
        kind: 'legacy_snapshot',
        status: 'processing',
        detail: 'ข้อมูลสถานะจากระบบเดิม',
      },
      {
        seq: 1,
        at: '2026-09-17T01:00:00Z',
        kind: 'paid',
        status: 'paid',
        detail: 'ผลโอนที่บันทึกภายหลัง',
      },
    ];
    render(<WithdrawalDetail {...props({ detail: value })} />);
    const timeline = within(screen.getByRole('article', { name: 'ลำดับสถานะคำขอ' }));
    expect(timeline.getByText(/ประวัติเดิมบันทึกไว้ไม่ครบ/)).toBeVisible();
    const items = timeline.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('ไม่มีเวลาที่สถานะเกิดขึ้น');
    expect(items[0].querySelector('time')).toBeNull();
    expect(items[1].querySelector('time')).toHaveAttribute('datetime', '2026-09-17T01:00:00Z');
    expect(timeline.queryByText('รอดำเนินการ')).toBeNull();
    expect(
      screen.getByRole('article', { name: 'รายละเอียดคำขอถอน' }).querySelector('time'),
    ).toHaveAttribute('datetime', value.request.submittedAt);
  });

  it('shows pool releases without allocating them, builds only mapped links, and leaves unknown amounts unknown', () => {
    const periodHref = vi.fn(() => '/caller-safe-statement');
    render(<WithdrawalDetail {...props({ periodHref })} />);
    const context = within(screen.getByRole('article', { name: 'งวดที่เกี่ยวข้องกับยอดสะสม' }));
    expect(context.queryByText(/ยังไม่ได้จัดสรรว่าคำขอนี้ถอนจากแต่ละงวดเท่าไร/)).toBeNull();
    expect(context.getByText('฿10,000.00')).toBeVisible();
    expect(context.getByLabelText('ยังไม่มีข้อมูลยอดที่งวดนี้ปล่อย')).toHaveTextContent('—');
    expect(context.getByText('ยังไม่มีวันที่ปล่อยยอดจากต้นทาง')).toBeVisible();
    expect(context.queryByText('฿0.00')).toBeNull();
    expect(periodHref).toHaveBeenCalledTimes(1);
    expect(periodHref).toHaveBeenCalledWith('statement-1');
    expect(context.getByRole('link')).toHaveAttribute('href', '/caller-safe-statement');
    const docs = within(screen.getByRole('article', { name: 'เอกสารของคำขอ' }));
    expect(docs.getByText('หลักฐานจะพร้อมเมื่อโอนเงินสำเร็จ')).toBeVisible();
    expect(docs.getByText('ยังไม่มีเอกสารจากต้นทาง')).toBeVisible();
    expect(docs.queryByRole('link')).toBeNull();
  });

  it('distinguishes unavailable source context from a known empty snapshot, without inventing links', () => {
    const value = detail();
    value.sourceContext = { state: 'unavailable', reasons: ['ข้อมูลเดิมไม่ได้บันทึกงวด'] };
    const p = props({ detail: value, periodHref: undefined });
    const { rerender } = render(<WithdrawalDetail {...p} />);
    expect(screen.getByText('ข้อมูลเดิมไม่ได้บันทึกงวด')).toBeVisible();
    value.sourceContext = { state: 'known', periods: [], allocationModeled: false };
    rerender(<WithdrawalDetail {...p} />);
    expect(screen.queryByText('ข้อมูลเดิมไม่ได้บันทึกงวด')).toBeNull();
    expect(screen.getByText('ไม่มีรายการงวดในข้อมูลที่บันทึกไว้')).toBeVisible();
    rerender(<WithdrawalDetail {...props({ periodHref: undefined })} />);
    expect(
      within(screen.getByRole('article', { name: 'งวดที่เกี่ยวข้องกับยอดสะสม' })).queryByRole(
        'link',
      ),
    ).toBeNull();
  });

  it('recovers each supplied unresolved cancellation independently and blocks a new cancellation', () => {
    const value = detail();
    value.pendingCancellations = [receipt(value, 'operation-one'), receipt(value, 'operation-two')];
    const callbacks = actions();
    render(<WithdrawalDetail {...props({ detail: value, actions: callbacks })} />);
    expect(screen.getByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบผลการยกเลิก operation-two' }));
    expect(callbacks.recoverCancellation.onClick).toHaveBeenCalledExactlyOnceWith(
      value.pendingCancellations[1],
    );
    expect(screen.getByText('operation-one')).toBeVisible();
    expect(screen.getByText('operation-two')).toBeVisible();
    expect(screen.queryByText('คำขอถูกยกเลิกแล้ว')).toBeNull();
    expect(screen.queryByText('฿0.00')).toBeNull();
  });

  it('disables actions while cancellation recovery is busy and keeps the original receipt visible', () => {
    const value = detail();
    value.pendingCancellations = [receipt(value, 'operation-one'), receipt(value, 'operation-two')];
    const callbacks = actions();
    render(
      <WithdrawalDetail
        {...props({
          detail: value,
          actions: {
            ...callbacks,
            recoverCancellation: {
              ...callbacks.recoverCancellation,
              checkingOperationKey: 'operation-two',
            },
          },
        })}
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(callbacks.recoverCancellation.onClick).not.toHaveBeenCalled();
    expect(callbacks.checkStatus.onClick).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'ตรวจสอบผลการยกเลิก operation-two' }),
    ).toHaveTextContent('กำลังตรวจสอบ…');
  });

  it('requires caller enablement plus supplied allowed actions without granting authority from requested status', () => {
    const value = detail();
    const callbacks = actions();
    const p = props({ detail: value, actions: callbacks });
    const { rerender } = render(<WithdrawalDetail {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิกคำขอถอน' }));
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะคำขอ' }));
    expect(callbacks.cancel.onClick).toHaveBeenCalledTimes(1);
    expect(callbacks.checkStatus.onClick).toHaveBeenCalledTimes(1);
    rerender(
      <WithdrawalDetail
        {...p}
        actions={{ ...callbacks, cancel: { ...callbacks.cancel, enabled: false } }}
      />,
    );
    expect(screen.getByRole('button', { name: 'ยกเลิกคำขอถอน' })).toBeDisabled();
    value.request.allowedActions = [];
    rerender(<WithdrawalDetail {...p} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('makes stale detail read-only despite enabled callbacks while allowing explicit refresh', () => {
    const value = detail();
    value.pendingCancellations = [receipt(value, 'operation-one')];
    const callbacks = actions();
    const onRetry = vi.fn();
    render(
      <WithdrawalDetail
        {...props({ detail: value, actions: callbacks, state: 'stale', onRetry })}
      />,
    );
    expect(screen.getByText(/อ่านได้อย่างเดียวจนกว่าจะตรวจสอบข้อมูลล่าสุด/)).toBeVisible();
    for (const name of ['ยกเลิกคำขอถอน', 'ตรวจสอบสถานะคำขอ', 'ตรวจสอบผลการยกเลิก operation-one']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(callbacks.cancel.onClick).not.toHaveBeenCalled();
    expect(callbacks.checkStatus.onClick).not.toHaveBeenCalled();
    expect(callbacks.recoverCancellation.onClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('SYNTH-private-ref')).toBeVisible();
  });

  it.each(['loading', 'read-error', 'invalid', 'unavailable', 'missing'] as const)(
    'hides all stale private detail and action data in %s state',
    (state) => {
      const value = detail();
      value.pendingCancellations = [receipt(value, 'operation-private')];
      const periodHref = vi.fn(() => '/safe');
      const onRetry = vi.fn();
      render(
        <WithdrawalDetail
          {...props({ detail: value, state, actions: actions(), periodHref, onRetry })}
        />,
      );
      expect(screen.queryByRole('article')).toBeNull();
      for (const privateText of [
        'SYNTH-private-ref',
        'operation-private',
        'ผู้รับที่บันทึกไว้',
        'งวดตัวอย่างหนึ่ง',
      ])
        expect(screen.queryByText(privateText)).toBeNull();
      expect(periodHref).not.toHaveBeenCalled();
      expect(screen.getAllByRole('link')).toHaveLength(1);
      if (state === 'loading') expect(screen.queryByRole('button')).toBeNull();
      else {
        fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(['ready', 'stale'] as const)(
    'does not invent a request or snapshot in %s when no validated detail exists',
    (state) => {
      render(<WithdrawalDetail {...props({ detail: null, state })} />);
      expect(screen.getByText('ยังไม่มีรายละเอียดคำขอที่ตรวจสอบได้')).toBeVisible();
      expect(screen.queryByText(/แสดงรายละเอียดครั้งล่าสุด/)).toBeNull();
      expect(screen.queryByRole('article')).toBeNull();
    },
  );

  it('reflects a new parent identity immediately without retaining old private snapshots or operations', () => {
    const old = detail();
    old.pendingCancellations = [receipt(old, 'old-operation')];
    const { rerender } = render(<WithdrawalDetail {...props({ detail: old })} />);
    const current = detail();
    current.request.requestRef = 'new-ref';
    current.request.beneficiary.displayName = 'ผู้รับอีกขอบเขต';
    rerender(
      <WithdrawalDetail
        {...props({ detail: current, actions: { message: 'ข้อมูลจากขอบเขตปัจจุบัน' } })}
      />,
    );
    expect(screen.queryByText('SYNTH-private-ref')).toBeNull();
    expect(screen.queryByText('old-operation')).toBeNull();
    expect(screen.queryByText('ผู้รับที่บันทึกไว้')).toBeNull();
    expect(screen.getByText('new-ref')).toBeVisible();
    expect(screen.getByText('ผู้รับอีกขอบเขต')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('ข้อมูลจากขอบเขตปัจจุบัน');
  });

  it('keeps long references and huge exact amounts intact without a floating point conversion', () => {
    const value = detail();
    value.request.requestRef = 'SYNTH-' + 'r'.repeat(190);
    value.request.gross = value.request.reserved = money(
      '9999999999999999999999999999999999999999',
    );
    value.request.net = money('9999999999999999999999999999999999999998');
    value.request.deductions = [{ kind: 'other', label: 'หนึ่งสตางค์', amount: money('1') }];
    render(<WithdrawalDetail {...props({ detail: value })} />);
    expect(screen.getByText(value.request.requestRef)).toBeVisible();
    expect(screen.getAllByText(formatMinor(value.request.gross.minor, false))).toHaveLength(2);
    expect(screen.getByText(formatMinor(value.request.net.minor, false))).toBeVisible();
    expect(screen.getByText('฿0.01')).toBeVisible();
  });
});
