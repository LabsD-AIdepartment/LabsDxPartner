'use client';
import { useId, useRef, useCallback } from 'react';
import { easeOut, useDataEntrance } from '@/shared/motion/useDataEntrance';
import { displayRatio } from './display-ratio';
import styles from './chart.module.css';
export function DonutChart({
  primary,
  total,
  primaryLabel = 'Organic',
  secondaryLabel = 'Brand ads',
  showMarketingCopy = true,
}: {
  primary: string;
  total: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  showMarketingCopy?: boolean;
}) {
  const id = useId().replaceAll(':', '');
  const p = BigInt(primary),
    t = BigInt(total);
  const ratio = t > 0n ? Math.min(1, Math.max(0, displayRatio(p, t))) : 0;
  const circumference = 2 * Math.PI * 48;
  const ref = useRef<HTMLDivElement>(null);
  const draw = useCallback(
    (progress: number) => {
      const amount = easeOut(progress);
      const arc = ref.current?.querySelector('[data-donut-arc]');
      arc?.setAttribute('stroke-dasharray', `${ratio * circumference * amount} ${circumference}`);
      arc?.setAttribute('transform', `rotate(${-90 - 100 * (1 - amount)} 60 60)`);
      const text = ref.current?.querySelector('[data-donut-percent]')?.firstChild;
      if (text instanceof Text)
        text.nodeValue = t === 0n ? '—' : `${Math.round(ratio * 100 * amount)}%`;
    },
    [ratio, circumference, t],
  );
  useDataEntrance(ref, draw, 1800);
  return (
    <>
      <div className={`${styles.mix} ${showMarketingCopy ? '' : styles.centeredMix}`}>
        <div ref={ref} className={styles.ring}>
          <svg
            viewBox="0 0 120 120"
            role="img"
            aria-label={
              t === 0n ? 'ยังไม่มีสัดส่วนรายได้' : `${primaryLabel} ${Math.round(ratio * 100)}%`
            }
          >
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#a3ef89" />
                <stop offset=".5" stopColor="#32c96b" />
                <stop offset="1" stopColor="#178358" />
              </linearGradient>
            </defs>
            <circle
              cx="60"
              cy="60"
              r="48"
              fill="none"
              stroke="var(--ring-track)"
              strokeWidth="14"
            />
            <circle
              cx="60"
              cy="60"
              r="48"
              fill="none"
              data-donut-arc
              stroke={`url(#${id})`}
              strokeWidth="14"
              strokeDasharray={`${ratio * circumference} ${circumference}`}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className={styles.center}>
            <span data-donut-percent aria-hidden="true">
              {t === 0n ? '—' : `${Math.round(ratio * 100)}%`}
            </span>
            <small>{primaryLabel}</small>
          </div>
        </div>
        {showMarketingCopy && (
          <div>
            <p>
              Made by you
              <br />
              Earned by you
            </p>
            <span className="muted small">สัดส่วนคอมมิชชันของคุณ</span>
          </div>
        )}
      </div>
      <div className={`${styles.legend} ${showMarketingCopy ? '' : styles.centeredMix}`}>
        <span>
          <i className={styles.dot} />
          {primaryLabel}
        </span>
        <span>
          <i className={styles.dot} style={{ background: 'var(--ring-track)' }} />
          {secondaryLabel}
        </span>
      </div>
    </>
  );
}
