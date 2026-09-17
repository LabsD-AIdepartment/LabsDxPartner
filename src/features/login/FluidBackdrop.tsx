'use client';
import { useEffect, useId, useRef } from 'react';
import styles from './fluid-backdrop.module.css';

// Start at the owner's chosen rising fold, then continue the existing motion.
const OPENING_PHASE = 3.5;

function surfaceAt(phase: number, x = 0, y = 0) {
  const upper: string[] = [],
    lower: string[] = [];
  for (let i = 0; i <= 80; i++) {
    const px = -240 + i * 26;
    const wave = Math.sin(px * 0.0035 - phase) * 128 + Math.sin(px * 0.0019 + phase * 0.7) * 76;
    const py = 580 - (px - 800) * 0.42 + wave + y * 70;
    const thickness = 120 + (Math.sin(px * 0.004 + phase * 0.8) + 1) * 78;
    // Stable SVG serialization across server and browser math implementations.
    upper.push(`${px},${py.toFixed(3)}`);
    lower.push(`${px},${(py + thickness).toFixed(3)}`);
  }
  const curve = `M ${upper.join(' L ')}`;
  return {
    curve,
    shape: `${curve} L ${lower.reverse().join(' L ')} Z`,
    position: `translate(${x * 40} ${y * 20})`,
    reflection: `translate(0 ${(Math.sin(phase * 1.15) * 0.08).toFixed(6)}) rotate(${(Math.sin(phase * 0.8) * 9 + x * 6).toFixed(6)} .5 .5)`,
  };
}

// Render the same geometry on the server and on the first animation frame.
const openingSurface = surfaceAt(OPENING_PHASE);

/** Decorative only: pointer input bends the light, never the form or its hit targets. */
export function FluidBackdrop() {
  const id = useId().replace(/:/g, '');
  const field = useRef<SVGGElement>(null);
  const ribbon = useRef<SVGPathElement>(null);
  const glow = useRef<SVGPathElement>(null);
  const reflection = useRef<SVGLinearGradientElement>(null);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0,
      last = 0,
      phase = OPENING_PHASE,
      x = 0,
      y = 0,
      targetX = 0,
      targetY = 0;
    const render = () => {
      // Travelling waves deform both sides independently, so this flows rather
      // than rocking a rigid ribbon. All coordinates stay in the decorative SVG.
      const surface = surfaceAt(phase, x, y);
      ribbon.current?.setAttribute('d', surface.shape);
      glow.current?.setAttribute('d', surface.curve);
      field.current?.setAttribute('transform', surface.position);
      reflection.current?.setAttribute('gradientTransform', surface.reflection);
    };
    const tick = (now: number) => {
      const elapsed = last ? Math.min(now - last, 64) : 0;
      last = now;
      phase += ((elapsed / 1000) * Math.PI * 2) / 22;
      const follow = 1 - Math.exp(-elapsed / 600);
      x += (targetX - x) * follow;
      y += (targetY - y) * follow;
      render();
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (reduced.matches) {
        x = y = targetX = targetY = 0;
        phase = OPENING_PHASE;
        render();
      } else if (!document.hidden) frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      if (reduced.matches || !finePointer.matches || event.pointerType === 'touch') return;
      targetX = Math.max(-1, Math.min(1, (event.clientX / innerWidth) * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY / innerHeight) * 2 - 1));
    };
    const leave = () => {
      targetX = targetY = 0;
    };
    render();
    start();
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', start);
    reduced.addEventListener('change', start);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', start);
      reduced.removeEventListener('change', start);
    };
  }, []);

  return (
    <div className={styles.backdrop} aria-hidden="true" data-fluid-backdrop>
      <svg viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient
            ref={reflection}
            id={`${id}-silk`}
            x1="0"
            y1="0"
            x2=".35"
            y2="1"
            gradientTransform={openingSurface.reflection}
          >
            <stop offset="0" stopColor="var(--fluid-highlight)" stopOpacity="0" />
            <stop offset=".25" stopColor="var(--fluid-highlight)" stopOpacity=".04" />
            <stop offset=".42" stopColor="var(--fluid-deep)" stopOpacity=".8" />
            <stop offset=".48" stopColor="var(--fluid-shadow)" stopOpacity=".9" />
            <stop offset=".53" stopColor="var(--fluid-bright)" />
            <stop offset=".58" stopColor="var(--fluid-highlight)" />
            <stop offset=".60" stopColor="var(--fluid-silver)" />
            <stop offset=".66" stopColor="var(--fluid-bright)" />
            <stop offset=".73" stopColor="var(--fluid-deep)" stopOpacity=".94" />
            <stop offset=".86" stopColor="var(--fluid-deep)" stopOpacity=".4" />
            <stop offset="1" stopColor="var(--fluid-deep)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-bloom`}>
            <stop stopColor="var(--fluid-bright)" stopOpacity=".45" />
            <stop offset="1" stopColor="var(--fluid-bright)" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-haze`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="48" />
          </filter>
          <filter id={`${id}-soft`} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>
        <g ref={field} data-fluid-field transform={openingSurface.position}>
          <ellipse cx="260" cy="750" rx="480" ry="450" fill={`url(#${id}-bloom)`} />
          <ellipse cx="1390" cy="370" rx="440" ry="420" fill={`url(#${id}-bloom)`} />
          <path
            ref={glow}
            d={openingSurface.curve}
            fill="none"
            stroke="var(--fluid-bright)"
            strokeWidth="140"
            opacity=".38"
            filter={`url(#${id}-haze)`}
          />
          <path
            ref={ribbon}
            d={openingSurface.shape}
            fill={`url(#${id}-silk)`}
            filter={`url(#${id}-soft)`}
          />
        </g>
      </svg>
    </div>
  );
}
