import { render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TrendChart } from '@/shared/charts/TrendChart';
import { formatMinor } from '@/shared/ui/format-money';
let plotWidth = 301;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: plotWidth } }] as ResizeObserverEntry[],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const makePoints = (amounts: string[]) =>
  amounts.map((minor, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    amount: { currency: 'THB' as const, minor },
  }));
it.each([227, 301, 470, 900])(
  'keeps every daily value in a separate nonoverlapping badge at %ipx',
  (width) => {
    plotWidth = width;
    const points = makePoints(['186000', '740000', '258000', '960000', '312000', '1280000']);
    const { container } = render(<TrendChart points={points} />);
    points.forEach((p) =>
      expect(screen.getByText(formatMinor(p.amount.minor, true))).toBeInTheDocument(),
    );
    const rects = [...container.querySelectorAll('rect')].map((r) => ({
      x: Number(r.getAttribute('x')),
      y: Number(r.getAttribute('y')),
      w: Number(r.getAttribute('width')),
      h: Number(r.getAttribute('height')),
    }));
    expect(rects).toHaveLength(points.length);
    rects.forEach((a, i) =>
      rects
        .slice(i + 1)
        .forEach((b) =>
          expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(
            false,
          ),
        ),
    );
  },
);
it('preserves exact signed satang and keeps a dense series scrollable with keyboard access', () => {
  plotWidth = 227;
  const points = makePoints(
    Array.from({ length: 31 }, (_, i) =>
      i === 0 ? '900719925474099301' : i === 1 ? '-501' : String(100000 + i),
    ),
  );
  const { container } = render(<TrendChart points={points} />);
  expect(screen.getByText('฿9,007,199,254,740,993.01')).toBeInTheDocument();
  expect(screen.getByText('-฿5.01')).toBeInTheDocument();
  expect(container.querySelectorAll('rect')).toHaveLength(31);
  expect(screen.getByRole('region', { name: 'กราฟคอมมิชชันรายวัน' })).toHaveAttribute(
    'tabindex',
    '0',
  );
});
it('centers the sole daily point and keeps a zero distinct from no data', () => {
  plotWidth = 301;
  const { container } = render(<TrendChart points={makePoints(['0'])} />);
  expect(screen.getByText('฿0')).toBeInTheDocument();
  expect(Number(container.querySelector('circle')?.getAttribute('cx'))).toBe(150.5);
});
