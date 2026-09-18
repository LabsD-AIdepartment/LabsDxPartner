'use client';
import { useEffect, type RefObject } from 'react';

export const DATA_ENTRANCE_EVENT = 'labsd:page-enter';
export const easeOut = (progress: number) => 1 - (1 - progress) ** 3;

/** Visual progress only; source values and accessible labels always remain exact. */
export function useDataEntrance(
  ref: RefObject<HTMLElement | null>,
  draw: (progress: number) => void,
  duration = 1600,
) {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window.matchMedia !== 'function') return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let observer: IntersectionObserver | undefined;
    let disposed = false;
    let cycle = 0;
    const stop = () => {
      cycle++;
      cancelAnimationFrame(frame);
      frame = 0;
      observer?.disconnect();
    };
    const replay = () => {
      stop();
      if (preference.matches || document.hidden) {
        draw(1);
        return;
      }
      draw(0);
      const activeCycle = cycle;
      let hasStarted = false;
      const start = () => {
        if (disposed || activeCycle !== cycle || hasStarted) return;
        hasStarted = true;
        observer?.disconnect();
        if (preference.matches || document.hidden) {
          draw(1);
          return;
        }
        let started: number | undefined;
        const tick = (now: number) => {
          if (disposed || activeCycle !== cycle) return;
          started ??= now;
          const progress = Math.min(1, (now - started) / duration);
          draw(progress);
          if (progress < 1) frame = requestAnimationFrame(tick);
          else frame = 0;
        };
        frame = requestAnimationFrame(tick);
      };
      if (typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) start();
          },
          { threshold: 0.15 },
        );
        observer.observe(element);
      } else start();
    };
    const visibilityChanged = () => {
      if (document.hidden) {
        stop();
        draw(1);
      }
    };
    replay();
    window.addEventListener(DATA_ENTRANCE_EVENT, replay);
    preference.addEventListener('change', replay);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      disposed = true;
      stop();
      window.removeEventListener(DATA_ENTRANCE_EVENT, replay);
      preference.removeEventListener('change', replay);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [ref, draw, duration]);
}
