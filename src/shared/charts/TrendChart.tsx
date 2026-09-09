'use client';
import { useId, useEffect, useRef, useState } from 'react';
import type { MoneyValue } from '@/contracts/common';
import { formatMinor } from '@/shared/ui/format-money';
import { displayRatio } from './display-ratio';
import { DataState } from '@/shared/ui/DataState';
import styles from './chart.module.css';
export function TrendChart({
  points,
}: {
  points: readonly { date: string; amount: MoneyValue }[];
}) {
  const id = useId().replaceAll(':', '');
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      // Match the actual plot width so SVG scaling cannot shrink its 14px labels.
      setWidth(Math.max(1, entry.contentRect.width)),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  if (!points.length) return <DataState state="empty" />;
  const values = points.map((x) => BigInt(x.amount.minor));
  const min = values.reduce((a, b) => (b < a ? b : a), 0n);
  const max = values.reduce((a, b) => (b > a ? b : a), 0n);
  const range = max - min || 1n;
  const x = (i: number) => 24 + (i * (width - 48)) / Math.max(1, points.length - 1);
  const y = (v: bigint) => 136 - displayRatio(v - min, range) * 100;
  const path = values
    .map((v, i) =>
      i === 0
        ? `M${x(i)},${y(v)}`
        : `C${(x(i - 1) + x(i)) / 2},${y(values[i - 1])} ${(x(i - 1) + x(i)) / 2},${y(v)} ${x(i)},${y(v)}`,
    )
    .join(' ');
  const last = points[points.length - 1];
  const zeroY = y(0n);
  return (
    <div ref={ref} className={styles.chart}>
      <svg viewBox={`0 0 ${width} 182`} role="img" aria-label="คอมมิชชันตามวันที่เกิดรายได้">
        <title>คอมมิชชันตามวันที่เกิดรายได้</title>
        <defs>
          <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#c5fa5f" />
            <stop offset="1" stopColor="#32c96b" />
          </linearGradient>
          <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#a3ef89" stopOpacity=".18" />
            <stop offset="1" stopColor="#a3ef89" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[36, 86, 136].map((py) => (
          <line
            key={py}
            x1="24"
            x2={width - 24}
            y1={py}
            y2={py}
            stroke="var(--line)"
            strokeDasharray="2 5"
          />
        ))}
        <path
          d={`${path} L${x(values.length - 1)},${zeroY} L${x(0)},${zeroY} Z`}
          fill={`url(#${id}-area)`}
        />
        <path d={path} fill="none" stroke={`url(#${id}-line)`} strokeWidth="2" />
        {points.map((point, i) => (
          <g key={`${point.date}-${i}`}>
            <circle cx={x(i)} cy={y(values[i])} r="3" fill="var(--chart-dot)">
              <title>{`${point.date}: ${formatMinor(point.amount.minor)}`}</title>
            </circle>
            {(width > 480 || i === 0 || i === points.length - 1) && (
              <text
                x={x(i)}
                y="173"
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              >
                {point.date.slice(8)}{' '}
                {new Date(point.date + 'T12:00:00Z').toLocaleDateString('en-GB', {
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className={styles.lastValue}>
        ล่าสุด <strong>{formatMinor(last.amount.minor, true)}</strong>
      </p>
      <div className={styles.axisCaption}>
        <span>• คอมมิชชันรายวัน</span>
        <span>ตามวันที่เกิดรายได้</span>
      </div>
    </div>
  );
}
