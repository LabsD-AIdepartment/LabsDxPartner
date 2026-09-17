import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { dateLabel } from '@/shared/ui/format-date';
import { DailyEarnings } from '@/features/overview/DailyEarnings';
const money = (minor: string) => ({ currency: 'THB' as const, minor });
let resize: (width: number) => void;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        resize = (width) =>
          this.callback(
            [{ target, contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        resize(931);
      }
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
function openDaily() {
  const summary = screen.getByText('ดูตัวเลขรายวัน');
  fireEvent.click(summary);
  expect(summary.closest('details')).toHaveAttribute('open');
}
function cells(table: HTMLElement, label: string) {
  const row = within(table).getByRole('rowheader', { name: label }).closest('tr')!;
  return within(row).getAllByRole('cell');
}

describe('daily confirmed sales tables', () => {
  it('keeps the native disclosure closed initially and omits an entirely unknown sales row', () => {
    render(<DailyEarnings points={[{ date: '2026-09-01', amount: money('12345') }]} />);
    const summary = screen.getByText('ดูตัวเลขรายวัน');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    summary.focus();
    expect(summary).toHaveFocus();
    openDaily();
    const table = screen.getByRole('table');
    expect(
      within(table).getByRole('columnheader', { name: dateLabel('2026-09-01T00:00:00+07:00') }),
    ).toBeVisible();
    expect(within(table).queryByRole('rowheader', { name: 'ยอดขายที่ยืนยันแล้ว' })).toBeNull();
    expect(cells(table, 'คอมมิชชัน')[0]).toHaveTextContent('฿123.45');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(1);
    expect(screen.queryByText('฿0')).toBeNull();
  });
  it('aligns supplied dates and exact metric rows, with only supplied platforms and no invented missing zeros', () => {
    render(
      <DailyEarnings
        points={[
          {
            date: '2026-08-31',
            amount: money('0'),
            sales: money('0'),
            salesByPlatform: [{ platform: 'facebook', sales: money('0') }],
          },
          {
            date: '2026-09-01',
            amount: money('-101'),
            sales: money('-1001'),
            salesByPlatform: [{ platform: 'web', sales: money('-1001') }],
          },
          {
            date: '2026-09-02',
            amount: money('99'),
            sales: money('900719925474099301'),
            salesByPlatform: null,
          },
        ]}
      />,
    );
    openDaily();
    const table = screen.getByRole('table');
    expect(
      [...table.querySelectorAll('thead time')].map((time) => time.getAttribute('datetime')),
    ).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(cells(table, 'คอมมิชชัน').map((cell) => cell.textContent)).toEqual([
      '฿0',
      '-฿1.01',
      '฿0.99',
    ]);
    expect(cells(table, 'ยอดขายที่ยืนยันแล้ว').map((cell) => cell.textContent)).toEqual([
      '฿0',
      '-฿10.01',
      '฿9,007,199,254,740,993.01',
    ]);
    expect(cells(table, 'Facebook').map((cell) => cell.textContent)).toEqual(['฿0', '—', '—']);
    expect(cells(table, 'LabsD Online').map((cell) => cell.textContent)).toEqual([
      '—',
      '-฿10.01',
      '—',
    ]);
    expect(
      within(cells(table, 'Facebook')[1]).getByLabelText('ยังไม่มีข้อมูลยอดขาย Facebook ของวันนี้'),
    ).toHaveTextContent('—');
    expect(screen.queryByRole('rowheader', { name: 'TikTok' })).toBeNull();
  });
  it('retains every supplied platform row and its exact amount', () => {
    const platforms = ['facebook', 'tiktok', 'shopee', 'lazada', 'web', 'unattributed'] as const;
    render(
      <DailyEarnings
        points={[
          {
            date: '2026-09-02',
            amount: money('2100'),
            sales: money('21000'),
            salesByPlatform: platforms.map((platform, i) => ({
              platform,
              sales: money(String((i + 1) * 1000)),
            })),
          },
        ]}
      />,
    );
    openDaily();
    const table = screen.getByRole('table');
    for (const [i, label] of [
      'Facebook',
      'TikTok',
      'Shopee',
      'Lazada',
      'LabsD Online',
      'ยังไม่ระบุแหล่งขาย',
    ].entries()) {
      expect(cells(table, label)[0]).toHaveTextContent('฿' + (i + 1) * 10);
    }
  });
  it('regroups seven dates by actual available width without duplicate or missing columns and repeats metric headers', () => {
    const points = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-09-0${i + 1}`,
      amount: money(String((i + 1) * 100)),
    }));
    render(<DailyEarnings points={points} />);
    openDaily();
    for (const [width, groupSizes] of [
      [931, [7]],
      [700, [4, 3]],
      [450, [2, 2, 2, 1]],
      [301, [2, 2, 2, 1]],
      [214, [1, 1, 1, 1, 1, 1, 1]],
    ] as const) {
      act(() => resize(width));
      const tables = screen.getAllByRole('table');
      expect(tables.map((table) => table.querySelectorAll('thead time').length)).toEqual(
        groupSizes,
      );
      expect(
        tables.flatMap((table) =>
          [...table.querySelectorAll('thead time')].map((time) => time.getAttribute('datetime')),
        ),
      ).toEqual(points.map((point) => point.date));
      expect(
        tables.flatMap((table) => cells(table, 'คอมมิชชัน').map((cell) => cell.textContent)),
      ).toEqual(['฿1', '฿2', '฿3', '฿4', '฿5', '฿6', '฿7']);
      for (const table of tables) expect(within(table).getAllByRole('rowheader')).toHaveLength(1);
    }
  });
  it('omits all-unknown rows per date group while retaining zero, signed and partly-known cells after regrouping', () => {
    const points = Array.from({ length: 7 }, (_, i) => ({
      date: '2026-09-0' + (i + 1),
      amount: money('0'),
      sales: i === 0 ? money('0') : i === 4 ? money('200') : null,
      salesByPlatform:
        i === 0
          ? [{ platform: 'web' as const, sales: money('0') }]
          : i === 4
            ? [{ platform: 'web' as const, sales: money('200') }]
            : i === 6
              ? [{ platform: 'facebook' as const, sales: money('-101') }]
              : null,
    }));
    render(<DailyEarnings points={points} />);
    openDaily();
    act(() => resize(700));
    let tables = screen.getAllByRole('table');
    expect(cells(tables[0], 'LabsD Online').map((cell) => cell.textContent)).toEqual([
      '฿0',
      '—',
      '—',
      '—',
    ]);
    expect(within(tables[0]).queryByRole('rowheader', { name: 'Facebook' })).toBeNull();
    expect(cells(tables[1], 'Facebook').map((cell) => cell.textContent)).toEqual([
      '—',
      '—',
      '-฿1.01',
    ]);
    act(() => resize(301));
    tables = screen.getAllByRole('table');
    expect(cells(tables[0], 'ยอดขายที่ยืนยันแล้ว').map((cell) => cell.textContent)).toEqual([
      '฿0',
      '—',
    ]);
    expect(
      within(cells(tables[0], 'ยอดขายที่ยืนยันแล้ว')[1]).getByLabelText(
        'ยังไม่มีข้อมูลยอดขายที่ยืนยันแล้วของวันนี้',
      ),
    ).toHaveTextContent('—');
    expect(
      within(tables[1])
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(['คอมมิชชัน']);
    expect(cells(tables[1], 'คอมมิชชัน').map((cell) => cell.textContent)).toEqual(['฿0', '฿0']);
    expect(cells(tables[2], 'LabsD Online').map((cell) => cell.textContent)).toEqual(['฿2', '—']);
    expect(within(tables[3]).queryByRole('rowheader', { name: 'LabsD Online' })).toBeNull();
    expect(cells(tables[3], 'Facebook')[0]).toHaveTextContent('-฿1.01');
  });
  it('keeps platform rows in canonical order when supplied source arrays change order', () => {
    const sources = [
      { platform: 'web' as const, sales: money('200') },
      { platform: 'facebook' as const, sales: money('100') },
    ];
    const point = { date: '2026-09-01', amount: money('100'), salesByPlatform: sources };
    const view = render(<DailyEarnings points={[point]} />);
    openDaily();
    const headers = () =>
      within(screen.getByRole('table'))
        .getAllByRole('rowheader')
        .map((header) => header.textContent);
    expect(headers()).toEqual(['คอมมิชชัน', 'Facebook', 'LabsD Online']);
    view.rerender(
      <DailyEarnings points={[{ ...point, salesByPlatform: [...sources].reverse() }]} />,
    );
    expect(headers()).toEqual(['คอมมิชชัน', 'Facebook', 'LabsD Online']);
  });
  it('replaces prior platforms and resets disclosure when the caller changes report identity', () => {
    const view = render(
      <DailyEarnings
        key="scope-a"
        points={[
          {
            date: '2026-09-01',
            amount: money('100'),
            salesByPlatform: [{ platform: 'shopee', sales: money('1000') }],
          },
        ]}
      />,
    );
    openDaily();
    expect(screen.getByRole('rowheader', { name: 'Shopee' })).toBeVisible();
    view.rerender(
      <DailyEarnings
        key="scope-b"
        points={[{ date: '2026-09-02', amount: money('200'), sales: null, salesByPlatform: null }]}
      />,
    );
    expect(screen.queryByText('Shopee')).toBeNull();
    expect(screen.queryByText('฿10')).toBeNull();
    expect(screen.getByText('ดูตัวเลขรายวัน').closest('details')).not.toHaveAttribute('open');
    openDaily();
    expect(screen.getByText('฿2')).toBeVisible();
    expect(screen.queryByRole('rowheader', { name: 'ยอดขายที่ยืนยันแล้ว' })).toBeNull();
  });
  it('does not create an empty daily dropdown', () => {
    const view = render(<DailyEarnings points={[]} />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
