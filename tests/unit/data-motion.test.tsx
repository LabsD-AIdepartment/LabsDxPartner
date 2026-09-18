import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DonutChart } from '@/shared/charts/DonutChart';
import { TrendChart } from '@/shared/charts/TrendChart';
import { BarChart } from '@/shared/charts/BarChart';
import { DATA_ENTRANCE_EVENT } from '@/shared/motion/useDataEntrance';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let reduced: boolean;
let preferenceChanged: (() => void) | undefined;
let intersections: IntersectionObserverCallback[];
const amount = (minor: string) => ({ minor, currency: 'THB' as const });
function step(time: number) {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  });
}
function enter() {
  act(() =>
    intersections
      .splice(0)
      .forEach((callback) =>
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      ),
  );
}
beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  reduced = false;
  intersections = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, callback: () => void) => {
      preferenceChanged = callback;
    },
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersections.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('waits for visibility, replays on route entry, and settles immediately for reduced motion', () => {
  const { container, rerender, unmount } = render(<DonutChart primary="8000" total="10000" />);
  const percent = () => container.querySelector('[data-donut-percent]')!.textContent;
  expect(percent()).toBe('0%');
  expect(frames.size).toBe(0);
  enter();
  step(0);
  step(1800);
  expect(percent()).toBe('80%');
  rerender(<DonutChart primary="8000" total="10000" />);
  expect(frames.size).toBe(0);
  act(() => window.dispatchEvent(new Event(DATA_ENTRANCE_EVENT)));
  expect(percent()).toBe('0%');
  enter();
  step(2000);
  act(() => {
    reduced = true;
    preferenceChanged?.();
  });
  expect(percent()).toBe('80%');
  expect(frames.size).toBe(0);
  unmount();
  expect(frames.size).toBe(0);
});

it('reveals the line left to right and pops only the points already reached; keeps missing days as gaps', () => {
  const { container } = render(
    <TrendChart
      points={[
        { date: '2026-09-16', amount: amount('1612000') },
        { date: '2026-09-17', amount: null },
        { date: '2026-09-18', amount: amount('2145000') },
      ]}
    />,
  );
  const labels = container.querySelectorAll<SVGGElement>('[data-trend-point]');
  const reveal = container.querySelector('[data-trend-reveal]')!;
  const initialWidth = Number(reveal.getAttribute('width'));
  expect(labels).toHaveLength(2);
  enter();
  step(0);
  step(800);
  expect(labels[0].style.opacity).toBe('1');
  expect(labels[1].style.opacity).toBe('0');
  expect(Number(reveal.getAttribute('width'))).toBeGreaterThan(initialWidth);
  expect(container.querySelectorAll('g[clip-path]')).toHaveLength(2);
  step(2000);
  expect(labels[1].style.opacity).toBe('1');
  expect(Number(reveal.getAttribute('width'))).toBe(Number(reveal.getAttribute('data-end')));
});

it('rotates the donut as its arc and percent increase, then lands on the exact share', () => {
  const { container } = render(<DonutChart primary="8000" total="10000" />);
  const arc = container.querySelector('[data-donut-arc]')!;
  const percent = container.querySelector('[data-donut-percent]')!;
  expect(screen.getByRole('img')).toHaveAccessibleName('Organic 80%');
  expect(percent).toHaveTextContent('0%');
  expect(arc.getAttribute('transform')).toBe('rotate(-190 60 60)');
  enter();
  step(0);
  step(900);
  expect(percent).toHaveTextContent('70%');
  step(1800);
  expect(percent).toHaveTextContent('80%');
  expect(arc.getAttribute('transform')).toBe('rotate(-90 60 60)');
});

it('grows sales bars and keeps the final labels unchanged', () => {
  const { container } = render(
    <BarChart items={[{ label: 'Facebook', value: amount('113800000') }]} />,
  );
  const bar = container.querySelector<HTMLElement>('[data-sales-bar]')!;
  expect(bar.style.transform).toBe('scaleX(0)');
  expect(container).toHaveTextContent('1.138m');
  enter();
  step(0);
  step(1600);
  expect(bar.style.transform).toBe('scaleX(1)');
});

it('ignores duplicate and stale visibility callbacks after replay, reduced motion and unmount', () => {
  const { container, unmount } = render(<DonutChart primary="8000" total="10000" />);
  const original = intersections[0];
  const notify = (callback: IntersectionObserverCallback) =>
    callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  act(() => {
    notify(original);
    notify(original);
  });
  expect(frames.size).toBe(1);
  act(() => window.dispatchEvent(new Event(DATA_ENTRANCE_EVENT)));
  const current = intersections.at(-1)!;
  expect(frames.size).toBe(0);
  act(() => notify(original));
  expect(frames.size).toBe(0);
  act(() => {
    reduced = true;
    preferenceChanged?.();
    notify(current);
  });
  expect(container.querySelector('[data-donut-percent]')).toHaveTextContent('80%');
  expect(frames.size).toBe(0);
  unmount();
  act(() => notify(current));
  expect(frames.size).toBe(0);
});
