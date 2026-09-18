import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import type { MoneyValue } from '@/contracts/common';
import type { PeriodCoverageValue } from '@/contracts/coverage';
import { Overview } from '@/contracts/overview';
import {
  bangkokDate,
  earningsWeekRange,
  weeklyEarningsPoints,
} from '@/features/overview/weekly-earnings';
import { WeeklyEarningsChart } from '@/features/overview/WeeklyEarningsChart';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { TrendChart } from '@/shared/charts/TrendChart';
import { compactMoney } from '@/shared/charts/compact-money';
import { createQueryClient } from '@/shared/query/provider';
import { AccessLost } from '@/shared/query/revision-watcher';
import { overviewFixture } from '../../dev/overview-transport';
import type { OverviewTransport } from '@/features/overview/model';

const money = (minor: string): MoneyValue => ({ currency: 'THB', minor });
const period = (from: string, toExclusive: string) => ({
  from,
  toExclusive,
  timezone: 'Asia/Bangkok' as const,
});
const augustWeek = { from: '2026-08-25', toExclusive: '2026-09-01' };
const complete: PeriodCoverageValue = {
  status: 'complete',
  periods: [period('2026-08-01T00:00:00+07:00', '2026-09-01T00:00:00+07:00')],
};
const scope = {
  userId: 'week-user',
  partnerId: 'week-partner',
  permissionRevision: '1',
  scenario: 'test-extra-scope',
};
let plotWidth = 198;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
  plotWidth = 198;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: plotWidth } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>
);
function response(filters: Parameters<OverviewTransport>[0]['filters'], minor = '10000') {
  const data = overviewFixture(filters, 'empty');
  data.earnings.confirmed = money(minor);
  data.earnings.channelBreakdown = null;
  data.earnings.contentCount = 1;
  data.earnings.trend = [{ date: filters.from, amount: money(minor) }];
  return Overview.parse(data);
}
const chartDates = (host: HTMLElement) =>
  [...host.querySelectorAll('text[data-date]')].map((el) => el.getAttribute('data-date'));

describe('Bangkok calendar and authoritative daily coverage', () => {
  it('anchors the latest seven days to Bangkok today, including the UTC day boundary', () => {
    expect(bangkokDate(new Date('2026-09-16T16:59:59Z'))).toBe('2026-09-16');
    expect(bangkokDate(new Date('2026-09-16T17:00:00Z'))).toBe('2026-09-17');
    expect(earningsWeekRange('2026-09-16', 0)).toMatchObject({
      from: '2026-09-10',
      toExclusive: '2026-09-17',
      hasNext: false,
    });
    expect(earningsWeekRange('2026-09-16', 1)).toMatchObject({
      from: '2026-09-03',
      toExclusive: '2026-09-10',
      hasNext: true,
    });
  });
  it('fills absent buckets only for fully published days without mutating source data', () => {
    const earnings = {
      trend: [{ date: '2026-08-28', amount: money('1280000') }],
      coverage: complete,
    };
    const before = structuredClone(earnings);
    const points = weeklyEarningsPoints(earnings, augustWeek);
    expect(points.map((p) => p.date)).toEqual([
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
    ]);
    expect(points.map((p) => p.amount?.minor)).toEqual(['0', '0', '0', '1280000', '0', '0', '0']);
    expect(earnings).toEqual(before);
  });
  it('keeps partial-day gaps unknown, including sub-millisecond boundaries, and retains supplied partial amounts', () => {
    const coverage: PeriodCoverageValue = {
      status: 'partial',
      periods: [
        period('2026-08-25T12:00:00+07:00', '2026-08-27T00:00:00+07:00'),
        period('2026-08-28T00:00:00+07:00', '2026-08-30T12:00:00+07:00'),
        period('2026-08-31T00:00:00.0001+07:00', '2026-09-01T00:00:00+07:00'),
      ],
    };
    expect(
      weeklyEarningsPoints(
        { coverage, trend: [{ date: '2026-08-30', amount: money('-501') }] },
        augustWeek,
      ).map((p) => p.amount?.minor ?? null),
    ).toEqual([null, '0', null, '0', '0', '-501', null]);
  });
  it('handles leap/year boundaries and the supported calendar floor without inventing a history limit', () => {
    expect(earningsWeekRange('2027-01-03', 0)).toMatchObject({
      from: '2026-12-28',
      toExclusive: '2027-01-04',
    });
    expect(earningsWeekRange('2024-03-02', 0)).toMatchObject({
      from: '2024-02-25',
      toExclusive: '2024-03-03',
    });
    expect(earningsWeekRange('0001-01-01', 999999)).toMatchObject({
      from: '0001-01-01',
      toExclusive: '0001-01-02',
      hasPrevious: false,
    });
    expect(
      weeklyEarningsPoints(
        { trend: [], coverage: { status: 'unavailable', periods: [] } },
        augustWeek,
      ).every((p) => p.amount === null),
    ).toBe(true);
  });
});

