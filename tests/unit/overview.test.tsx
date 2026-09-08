import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Overview } from '@/contracts/overview';
import { overviewFixture } from '../../dev/overview-transport';
import {
  defaultOverviewFilters as filters,
  loadOverview,
  earningsHref,
  obligationHref,
} from '@/features/overview/model';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { OverviewPreview } from '../../dev/OverviewPreview';
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());
const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
const renderPage = (transport: Parameters<typeof OverviewPage>[0]['transport']) =>
  render(
    <ScopedQueryProvider scope={scope}>
      <OverviewPage scope={scope} transport={transport} brands={['Axtion', 'Tendrix']} />
    </ScopedQueryProvider>,
  );
describe('Overview contract and snapshot semantics', () => {
  it('optional payout period preserves older wire compatibility', () => {
    const data = overviewFixture(filters);
    const { period, ...old } = data.obligation.nextPayout!;
    expect(
      Overview.parse({ ...data, obligation: { ...data.obligation, nextPayout: old } }).obligation
        .nextPayout?.period,
    ).toBeNull();
  });
  it('filters earnings at source and preserves obligation; earned date differs from publication', () => {
    const all = overviewFixture(filters);
    const axtion = overviewFixture({ ...filters, brand: 'Axtion' });
    expect(all.earnings.confirmed.minor).toBe('3736000');
    expect(axtion.earnings.confirmed.minor).toBe('1592000');
    expect(axtion.earnings.eligibleSales.minor).toBe('15920000');
    expect(axtion.obligation).toEqual(all.obligation);
    expect(all.earnings.trend.at(-1)?.date).toBe('2026-08-30');
    expect(all.earnings.topContent[0].publishedAt.slice(0, 10)).toBe('2026-08-28');
    expect(all.earnings.trend.reduce((s, p) => s + BigInt(p.amount.minor), 0n)).toBe(3736000n);
  });
  it('partial assigned + unassigned reconciles and adjustments do not rewrite issued payouts', () => {
    const partial = overviewFixture({ ...filters, brand: 'Axtion' }, 'partial');
    expect(partial.earnings.unassignedAmount.minor).toBe('1280000');
    expect(
      partial.earnings.topContent.reduce((s, c) => s + BigInt(c.earned!.minor), 0n) +
        BigInt(partial.earnings.unassignedAmount.minor),
    ).toBe(1592000n);
    const adjusted = overviewFixture(filters, 'adjustments');
    expect(adjusted.earnings.confirmed.minor).toBe('3536000');
    expect(adjusted.obligation.confirmedUnpaid.minor).toBe('2552000');
  });
  it('new payment changes obligation as-of without changing earnings generation or producing generation conflict', () => {
    const before = overviewFixture(filters);
    const after = overviewFixture(filters, 'ready', true);
    expect(after.earnings).toEqual(before.earnings);
    expect(after.obligation.confirmedUnpaid.minor).toBe('1552000');
    expect(obligationHref(after)).not.toContain('generation');
    expect(obligationHref(after)).not.toEqual(obligationHref(before));
    expect(earningsHref('/content', before, filters)).toContain('generation=1');
    expect(earningsHref('/content', before, filters)).not.toContain('obligationAsOf');
  });
  it('rejects a response for the wrong window', async () => {
    await expect(
      loadOverview(async () => overviewFixture(filters), {
        scope,
        filters: { ...filters, from: '2026-08-01' },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Mismatched response period');
  });
});
describe('Overview loading, errors and exact display', () => {
  it('a payment during the initial request cancels the older in-flight balance', async () => {
    render(<OverviewPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'จำลองบันทึกจ่าย 10,000 บาท' }));
    await waitFor(() => expect(screen.getAllByText('฿15,520')).toHaveLength(2));
    expect(screen.queryByText('฿25,520')).toBeNull();
  });
  it('retains the last response with an explicit stale warning when refresh fails', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(overviewFixture(filters))
      .mockRejectedValue(new Error('down'));
    renderPage(transport);
    await screen.findByText('฿37,360');
    fireEvent.click(screen.getByRole('button', { name: 'อัปเดตข้อมูลภาพรวม' }));
    expect(await screen.findByText('อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลครั้งล่าสุด')).toBeVisible();
    expect(screen.getByText('฿37,360')).toBeVisible();
    expect(screen.getByRole('button', { name: 'ลองอีกครั้ง' })).toBeVisible();
  });
  it('payment refresh uses the latest transport without resetting the selected brand', async () => {
    render(<OverviewPreview />);
    await screen.findByText('฿37,360');
    fireEvent.change(screen.getByLabelText('แบรนด์'), { target: { value: 'Axtion' } });
    await screen.findByText('฿15,920');
    fireEvent.click(screen.getByRole('button', { name: 'จำลองบันทึกจ่าย 10,000 บาท' }));
    await waitFor(() => expect(screen.getAllByText('฿15,520')).toHaveLength(2));
    expect(screen.getByLabelText('แบรนด์')).toHaveValue('Axtion');
    expect(screen.getByText('฿15,920')).toBeVisible();
    expect(overviewFixture(filters, 'empty', true).obligation.confirmedUnpaid.minor).toBe('0');
  });
  it('shows loading then exact confirmed and estimated values from the same response', async () => {
    let finish!: (v: unknown) => void;
    renderPage(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดข้อมูล');
    const data = overviewFixture(filters);
    data.earnings.estimated.minor = '900719925474099301';
    finish(data);
    expect(await screen.findByText('฿9,007,199,254,740,993.01')).toBeVisible();
    expect(screen.getByText('฿37,360')).toBeVisible();
  });
  it('retries a failed first response and unavailable never presents old amounts as zero', async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(overviewFixture(filters, 'unavailable'));
    renderPage(transport);
    fireEvent.click(await screen.findByRole('button', { name: 'ลองอีกครั้ง' }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('ต้นทางยังไม่พร้อมให้ข้อมูล')).toBeVisible();
    expect(screen.queryByText('฿37,360')).toBeNull();
    expect(screen.queryByText('฿0')).toBeNull();
  });
  it('invalid date never sends a request and late filtered replies cannot replace the current view', async () => {
    const pending = new Map<string, (v: unknown) => void>();
    const transport = vi.fn(
      ({ filters: f }: { filters: typeof filters }) =>
        new Promise((resolve) => pending.set(f.brand ?? 'all', resolve)),
    );
    renderPage(transport);
    await waitFor(() => expect(pending.has('all')).toBe(true));
    fireEvent.change(screen.getByLabelText('แบรนด์'), { target: { value: 'Axtion' } });
    await waitFor(() => expect(pending.has('Axtion')).toBe(true));
    pending.get('Axtion')!(overviewFixture({ ...filters, brand: 'Axtion' }));
    expect(await screen.findByText('฿15,920')).toBeVisible();
    pending.get('all')!(overviewFixture(filters));
    await waitFor(() => expect(screen.queryByText('฿37,360')).toBeNull());
    fireEvent.change(screen.getByLabelText('เริ่มวันที่'), { target: { value: '2026-09-02' } });
    expect(screen.getByRole('alert')).toHaveTextContent('เลือกช่วงวันที่');
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
