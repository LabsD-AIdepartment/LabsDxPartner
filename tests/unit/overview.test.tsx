import { beforeEach as featureBeforeEach, afterEach as featureAfterEach } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Overview } from '@/contracts/overview';
import { overviewFixture } from '../../dev/overview-transport';
import {
  defaultOverviewFilters as filters,
  loadOverview,
  earningsHref,
  obligationHref,
} from '@/features/overview/model';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { ScopedQueryProvider, createQueryClient } from '@/shared/query/provider';
import { OverviewPreview } from '../../dev/OverviewPreview';
import { TrendChart } from '@/shared/charts/TrendChart';
import { AccessLost } from '@/shared/query/revision-watcher';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
beforeEach(() => window.history.replaceState({}, '', '/?devtools=1'));
afterEach(() => vi.unstubAllGlobals());
const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
const renderPage = (transport: Parameters<typeof OverviewPage>[0]['transport']) => {
  const client = createQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <OverviewPage scope={scope} transport={transport} brands={['Axtion', 'Tendrix']} />
    </QueryClientProvider>,
  );
  return { ...view, client };
};
describe('Overview contract and snapshot semantics', () => {
  it('brand and channel projections reconcile with the selected earnings snapshot', () => {
    for (const name of ['ready', 'partial', 'adjustments', 'empty'] as const) {
      const data = overviewFixture(filters, name);
      expect(
        data.earnings.salesByBrand!.reduce((n, b) => n + BigInt(b.value.minor), 0n).toString(),
      ).toBe(data.earnings.eligibleSales!.minor);
      const channels = data.earnings.channelBreakdown!;
      expect(
        (
          BigInt(channels.organic.minor) +
          BigInt(channels.brandAds.minor) +
          BigInt(channels.other.minor)
        ).toString(),
      ).toBe(data.earnings.confirmed!.minor);
    }
  });
  it('old payloads retain visual slots without inventing missing breakdowns', async () => {
    const current = overviewFixture(filters);
    const { salesByBrand, channelBreakdown, contentCount, ...oldEarnings } = current.earnings;
    const old = Overview.parse({ ...current, earnings: oldEarnings });
    expect(old.earnings.channelBreakdown).toBeNull();
    renderPage(async () => old);
    expect(await screen.findByRole('heading', { name: 'Earnings Mix' })).toBeVisible();
    expect(screen.queryByText('ยังไม่ระบุแพลตฟอร์ม')).toBeNull();
    expect(screen.queryByRole('img', { name: /ไม่ระบุแพลตฟอร์ม:/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Earnings Mix' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'โปรไฟล์และคอมมิชชัน' })).toBeVisible();
    expect(screen.queryByText('80%')).toBeNull();
  });
  it('preserves approved portrait, bar chart, earning mix and six-card composition', async () => {
    render(<OverviewPreview />);
    await screen.findAllByText('฿37,360');
    expect(screen.getByRole('img', { name: 'ภาพโปรไฟล์ มดดำ คชาภา' })).toHaveAttribute(
      'src',
      '/media/celebrity-thumbnail.png',
    );
    expect(screen.getByRole('img', { name: /Facebook:/ })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Organic 80%' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });
  it('updates a selected date range automatically and keeps the toolbar free of refresh/reset controls', async () => {
    render(<OverviewPreview />);
    await screen.findAllByText('฿37,360');
    expect(
      screen.queryByText('ทุกคอนเทนต์มีคุณค่า ติดตามผลงานและรายได้ของคุณได้ที่เดียว'),
    ).toBeNull();
    expect(screen.queryByText(/^ข้อมูลรายได้ถึง/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'อัปเดตข้อมูลภาพรวม' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'รีเซ็ตตัวกรอง' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeVisible();
    const titleRow = screen.getByRole('heading', { level: 1 }).parentElement!;
    expect(titleRow).toContainElement(screen.getByRole('button', { name: 'Export report' }));
    expect(titleRow).toContainElement(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.click(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'เดือน 1' }), {
      target: { value: '08' },
    });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' })).getByRole('button', {
        name: '2026-08-29',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    await waitFor(() => expect(screen.queryByText('฿37,360')).toBeNull());
    await screen.findAllByText('฿12,800');
    expect(screen.getAllByText('฿25,520')).toHaveLength(2);
  });
  it('a late response for a previous date range cannot overwrite the selected range', async () => {
    let finishOld!: (value: unknown) => void;
    const transport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementation(async ({ filters: selected }) => overviewFixture(selected));
    renderPage(transport);
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'เดือน 1' }), {
      target: { value: '08' },
    });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' })).getByRole('button', {
        name: '2026-08-29',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    await screen.findAllByText('฿12,800');
    await act(async () => {
      finishOld(overviewFixture(filters));
    });
    expect(screen.queryByText('฿37,360')).toBeNull();
    expect(screen.getByRole('button', { name: 'เลือกช่วงวันที่' })).toHaveAttribute(
      'title',
      '2026-08-29 – 2026-08-31',
    );
  });
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
    expect(all.earnings.confirmed!.minor).toBe('3736000');
    expect(all.earnings.eligibleSales!.minor).toBe('55000000');
    expect(all.earnings.channelBreakdown?.organicRatePpm).toBe(100000);
    expect(all.earnings.channelBreakdown?.brandAdsRatePpm).toBe(30000);
    expect(axtion.earnings.confirmed!.minor).toBe('1592000');
    expect(axtion.earnings.eligibleSales!.minor).toBe('23200000');
    expect(axtion.obligation).toEqual(all.obligation);
    expect(all.earnings.trend.at(-1)?.date).toBe('2026-08-30');
    expect(all.earnings.topContent[0].publishedAt.slice(0, 10)).toBe('2026-08-28');
    expect(all.earnings.trend.reduce((s, p) => s + BigInt(p.amount.minor), 0n)).toBe(3736000n);
  });
  it('partial assigned + unassigned reconciles and adjustments do not rewrite issued payouts', () => {
    const partial = overviewFixture({ ...filters, brand: 'Axtion' }, 'partial');
    expect(partial.earnings.unassignedAmount!.minor).toBe('1280000');
    expect(
      partial.earnings.topContent.reduce((s, c) => s + BigInt(c.earned!.minor), 0n) +
        BigInt(partial.earnings.unassignedAmount!.minor),
    ).toBe(1592000n);
    const adjusted = overviewFixture(filters, 'adjustments');
    expect(adjusted.earnings.confirmed!.minor).toBe('3536000');
    expect(adjusted.obligation.confirmedUnpaid!.minor).toBe('2552000');
  });
  it('new payment changes obligation as-of without changing earnings generation or producing generation conflict', () => {
    const before = overviewFixture(filters);
    const after = overviewFixture(filters, 'ready', true);
    expect(after.earnings).toEqual(before.earnings);
    expect(after.obligation.confirmedUnpaid!.minor).toBe('1552000');
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
  it('uses the returned profile and brand options while retaining a selected brand absent from the next period', async () => {
    const data = overviewFixture(filters);
    data.profile = { ...celebrityCatalogue(scope.partnerId).profile, name: 'พาร์ทเนอร์จาก API' };
    data.brands = ['Axtion'];
    const transport = vi
      .fn()
      .mockResolvedValueOnce(data)
      .mockImplementation(async ({ filters: selected }) => ({
        ...overviewFixture(selected),
        profile: data.profile,
        brands: [],
      }));
    renderPage(transport);
    expect(
      await screen.findByRole('img', { name: 'ภาพโปรไฟล์ พาร์ทเนอร์จาก API' }),
    ).toHaveAttribute('src', data.profile.portrait);
    expect(screen.queryByRole('option', { name: 'Tendrix' })).toBeNull();
    fireEvent.change(screen.getByLabelText('แบรนด์'), { target: { value: 'Axtion' } });
    await screen.findByRole('option', { name: 'Axtion (ที่เลือก)' });
    expect(screen.getByLabelText('แบรนด์')).toHaveValue('Axtion');
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });
  it('removes previously loaded figures and profile after an access-denied refresh', async () => {
    const data = overviewFixture(filters);
    data.profile = celebrityCatalogue(scope.partnerId).profile;
    const transport = vi
      .fn()
      .mockResolvedValueOnce(data)
      .mockRejectedValue(new AccessLost('Revoked'));
    const { client } = renderPage(transport);
    await screen.findAllByText('฿37,360');
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(await screen.findByRole('link', { name: 'ไปหน้าเข้าสู่ระบบ' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByText('฿37,360')).toBeNull();
    expect(screen.queryByRole('img', { name: /ภาพโปรไฟล์/ })).toBeNull();
    expect(screen.queryByText('อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลครั้งล่าสุด')).toBeNull();
  });
  it('does not draw a continuous curve across an unpublished window', () => {
    const { container } = render(
      <TrendChart
        points={[
          { date: '2026-08-01', amount: { currency: 'THB', minor: '100' } },
          { date: '2026-08-02', amount: { currency: 'THB', minor: '200' } },
          { date: '2026-08-10', amount: { currency: 'THB', minor: '300' } },
        ]}
        coverage={{
          status: 'partial',
          periods: [
            {
              from: '2026-08-01T00:00:00+07:00',
              toExclusive: '2026-08-03T00:00:00+07:00',
              timezone: 'Asia/Bangkok',
            },
            {
              from: '2026-08-10T00:00:00+07:00',
              toExclusive: '2026-08-11T00:00:00+07:00',
              timezone: 'Asia/Bangkok',
            },
          ],
        }}
      />,
    );
    const curves = container.querySelectorAll('path[fill="none"]');
    expect(curves).toHaveLength(2);
    expect(curves[0].getAttribute('d')).toContain('C');
    expect(curves[1].getAttribute('d')).not.toContain('C');
    expect(container.querySelectorAll('circle')).toHaveLength(3);
  });
  it('keeps all six cards and approved portrait when published data is unavailable', async () => {
    render(<OverviewPreview />);
    fireEvent.change(screen.getByLabelText('สถานการณ์ภาพรวม'), {
      target: { value: 'unavailable' },
    });
    await screen.findByText('ต้นทางยังไม่พร้อมให้ข้อมูล');
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.getByRole('img', { name: 'ภาพโปรไฟล์ มดดำ คชาภา' })).toHaveAttribute(
      'src',
      '/media/celebrity-thumbnail.png',
    );
    expect(screen.queryByText('฿0')).toBeNull();
    expect(screen.queryByText('ยังไม่มีกำหนดจ่ายรอบถัดไป')).toBeNull();
    expect(screen.getByText('ยังไม่มีข้อมูลสถานะการจ่าย')).toBeVisible();
    expect(screen.queryByRole('img', { name: 'คอมมิชชันตามวันที่เกิดรายได้' })).toBeNull();
  });
  it('shows confirmed money without guessing an estimate', async () => {
    renderPage(async () => overviewFixture(filters, 'confirmed-only'));
    await screen.findAllByText('฿37,360');
    expect(screen.getByText('ยังไม่มีข้อมูลยอดประมาณการ')).toBeVisible();
    expect(screen.queryByText('฿0')).toBeNull();
    expect(screen.getByRole('img', { name: 'Organic 80%' })).toBeVisible();
  });
  it('discloses partial coverage and preserves independently known payout when selected earnings have no coverage', async () => {
    const source = overviewFixture(filters, 'partial-period');
    const { rerender } = renderPage(async () => source);
    await screen.findAllByText('฿21,440');
    expect(
      screen.getByText('ยอดนี้รวมเฉพาะช่วงที่เผยแพร่แล้ว ยังไม่ครบช่วงวันที่เลือก'),
    ).toBeVisible();
    expect(screen.getByText('ดูช่วงที่รวมในยอดนี้')).toBeVisible();
    const unknown = overviewFixture(filters, 'unavailable');
    unknown.dataState = 'partial';
    unknown.obligation = source.obligation;
    rerender(
      <ScopedQueryProvider scope={{ ...scope, partnerId: 'other' }}>
        <OverviewPage
          scope={{ ...scope, partnerId: 'other' }}
          transport={async ({ filters: requested }) =>
            requested.from === filters.from && requested.toExclusive === filters.toExclusive
              ? unknown
              : overviewFixture(requested, 'unavailable')
          }
          brands={[]}
        />
      </ScopedQueryProvider>,
    );
    await screen.findByText('ยังไม่มีข้อมูลคอมมิชชันรายวัน');
    expect(screen.getAllByText('฿25,520')).toHaveLength(2);
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });
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
    const { client } = renderPage(transport);
    (await screen.findAllByText('฿37,360'))[0];
    await act(async () => {
      await client.invalidateQueries();
    });
    const staleWarning = await screen.findByText('อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลครั้งล่าสุด');
    expect(staleWarning).toBeVisible();
    expect(screen.getAllByText('฿37,360')[0]).toBeVisible();
    expect(
      within(staleWarning.closest('[role="status"]')!).getByRole('button', { name: 'ลองอีกครั้ง' }),
    ).toBeVisible();
  });
  it('payment refresh uses the latest transport without resetting the selected brand', async () => {
    render(<OverviewPreview />);
    (await screen.findAllByText('฿37,360'))[0];
    fireEvent.change(screen.getByLabelText('แบรนด์'), { target: { value: 'Axtion' } });
    (await screen.findAllByText('฿15,920'))[0];
    fireEvent.click(screen.getByRole('button', { name: 'จำลองบันทึกจ่าย 10,000 บาท' }));
    await waitFor(() => expect(screen.getAllByText('฿15,520')).toHaveLength(2));
    expect(screen.getByLabelText('แบรนด์')).toHaveValue('Axtion');
    expect(screen.getAllByText('฿15,920')[0]).toBeVisible();
    expect(overviewFixture(filters, 'empty', true).obligation.confirmedUnpaid!.minor).toBe('0');
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
    data.earnings.estimated!.minor = '900719925474099301';
    finish(data);
    expect(await screen.findByText('฿9,007,199,254,740,993.01')).toBeVisible();
    expect(screen.getAllByText('฿37,360')[0]).toBeVisible();
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
    expect((await screen.findAllByText('฿15,920'))[0]).toBeVisible();
    pending.get('all')!(overviewFixture(filters));
    await waitFor(() => expect(screen.queryByText('฿37,360')).toBeNull());
    const sentBeforeInvalidRange = transport.mock.calls.length;
    expect(
      transport.mock.calls.filter(
        ([request]) =>
          request.filters.from === filters.from &&
          request.filters.toExclusive === filters.toExclusive,
      ),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.click(screen.getByRole('button', { name: /^ถึงวันที่/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'ปี 2' }), {
      target: { value: '2027' },
    });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินสิ้นสุด' })).getByRole('button', {
        name: '2027-08-02',
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('เลือกช่วงวันที่');
    expect(transport).toHaveBeenCalledTimes(sentBeforeInvalidRange);
  });
});

// The legacy brand workflows remain available behind the opt-in flag.
featureBeforeEach(() => vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true'));
featureAfterEach(() => vi.unstubAllEnvs());

featureBeforeEach(() => {
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
});
featureAfterEach(() => vi.restoreAllMocks());