describe('independent weekly Overview query', () => {
  it('uses today and preserves the entire scope while global report totals retain their selected range', async () => {
    const send = vi.fn<OverviewTransport>(async ({ filters }) =>
      filters.from === '2026-07-01' ? overviewFixture(filters) : response(filters),
    );
    const view = render(wrap(<OverviewPage scope={scope} transport={send} brands={[]} />));
    await screen.findAllByText('฿37,360');
    await screen.findByText('2026-09-10: ฿100.00');
    expect(send.mock.calls.map(([request]) => request.filters)).toEqual(
      expect.arrayContaining([
        { from: '2026-07-01', toExclusive: '2026-09-01', brand: null },
        { from: '2026-09-10', toExclusive: '2026-09-17', brand: null },
      ]),
    );
    expect(send.mock.calls.every(([request]) => request.scope === scope)).toBe(true);
    const card = screen.getByRole('heading', { name: 'Daily Clip Earnings' }).closest('article')!;
    expect(within(card).getByText('1 คลิปที่สร้างรายได้')).toBeVisible();
    expect(within(card).queryByText('6 คลิปที่สร้างรายได้')).toBeNull();
    expect(chartDates(view.container)).toHaveLength(7);
    const details = within(card).getByText('ดูตัวเลขรายวัน').closest('details')!;
    details.open = true;
    expect(within(details).getByText('฿100')).toBeVisible();
    expect(within(details).queryByText('฿12,800')).toBeNull();
  });
  it('pages prior weeks and resets on a Bangkok midnight focus refresh, never fetching a future week', async () => {
    const send = vi.fn<OverviewTransport>(async ({ filters }) => response(filters));
    const view = render(wrap(<WeeklyEarningsChart scope={scope} transport={send} brand={null} />));
    await screen.findByText('2026-09-10: ฿100.00');
    expect(screen.getByRole('button', { name: '7 วันถัดไป' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '7 วันก่อนหน้า' }));
    await screen.findByText('2026-09-03: ฿100.00');
    expect(chartDates(view.container)).toEqual([
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
    vi.setSystemTime(new Date('2026-09-16T17:00:01Z'));
    fireEvent.focus(window);
    await screen.findByText('2026-09-11: ฿100.00');
    expect(screen.getByRole('button', { name: '7 วันถัดไป' })).toBeDisabled();
    expect(send.mock.calls.at(-1)![0].filters).toEqual({
      from: '2026-09-11',
      toExclusive: '2026-09-18',
      brand: null,
    });
  });
  it('does not allow a late response for an older window to overwrite the visible week', async () => {
    let finish!: (value: unknown) => void;
    const send = vi.fn<OverviewTransport>(({ filters }) =>
      filters.from === '2026-09-10'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(response(filters)),
    );
    render(wrap(<WeeklyEarningsChart scope={scope} transport={send} brand={null} />));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '7 วันก่อนหน้า' }));
    await screen.findByText('2026-09-03: ฿100.00');
    await act(async () =>
      finish(response({ from: '2026-09-10', toExclusive: '2026-09-17', brand: null }, '77700')),
    );
    expect(screen.queryByText('777')).toBeNull();
    expect(screen.getByText('2026-09-03: ฿100.00')).toBeInTheDocument();
  });
  it('has local error/retry and unavailable gaps, and removes cached weekly money after AccessLost', async () => {
    const send = vi
      .fn<OverviewTransport>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async ({ filters }) => response(filters))
      .mockRejectedValueOnce(new AccessLost('revoked'));
    const client = createQueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <WeeklyEarningsChart scope={scope} transport={send} brand={null} />
      </QueryClientProvider>,
    );
    await screen.findByText('โหลดคอมมิชชันรายวันไม่สำเร็จ');
    expect(chartDates(view.container)).toHaveLength(7);
    expect(view.container.querySelectorAll('svg[role="img"] circle')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    await screen.findByText('2026-09-10: ฿100.00');
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(await screen.findByRole('link', { name: 'ไปหน้าเข้าสู่ระบบ' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByText('2026-09-10: ฿100.00')).toBeNull();
    expect(view.container.querySelector('svg[role="img"]')).toBeNull();
  });
  it('renders unavailable authoritative weekly coverage as dates/gaps, not zero', async () => {
    const view = render(
      wrap(
        <WeeklyEarningsChart
          scope={scope}
          brand={null}
          transport={async ({ filters }) => overviewFixture(filters, 'unavailable')}
        />,
      ),
    );
    await screen.findByText('ยังไม่มีข้อมูลคอมมิชชันรายวัน');
    expect(chartDates(view.container)).toHaveLength(7);
    expect(view.container.querySelectorAll('svg[role="img"] circle')).toHaveLength(0);
    expect(screen.queryByText('0')).toBeNull();
  });
  it('does not read a server timezone date or start weekly requests during server rendering', () => {
    const send = vi.fn<OverviewTransport>();
    const html = renderToString(
      wrap(<WeeklyEarningsChart scope={scope} brand={null} transport={send} />),
    );
    expect(html).toContain('กำลังโหลดคอมมิชชันรายวัน');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('responsive weekly chart', () => {
  const points = () =>
    weeklyEarningsPoints(
      { coverage: complete, trend: [{ date: '2026-08-28', amount: money('1280000') }] },
      augustWeek,
    );
  it.each([198, 301, 360, 440])(
    'fits seven readable dates and centered compact badges at %spx with exact titles',
    (width) => {
      plotWidth = width;
      const view = render(<TrendChart points={points()} compactAmounts showEveryDate />);
      expect(screen.getByRole('img')).toHaveStyle({ width: `${width}px` });
      expect(chartDates(view.container)).toHaveLength(7);
      expect(screen.getAllByText('Aug')).toHaveLength(7);
      expect(screen.getByLabelText('28 August 2026')).toBeInTheDocument();
      expect(screen.getByText('12.8k')).toBeVisible();
      expect(screen.getByText('2026-08-28: ฿12,800.00')).toBeInTheDocument();
      const badges = [...view.container.querySelectorAll('[data-trend-point] rect')].map(
        (rect) => ({
          x: Number(rect.getAttribute('x')),
          y: Number(rect.getAttribute('y')),
          width: Number(rect.getAttribute('width')),
          height: Number(rect.getAttribute('height')),
        }),
      );
      for (const [i, badge] of badges.entries()) {
        expect(badge.x).toBeGreaterThanOrEqual(0);
        expect(badge.x + badge.width).toBeLessThanOrEqual(width);
        expect(badge.height).toBe(width === 198 ? 21 : width <= 320 ? 22 : width <= 400 ? 23 : 24);
        for (const other of badges.slice(i + 1))
          expect(
            badge.x + badge.width <= other.x ||
              other.x + other.width <= badge.x ||
              badge.y + badge.height <= other.y ||
              other.y + other.height <= badge.y,
          ).toBe(true);
      }
      for (const point of view.container.querySelectorAll('circle')) {
        const group = point.parentElement!;
        const badge = group.querySelector('rect')!;
        const leader = group.querySelector('line')!;
        const center = Number(point.getAttribute('cx'));
        expect(
          Number(badge.getAttribute('x')) + Number(badge.getAttribute('width')) / 2,
        ).toBeCloseTo(center);
        expect(Number(leader.getAttribute('x1'))).toBe(center);
        expect(Number(leader.getAttribute('x2'))).toBe(center);
        expect(
          Number(point.getAttribute('cy')) -
            Number(badge.getAttribute('y')) -
            Number(badge.getAttribute('height')),
        ).toBeGreaterThanOrEqual(17);
      }
    },
  );
  it('stacks dense compact badges vertically without overlaps, clipped edges or angled leaders', () => {
    const dense = points().map((point) => ({ ...point, amount: money('1280000') }));
    const view = render(<TrendChart points={dense} compactAmounts showEveryDate />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveStyle({ width: '198px' });
    const badges = [...view.container.querySelectorAll('[data-trend-point] rect')].map((badge) => ({
      x: Number(badge.getAttribute('x')),
      y: Number(badge.getAttribute('y')),
      w: Number(badge.getAttribute('width')),
      h: Number(badge.getAttribute('height')),
    }));
    expect(new Set(badges.map((badge) => badge.y)).size).toBeGreaterThan(1);
    for (const [index, badge] of badges.entries()) {
      expect(badge.x).toBeGreaterThanOrEqual(0);
      expect(badge.x + badge.w).toBeLessThanOrEqual(198);
      for (const other of badges.slice(index + 1)) {
        expect(
          badge.x + badge.w <= other.x ||
            other.x + other.w <= badge.x ||
            badge.y + badge.h <= other.y ||
            other.y + other.h <= badge.y,
        ).toBe(true);
      }
    }
    for (const leader of view.container.querySelectorAll('line[stroke-opacity]')) {
      expect(leader.getAttribute('x1')).toBe(leader.getAttribute('x2'));
    }
    expect(chartDates(view.container)).toHaveLength(7);
  });
  it.each(['0', '1280000', '-501'])(
    'uses nondegenerate paint coordinates for a flat %s line',
    (minor) => {
      const view = render(
        <TrendChart
          points={points().map((point) => ({ ...point, amount: money(minor) }))}
          compactAmounts
          showEveryDate
        />,
      );
      const path = view.container.querySelector('path[fill="none"]')!;
      expect(path.getAttribute('d')?.match(/C/g)).toHaveLength(6);
      const dots = [...view.container.querySelectorAll('circle')];
      expect(new Set(dots.map((dot) => dot.getAttribute('cy'))).size).toBe(1);
      const gradientId = path.getAttribute('stroke')!.slice(5, -1);
      const gradient = view.container.querySelector('[id="' + gradientId + '"]')!;
      expect(gradient).toHaveAttribute('gradientUnits', 'userSpaceOnUse');
      expect(Number(gradient.getAttribute('x2'))).toBeGreaterThan(
        Number(gradient.getAttribute('x1')),
      );
    },
  );
  it.each([198, 214, 301])(
    'fits signed and extreme accepted amounts at %spx without losing seven dates or exact values',
    (width) => {
      plotWidth = width;
      const amounts = [
        '-99999',
        '900719925474099301',
        '9999999999999999999999999999999999999999',
        '-999999999999999999999999999999999999999',
        '1280000',
        '0',
        '-1280000',
      ];
      const view = render(
        <TrendChart
          points={points().map((point, i) => ({ ...point, amount: money(amounts[i]) }))}
          compactAmounts
          showEveryDate
        />,
      );
      expect(screen.getByRole('img')).toHaveStyle({ width: width + 'px' });
      expect(screen.getByRole('region')).not.toHaveAttribute('tabindex');
      expect(chartDates(view.container)).toHaveLength(7);
      expect(view.container.querySelectorAll('circle title')).toHaveLength(7);
      expect(view.container.textContent).toContain('9,007,199,254,740,993.01');
      const badges = [...view.container.querySelectorAll('[data-trend-point] rect')].map(
        (rect) => ({
          x: Number(rect.getAttribute('x')),
          y: Number(rect.getAttribute('y')),
          w: Number(rect.getAttribute('width')),
          h: Number(rect.getAttribute('height')),
        }),
      );
      for (const [i, badge] of badges.entries()) {
        expect(badge.x).toBeGreaterThanOrEqual(0);
        expect(badge.x + badge.w).toBeLessThanOrEqual(width);
        for (const other of badges.slice(i + 1))
          expect(
            badge.x + badge.w <= other.x ||
              other.x + other.w <= badge.x ||
              badge.y + badge.h <= other.y ||
              other.y + other.h <= badge.y,
          ).toBe(true);
      }
      for (const leader of view.container.querySelectorAll('line[stroke-opacity]'))
        expect(leader.getAttribute('x1')).toBe(leader.getAttribute('x2'));
    },
  );
  it('uses exact full amounts and one-line dates on a wide plot', () => {
    plotWidth = 680;
    const view = render(<TrendChart points={points()} compactAmounts showEveryDate />);
    expect(screen.getByText('฿12,800')).toBeVisible();
    expect(screen.queryByText('12.8k')).toBeNull();
    expect(screen.getByText('28 Aug')).toBeVisible();
    expect(chartDates(view.container)).toHaveLength(7);
    expect(
      [...view.container.querySelectorAll('[data-trend-point] rect')].every(
        (rect) => rect.getAttribute('height') === '28',
      ),
    ).toBe(true);
  });
  it('does not connect a curve through unknown days or render zero points for them', () => {
    const view = render(
      <TrendChart
        compactAmounts
        showEveryDate
        points={[
          { date: '2026-08-01', amount: money('10000') },
          { date: '2026-08-02', amount: null },
          { date: '2026-08-03', amount: money('-501') },
        ]}
      />,
    );
    expect(view.container.querySelectorAll('circle')).toHaveLength(2);
    const curves = [...view.container.querySelectorAll('path[fill="none"]')];
    expect(curves).toHaveLength(2);
    expect(curves.every((p) => !p.getAttribute('d')?.includes('C'))).toBe(true);
    expect(screen.getByText('2026-08-02: ยังไม่มีข้อมูล')).toBeInTheDocument();
  });
  it('retains original exact-label and mobile-axis defaults for unrelated callers', () => {
    const view = render(<TrendChart points={points()} />);
    expect(screen.getByText('฿12,800')).toBeVisible();
    expect(chartDates(view.container)).toHaveLength(2);
    expect(screen.getByText('• คอมมิชชันรายวัน')).toBeVisible();
  });
  it.each([
    ['1280000', '12.8k'],
    ['186000', '1.9k'],
    ['0', '0'],
    ['-1', '-0.01'],
    ['-1280000', '-12.8k'],
    ['99995000', '1m'],
    ['99994999', '999.9k'],
    ['99995000000', '1b'],
    ['900719925474099301', '9007199.3b'],
  ])('abbreviates %s as %s using BigInt', (minor, label) => {
    expect(compactMoney(minor)).toBe(label);
  });
});

it('starts report and weekly reads together, then reveals both in one render without a second loading phase', async () => {
  const requests = new Map<
    string,
    { resolve: (data: unknown) => void; filters: Parameters<OverviewTransport>[0]['filters'] }
  >();
  const transport = vi.fn<OverviewTransport>(
    (request) =>
      new Promise((resolve) => {
        requests.set(request.filters.from, { resolve, filters: request.filters });
      }),
  );
  render(wrap(<OverviewPage scope={scope} transport={transport} brands={[]} />));
  await waitFor(() => expect(requests.size).toBe(2));
  expect(requests.has('2026-07-01')).toBe(true);
  expect(requests.has('2026-09-10')).toBe(true);
  await act(async () => {
    const report = requests.get('2026-07-01')!;
    report.resolve(overviewFixture(report.filters));
  });
  expect(screen.queryByRole('heading', { name: 'Clip Driven Sales' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Daily Clip Earnings' })).toBeNull();
  await act(async () => {
    const weekly = requests.get('2026-09-10')!;
    weekly.resolve(response(weekly.filters));
  });
  expect(await screen.findByRole('heading', { name: 'Clip Driven Sales' })).toBeVisible();
  expect(screen.getByRole('img', { name: 'คอมมิชชันตามวันที่เกิดรายได้' })).toBeVisible();
  expect(screen.queryByText('กำลังโหลดคอมมิชชันรายวัน')).toBeNull();
  expect(transport).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '7 วันก่อนหน้า' }));
  await waitFor(() => expect(requests.has('2026-09-03')).toBe(true));
  expect(screen.getByRole('heading', { name: 'Clip Driven Sales' })).toBeVisible();
  expect(screen.getByText('กำลังโหลดคอมมิชชันรายวัน')).toBeVisible();
  await act(async () => {
    const weekly = requests.get('2026-09-03')!;
    weekly.resolve(response(weekly.filters));
  });
  expect(await screen.findByText('2026-09-03: ฿100.00')).toBeInTheDocument();
});

it('releases the initial page if the independent weekly read fails', async () => {
  const transport = vi.fn<OverviewTransport>(async ({ filters }) => {
    if (filters.from !== '2026-07-01') throw new Error('weekly offline');
    return overviewFixture(filters);
  });
  render(wrap(<OverviewPage scope={scope} transport={transport} brands={[]} />));
  expect(await screen.findByRole('heading', { name: 'Clip Driven Sales' })).toBeVisible();
  expect(screen.getByText('โหลดคอมมิชชันรายวันไม่สำเร็จ')).toBeVisible();
  expect(screen.queryByText('กำลังโหลดข้อมูล')).toBeNull();
});
