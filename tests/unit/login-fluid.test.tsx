import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluidBackdrop } from '@/features/login/FluidBackdrop';
import { PublicFrame } from '@/features/login/PublicFrame';
import { LoginPage } from '@/features/login/LoginPage';
import { renderToString } from 'react-dom/server';

let reduced: EventTarget & { matches: boolean };
let lightweight: EventTarget & { matches: boolean };
let callbacks: Map<number, FrameRequestCallback>;
let nextFrame: number;
beforeEach(() => {
  reduced = Object.assign(new EventTarget(), { matches: false });
  lightweight = Object.assign(new EventTarget(), { matches: false });
  callbacks = new Map();
  nextFrame = 0;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) =>
      query.includes('reduced-motion')
        ? reduced
        : query.includes('max-width')
          ? lightweight
          : Object.assign(new EventTarget(), { matches: true }),
    ),
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => callbacks.delete(id)),
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('login fluid presentation', () => {
  it('keeps mobile SVG geometry static and switches safely when the media query changes', () => {
    lightweight.matches = true;
    const { container, unmount } = render(<FluidBackdrop />);
    const path = container.querySelector('[data-fluid-field] > path')!;
    const opening = path.getAttribute('d');
    expect(callbacks.size).toBe(0);
    fireEvent.pointerMove(window, { clientX: 900, clientY: 800, pointerType: 'mouse' });
    expect(path.getAttribute('d')).toBe(opening);
    lightweight.matches = false;
    lightweight.dispatchEvent(new Event('change'));
    expect(callbacks.size).toBe(1);
    for (const time of [100, 150]) {
      const [id, callback] = callbacks.entries().next().value!;
      callbacks.delete(id);
      callback(time);
    }
    expect(path.getAttribute('d')).not.toBe(opening);
    lightweight.matches = true;
    lightweight.dispatchEvent(new Event('change'));
    expect(callbacks.size).toBe(0);
    expect(path.getAttribute('d')).toBe(opening);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(container.querySelector('[data-fluid-backdrop]')).toHaveAttribute(
      'data-motion-paused',
      'true',
    );
    unmount();
    lightweight.matches = false;
    lightweight.dispatchEvent(new Event('change'));
    expect(callbacks.size).toBe(0);
  });

  it('ships the opening shape before hydration and continues from it without a first-frame jump', () => {
    const server = new DOMParser().parseFromString(renderToString(<FluidBackdrop />), 'text/html');
    const serverPaths = [...server.querySelectorAll('[data-fluid-field] > path')].map((path) =>
      path.getAttribute('d'),
    );
    expect(serverPaths).toHaveLength(2);
    expect(serverPaths.every((path) => path?.startsWith('M '))).toBe(true);
    const { container } = render(<FluidBackdrop />);
    const paths = () =>
      [...container.querySelectorAll('[data-fluid-field] > path')].map((path) =>
        path.getAttribute('d'),
      );
    expect(paths()).toEqual(serverPaths);
    const [id, callback] = callbacks.entries().next().value!;
    callbacks.delete(id);
    callback(100);
    expect(paths()).toEqual(serverPaths);
    expect(container.querySelector('linearGradient')?.getAttribute('gradientTransform')).toBe(
      server.querySelector('linearGradient')?.getAttribute('gradientTransform'),
    );
  });

  it('preserves the default public frame for invitation and recovery callers', () => {
    const { container } = render(
      <PublicFrame>
        <p>Existing public page</p>
      </PublicFrame>,
    );
    expect(screen.getByText('เห็นภาพรวม เข้าใจทุกรายได้')).toBeVisible();
    expect(container.querySelector('[data-fluid-backdrop]')).toBeNull();
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('uses the actual login controls without the removed support paragraph or preview copy', () => {
    const { container } = render(
      <PublicFrame variant="fluid">
        <LoginPage next="/overview" />
      </PublicFrame>,
    );
    expect(container.querySelector('[data-fluid-backdrop]')).not.toBeNull();
    expect(screen.getByLabelText('username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByText(/ยังไม่มีคำเชิญ/)).toBeNull();
    expect(screen.queryByText(/ตัวอย่างการเข้าสู่ระบบ/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ลืมรหัสผ่าน' }));
    expect(screen.getByText(/ยืนยันเจ้าของบัญชี/)).toBeVisible();
  });

  it('renders a static background for reduced motion and leaves pointer movement inert', () => {
    reduced.matches = true;
    const { container } = render(<FluidBackdrop />);
    const field = container.querySelector('[data-fluid-field]')!;
    const original = field.getAttribute('transform');
    expect(container.querySelector('[data-fluid-field] > path')?.getAttribute('d')).toContain('M ');
    fireEvent.pointerMove(window, { clientX: 900, clientY: 800, pointerType: 'mouse' });
    expect(field.getAttribute('transform')).toBe(original);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('animates the surface, pauses when hidden, and cleans up the frame and listeners', () => {
    const { container, unmount } = render(<FluidBackdrop />);
    const path = container.querySelector('[data-fluid-field] > path')!;
    const original = path.getAttribute('d');
    const step = (time: number) => {
      const [id, cb] = callbacks.entries().next().value!;
      callbacks.delete(id);
      cb(time);
    };
    step(100);
    step(150);
    expect(path.getAttribute('d')).not.toBe(original);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callbacks.size).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callbacks.size).toBe(1);
    reduced.matches = true;
    reduced.dispatchEvent(new Event('change'));
    expect(callbacks.size).toBe(0);
    reduced.matches = false;
    reduced.dispatchEvent(new Event('change'));
    expect(callbacks.size).toBe(1);
    unmount();
    expect(callbacks.size).toBe(0);
    document.dispatchEvent(new Event('visibilitychange'));
    reduced.dispatchEvent(new Event('change'));
    expect(callbacks.size).toBe(0);
  });
});
