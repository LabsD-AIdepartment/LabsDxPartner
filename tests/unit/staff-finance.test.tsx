import { afterEach, beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StaffFinanceConsole } from '@/features/staff-finance/StaffFinanceConsole';
import { safeReturnTo, loginHref } from '@/shared/routing/partner-paths';
const session = { userId: 'staff', displayName: 'ทีม LabsD', revision: '1' };
const period = {
  id: 'scope',
  partnerId: 'partner',
  partnerName: 'ดาราทดลอง',
  partnerActive: true,
  period: {
    from: '2026-07-01T00:00:00+07:00',
    toExclusive: '2026-09-01T00:00:00+07:00',
    timezone: 'Asia/Bangkok',
  },
  generationId: 'bc49ad44-dbd7-43ab-8834-71a32ca59afc',
  approvalId: '46ec4f99-e211-40e1-a21e-55b5fa1b8adc',
  reviewId: 'source-review',
  state: 'ready',
  amount: { currency: 'THB', minor: '3736000' },
  eligibleBase: { currency: 'THB', minor: '55000000' },
  includedCount: 6,
  excludedCount: 0,
  issues: [],
  dataThrough: '2026-09-01T05:00:00Z',
  statementId: null,
  scheduledAt: null,
  settled: null,
  closing: null,
};
const snapshot = (detail: boolean) => ({
  session,
  q: '',
  partnerId: detail ? 'partner' : null,
  scopeId: detail ? 'scope' : null,
  periods: { items: [period], nextCursor: null, totalCount: null },
  lines: detail ? { items: [], nextCursor: null, totalCount: 0 } : null,
  asOf: '2026-09-09T05:00:00Z',
});
const oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal'),
  oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
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
  for (const [key, descriptor] of [
    ['showModal', oldShow],
    ['close', oldClose],
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});
afterEach(() => vi.unstubAllGlobals());
describe('staff publication review', () => {
  it('allows the concrete finance reauthentication destination only', () => {
    expect(safeReturnTo('/ops/periods')).toBe('/ops/periods');
    expect(loginHref('/ops/periods')).toBe('/login?next=%2Fops%2Fperiods');
    for (const path of [
      '/ops/periods/unsafe',
      '/ops/periods?override=true',
      '//foreign.test/ops/periods',
    ])
      expect(safeReturnTo(path)).toBe('/overview');
  });
  it('requires review, sends immutable references rather than amounts, and safely retries fresh-auth errors', async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          return Response.json({ code: 'FRESH_AUTH_REQUIRED' }, { status: 403 });
        }
        return Response.json(
          snapshot(new URL(url, 'https://local.test').searchParams.has('scopeId')),
        );
      }),
    );
    render(<StaffFinanceConsole session={session} />);
    fireEvent.click(await screen.findByRole('button', { name: 'ดูรายการและหลักฐาน' }));
    const date = await screen.findByLabelText('กำหนดจ่าย');
    fireEvent.change(date, { target: { value: '2026-09-15' } });
    fireEvent.submit(screen.getByRole('button', { name: 'ตรวจการเผยแพร่' }).closest('form')!);
    expect(await screen.findByRole('dialog')).toHaveTextContent('ดาราทดลอง');
    expect(screen.getByRole('dialog')).toHaveTextContent('37,360');
    expect(posts).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'กรุณายืนยันตัวตนเจ้าหน้าที่อีกครั้ง',
    );
    expect(posts[0]).toMatchObject({
      partnerId: 'partner',
      generationId: period.generationId,
      approvalId: period.approvalId,
      expectedStaffRevision: '1',
      scheduledAt: '2026-09-15T05:00:00.000Z',
    });
    expect(Object.keys(posts[0]).sort()).toEqual([
      'approvalId',
      'expectedStaffRevision',
      'generationId',
      'idempotencyKey',
      'partnerId',
      'scheduledAt',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
  });
});
