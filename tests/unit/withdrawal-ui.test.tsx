import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KnownBalanceSnapshotValue } from '@/contracts/withdrawal';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { defaultOverviewFilters } from '@/features/overview/model';
import {
  WithdrawalSummary,
  type WithdrawalSummaryData,
} from '@/features/withdrawals/WithdrawalSummary';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { formatMinor } from '@/shared/ui/format-money';
import { overviewFixture } from '../../dev/overview-transport';

const scope = {
  userId: 'SYNTH-ui-user',
  partnerId: 'SYNTH-ui-partner',
  permissionRevision: 'SYNTH-ui-permission-1',
};
const balanceScope = {
  partnerId: scope.partnerId,
  payerId: 'SYNTH-ui-payer',
  currency: 'THB' as const,
};
const money = (minor: string) => ({ currency: 'THB' as const, minor });
const balance: KnownBalanceSnapshotValue = {
  state: 'known',
  scope: balanceScope,
  revision: 'SYNTH-ui-balance-1',
  asOf: '2026-09-16T01:00:00Z',
  released: money('2500000'),
  settled: money('0'),
  reserved: money('500000'),
  held: money('0'),
  rawAvailable: money('2000000'),
  available: money('2000000'),
  deficit: money('0'),
};

function summary(overrides: Partial<WithdrawalSummaryData> = {}): WithdrawalSummaryData {
  return {
    balance,
    currentPeriodPending: money('700000'),
    currentPeriod: {
      periodId: 'SYNTH-ui-period-current',
      label: 'งวดปัจจุบันตัวอย่าง',
      from: '2026-09-01T00:00:00+07:00',
      toExclusive: '2026-10-01T00:00:00+07:00',
    },
    readiness: {
      context: {
        scope: balanceScope,
        asOf: balance.asOf,
        expectedBalanceRevision: balance.revision,
        expectedVersions: {
          payer: 'SYNTH-payer-1',
          releaseRule: 'SYNTH-release-1',
          taxPolicy: 'SYNTH-tax-1',
          beneficiary: 'SYNTH-beneficiary-1',
        },
      },
      prerequisites: {
        payer: { state: 'satisfied' },
        releaseRule: { state: 'satisfied' },
        taxPolicy: { state: 'satisfied' },
        beneficiary: { state: 'satisfied' },
      },
      balance: { state: 'satisfied' },
      requestGate: 'ready',
      blockingReasons: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Withdrawal summary presentation', () => {
  it('shows only the current known masked payout account on the full wallet card', () => {
    const beneficiary = {
      state: 'known' as const,
      displayName: 'SYNTH recipient',
      bankName: 'SYNTH bank',
      maskedAccount: 'XXX-X-X4321-0',
      version: 'SYNTH-beneficiary-1',
    };
    const view = render(<WithdrawalSummary data={summary({ beneficiary })} />);
    const account = screen.getByRole('region', { name: 'บัญชีรับเงินที่ผูกไว้' });
    expect(account).toHaveTextContent('SYNTH bank');
    expect(account).toHaveTextContent('XXX-X-X4321-0');
    view.rerender(<WithdrawalSummary data={summary({ beneficiary })} compact />);
    expect(screen.queryByRole('region', { name: 'บัญชีรับเงินที่ผูกไว้' })).toBeNull();
    view.rerender(<WithdrawalSummary data={summary({ beneficiary })} state="error" />);
    expect(screen.queryByText('XXX-X-X4321-0')).toBeNull();
    view.rerender(
      <WithdrawalSummary
        data={summary({
          beneficiary: {
            state: 'pending',
            version: 'SYNTH-beneficiary-2',
            reasons: ['ตรวจสอบบัญชี'],
          },
        })}
      />,
    );
    expect(screen.queryByText('XXX-X-X4321-0')).toBeNull();
    view.rerender(
      <WithdrawalSummary
        data={summary({
          beneficiary: {
            ...beneficiary,
            bankName: 'SYNTH new bank',
            maskedAccount: 'XXX-X-X9876-0',
            version: 'SYNTH-beneficiary-3',
          },
        })}
      />,
    );
    expect(screen.getByRole('region', { name: 'บัญชีรับเงินที่ผูกไว้' })).toHaveTextContent(
      'SYNTH new bank',
    );
    expect(screen.queryByText('XXX-X-X4321-0')).toBeNull();
  });

  it('distinguishes unknown history from a verified absence of successful withdrawals', () => {
    const view = render(<WithdrawalSummary data={summary()} />);
    expect(screen.getByLabelText('ยังไม่มีข้อมูลการถอนล่าสุด')).toHaveTextContent('—');
    expect(screen.queryByText('ยังไม่มีรายการถอนสำเร็จ')).toBeNull();
    view.rerender(<WithdrawalSummary data={summary({ lastWithdrawal: null })} />);
    expect(screen.getByText('ยังไม่มีรายการถอนสำเร็จ')).toBeVisible();
    expect(screen.queryByLabelText('ยังไม่มีข้อมูลการถอนล่าสุด')).toBeNull();
  });
  it('uses the last included Bangkok day in the Buddhist calendar and does not invent a missing cutoff', () => {
    const current = summary().currentPeriod!;
    const view = render(
      <WithdrawalSummary
        data={summary({ currentPeriod: { ...current, toExclusive: '2026-09-30T17:00:00Z' } })}
      />,
    );
    expect(screen.getByText('ยอดรอตัดรอบ 30-09-69')).toBeVisible();
    expect(screen.queryByText(current.label)).not.toBeInTheDocument();
    view.rerender(<WithdrawalSummary data={summary({ currentPeriod: null })} />);
    expect(screen.getByText('ยอดรอตัดรอบ')).toBeVisible();
    view.rerender(
      <WithdrawalSummary
        data={summary({ currentPeriod: { ...current, toExclusive: 'invalid' } })}
      />,
    );
    expect(screen.getByText('ยอดรอตัดรอบ')).toBeVisible();
  });

  it('shows available, current pending and the last successful net withdrawal separately', () => {
    const onClick = vi.fn();
    render(
      <WithdrawalSummary
        data={summary({
          lastWithdrawal: {
            requestRef: 'last-paid',
            net: money('485000'),
            paidAt: '2026-09-10T18:00:00Z',
          },
        })}
        action={{ kind: 'request', onClick }}
      />,
    );
    expect(screen.getByText('฿20,000')).toBeVisible();
    expect(screen.getByText('฿7,000')).toBeVisible();
    expect(screen.getByText('฿4,850')).toBeVisible();
    expect(screen.queryByText('฿5,000')).toBeNull();
    expect(screen.queryByText('฿27,000')).toBeNull();
    expect(screen.getByText('ยอดรอตัดรอบ 30-09-69')).toBeVisible();
    expect(screen.getByText('ถอนล่าสุด · 11 ก.ย. 2569')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ถอนเงิน' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('preserves unknown balances and pending amounts instead of inventing zero', () => {
    const ready = summary();
    const reason = 'ยังไม่มีข้อมูลยอดจากต้นทาง';
    render(
      <WithdrawalSummary
        data={summary({
          balance: {
            state: 'unavailable',
            scope: balanceScope,
            asOf: balance.asOf,
            reasons: [reason],
          },
          currentPeriodPending: null,
          readiness: {
            ...ready.readiness,
            requestGate: 'blocked',
            balance: { state: 'unavailable', reasons: [reason] },
            blockingReasons: [
              { prerequisite: 'balance', code: 'balance_unavailable', detail: reason },
            ],
          },
        })}
        action={{ kind: 'request', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByText(reason)).toBeVisible();
    expect(screen.getByText('ยังไม่มีข้อมูล')).toBeVisible();
    expect(screen.queryByText('฿0')).toBeNull();
    expect(screen.getByLabelText('ยังไม่มีข้อมูลยอดพร้อมถอน')).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeDisabled();
  });

  it('shows known zero as zero and distinguishes it from unknown', () => {
    const ready = summary();
    render(
      <WithdrawalSummary
        data={summary({
          balance: {
            ...balance,
            released: money('0'),
            reserved: money('0'),
            rawAvailable: money('0'),
            available: money('0'),
          },
          readiness: {
            ...ready.readiness,
            requestGate: 'blocked',
            balance: {
              state: 'blocked',
              code: 'balance_not_positive',
              detail: 'No available balance',
            },
            blockingReasons: [
              {
                prerequisite: 'balance',
                code: 'balance_not_positive',
                detail: 'No available balance',
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getAllByText('฿0')).toHaveLength(1);
    expect(screen.getByText('ยังไม่มียอดพร้อมถอนในขณะนี้')).toBeVisible();
    expect(screen.queryByText('ยังไม่มีข้อมูลยอดพร้อมถอน')).toBeNull();
  });

  it('does not block released balance when current-period pending is unknown', () => {
    render(
      <WithdrawalSummary
        data={summary({ currentPeriodPending: null })}
        action={{ kind: 'request', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByText('฿20,000')).toBeVisible();
    expect(screen.getByText('ยังไม่มีข้อมูล')).toBeVisible();
    expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeEnabled();
  });

  it('keeps supplied large and one-satang figures exact and displays a supplied deficit', () => {
    const huge = '900719925474099301';
    const { rerender } = render(
      <WithdrawalSummary
        data={summary({
          balance: {
            ...balance,
            released: money(huge),
            available: money(huge),
            rawAvailable: money(huge),
            reserved: money('0'),
          },
          currentPeriodPending: money('1'),
        })}
      />,
    );
    expect(screen.getByText('฿9,007,199,254,740,993.01')).toBeVisible();
    expect(screen.getByText('฿0.01')).toBeVisible();
    rerender(
      <WithdrawalSummary
        data={summary({
          balance: {
            ...balance,
            released: money('-100'),
            reserved: money('0'),
            rawAvailable: money('-100'),
            available: money('0'),
            deficit: money('100'),
          },
        })}
      />,
    );
    expect(screen.getByText('ยอดขาดดุล')).toBeVisible();
    expect(screen.getByText('฿1')).toBeVisible();
  });

  it('explains a blocked prerequisite without hiding the known balance', () => {
    const ready = summary();
    render(
      <WithdrawalSummary
        data={summary({
          readiness: {
            ...ready.readiness,
            prerequisites: { ...ready.readiness.prerequisites, taxPolicy: { state: 'unknown' } },
            requestGate: 'blocked',
            blockingReasons: [
              {
                prerequisite: 'taxPolicy',
                code: 'unknown',
                detail: 'approval is unknown for the current scope',
              },
            ],
          },
        })}
        action={{ kind: 'request', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByText('฿20,000')).toBeVisible();
    expect(screen.getByText('ข้อมูลภาษียังไม่พร้อม ต้องตรวจสอบข้อมูลก่อนถอน')).toBeVisible();
    expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeDisabled();
  });

  it('allows an explicitly supplied recovery action independently of the request gate', () => {
    const ready = summary();
    const onClick = vi.fn();
    const data = summary({ readiness: { ...ready.readiness, requestGate: 'blocked' } });
    const { rerender } = render(
      <WithdrawalSummary data={data} action={{ kind: 'recovery', onClick }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบคำขอ' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <WithdrawalSummary data={data} action={{ kind: 'recovery', onClick, disabled: true }} />,
    );
    expect(screen.getByRole('button', { name: 'ตรวจสอบคำขอ' })).toBeDisabled();
  });

  it('does not show old balances while loading or after a first-load error', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<WithdrawalSummary data={summary()} state="loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('กำลังตรวจสอบยอดพร้อมถอน');
    expect(screen.queryByText('฿20,000')).toBeNull();
    rerender(<WithdrawalSummary data={summary()} state="error" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดข้อมูลการถอนไม่สำเร็จ');
    expect(screen.queryByText('฿20,000')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('labels stale figures and blocks a new request until refreshed', () => {
    render(
      <WithdrawalSummary
        data={summary()}
        state="stale"
        action={{ kind: 'request', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByText('฿20,000')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('แสดงยอดครั้งล่าสุด');
    expect(screen.getByRole('button', { name: 'ถอนเงิน' })).toBeDisabled();
  });
});

describe('Overview payout integration seam', () => {
  const partner = {
    name: 'SYNTH partner',
    greeting: 'SYNTH partner',
    role: 'Celebrity partner',
    portrait: '/media/celebrity-thumbnail.png',
    avatar: '/media/celebrity-avatar.png',
  };

  function renderOverview(renderPayout?: Parameters<typeof OverviewPage>[0]['renderPayout']) {
    const data = overviewFixture(defaultOverviewFilters);
    render(
      <ScopedQueryProvider scope={scope}>
        <OverviewPage
          scope={scope}
          brands={['Axtion']}
          transport={async () => data}
          partner={partner}
          renderPayout={renderPayout}
        />
      </ScopedQueryProvider>,
    );
    return data;
  }

  it('keeps the original native payout, links, portrait and six-article composition by default', async () => {
    const data = renderOverview();
    const heading = await screen.findByRole('heading', { name: 'Your next payout' });
    const payout = heading.closest('article')!;
    expect(
      within(payout).getAllByText(formatMinor(data.obligation.confirmedUnpaid!.minor, true)).length,
    ).toBeGreaterThan(0);
    expect(within(payout).getByRole('link', { name: 'ดูรายการจ่ายทั้งหมด' })).toHaveAttribute(
      'href',
      expect.stringContaining('/transactions'),
    );
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.getByRole('img', { name: 'ภาพโปรไฟล์ SYNTH partner' })).toHaveAttribute(
      'src',
      '/media/celebrity-thumbnail.png',
    );
    expect(screen.queryByRole('heading', { name: 'ยอดพร้อมถอน' })).toBeNull();
  });

  it('replaces only the payout article and passes Overview-owned layout class to the injected card', async () => {
    const renderPayout = vi.fn((className: string) => (
      <WithdrawalSummary data={summary()} className={className} />
    ));
    renderOverview(renderPayout);
    await screen.findByRole('heading', { name: 'ยอดพร้อมถอน' });
    const payout = screen.getByRole('article', { name: 'สรุปยอดพร้อมถอน' });
    const layoutClass = renderPayout.mock.calls[0][0];
    expect(layoutClass).toBeTruthy();
    expect(payout).toHaveClass(layoutClass);
    expect(payout.parentElement!.querySelectorAll(':scope > article')).toHaveLength(4);
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.getByRole('img', { name: 'ภาพโปรไฟล์ SYNTH partner' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Clip Driven Sales' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Daily Clip Earnings' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Your next payout' })).toBeNull();
  });
});
