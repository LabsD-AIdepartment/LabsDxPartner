'use client';
import { useId, useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { useDataEntrance } from '@/shared/motion/useDataEntrance';
import type { MoneyValue } from '@/contracts/common';
import { coverageSegmentForDay, type PeriodCoverageValue } from '@/contracts/coverage';
import { formatMinor } from '@/shared/ui/format-money';
import { displayRatio } from './display-ratio';
import { DataState } from '@/shared/ui/DataState';
import { compactMoney } from './compact-money';
import styles from './chart.module.css';
export function TrendChart({
  points,
  coverage,
  showAxisCaption = true,
  compactAmounts = false,
  showEveryDate = false,
}: {
  points: readonly { date: string; amount: MoneyValue | null }[];
  coverage?: PeriodCoverageValue;
  showAxisCaption?: boolean;
  compactAmounts?: boolean;
  showEveryDate?: boolean;
}) {
  const id = useId().replaceAll(':', '');
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  const useCompactAmounts = compactAmounts && width <= 480;
  const splitDates = showEveryDate && width <= 480;
  const hasPoints = points.length > 0;
  const motionKey = JSON.stringify([points, coverage]);
  const draw = useCallback(
    (progress: number) => {
      const root = ref.current;
      if (!root) return;
      const elapsed = progress * 2000;
      const reveal = root.querySelector<SVGRectElement>('[data-trend-reveal]');
      if (reveal) {
        const start = Number(reveal.dataset.start);
        const end = Number(reveal.dataset.end);
        reveal.setAttribute('width', String(start + (end - start) * Math.min(1, elapsed / 1600)));
      }
      root.querySelectorAll<SVGGElement>('[data-trend-point]').forEach((point) => {
        const reached = Math.min(
          1,
          Math.max(0, (elapsed - Number(point.dataset.trendPoint) * 1600) / 320),
        );
        const pop = 1 + 2.2 * (reached - 1) ** 3 + 1.2 * (reached - 1) ** 2;
        point.style.opacity = String(Math.min(1, reached * 3));
        point.style.transform = `translateY(${(1 - reached) * 8}px) scale(${0.8 + 0.2 * pop})`;
      });
      // Same data responses do not restart the animation; new geometry/data does.
    },
    [motionKey, width],
  );
  useDataEntrance(ref, draw, 2000);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      // Match actual plot width; size compact labels explicitly rather than scaling the SVG.
      setWidth(Math.max(1, entry.contentRect.width)),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasPoints]);
  if (!points.length) return <DataState state="empty" />;
  const values = points.map((x) => (x.amount === null ? null : BigInt(x.amount.minor)));
  const knownValues = values.filter((value): value is bigint => value !== null);
  const min = knownValues.reduce((a, b) => (b < a ? b : a), 0n);
  const max = knownValues.reduce((a, b) => (b > a ? b : a), 0n);
  const range = max - min || 1n;
  const labels = points.map((point) =>
    point.amount === null
      ? '—'
      : useCompactAmounts
        ? compactMoney(point.amount.minor)
        : formatMinor(point.amount.minor, true),
  );
  // The compact approximation must remain bounded even for the contract's 40-digit
  // money strings. Exact values are retained in point titles and daily details.
  labels.forEach((label, i) => {
    if (useCompactAmounts && label.length > 8 && points[i].amount !== null) {
      labels[i] = (Number(points[i].amount!.minor) / 100).toExponential(1).replace('e+', 'e');
    }
  });
  const baseLabelSize = width <= 320 ? 12 : width <= 400 ? 13 : 14;
  const dateGaps = Math.max(0, points.length - 1);
  const longestLabel = Math.max(...labels.map((label) => label.length));
  const labelSize = useCompactAmounts
    ? Math.max(
        10,
        Math.min(
          baseLabelSize,
          Math.floor((width - 18 - dateGaps * 3) / (longestLabel * 0.6 + dateGaps * 1.8)),
        ),
      )
    : 16;
  const badgeHeight = useCompactAmounts ? labelSize + 10 : 28;
  const collisionGap = useCompactAmounts ? 4 : 8;
  const laneHeight = badgeHeight + 6;
  // Compact pills use smaller, bounded typography. Reserve their full half-width at
  // both edges so labels stay centered over their own points without diagonal leaders.
  const labelWidths = labels.map((label) =>
    useCompactAmounts ? label.length * labelSize * 0.6 + 10 : label.length * 9 + 16,
  );
  const widest = Math.max(...labelWidths);
  const inset = useCompactAmounts
    ? Math.max(14, widest / 2 + 4, splitDates ? labelSize * 0.9 + 4 : 0)
    : Math.max(24, widest / 2 + 4);
  const plotWidth = Math.max(
    width,
    inset * 2 +
      Math.max(0, points.length - 1) *
        (useCompactAmounts ? labelSize * 1.8 + 3 : Math.max(40, (widest + 12) / 3)),
  );
  const x = (i: number) =>
    points.length === 1
      ? plotWidth / 2
      : inset + (i * (plotWidth - inset * 2)) / (points.length - 1);
  const y = (v: bigint) => 136 - displayRatio(v - min, range) * 100;
  // Missing published windows are gaps, not interpolated earnings. A daily bucket
  // can contain partial coverage, but a line must never bridge separate windows.
  const segment = (date: string) => {
    if (!coverage) return 0;
    return coverageSegmentForDay(coverage, date);
  };
  const groups: number[][] = [];
  points.forEach((point, i) => {
    if (values[i] === null) return;
    if (!i || values[i - 1] === null || segment(point.date) !== segment(points[i - 1].date))
      groups.push([]);
    groups.at(-1)!.push(i);
  });
  const paths = groups.map((group) => ({
    group,
    path: group
      .map((i, position) => {
        const v = values[i]!;
        return position === 0
          ? `M${x(i)},${y(v)}`
          : `C${(x(i - 1) + x(i)) / 2},${y(values[i - 1]!)} ${(x(i - 1) + x(i)) / 2},${y(v)} ${x(i)},${y(v)}`;
      })
      .join(' '),
  }));
  const callouts: ({ left: number; top: number; width: number } | null)[] = [];
  points.forEach((_, i) => {
    if (values[i] === null) {
      callouts.push(null);
      return;
    }
    const left = x(i) - labelWidths[i] / 2;
    let top = y(values[i]!) - badgeHeight - (useCompactAmounts ? 17 : 24);
    // Lift only colliding labels; preserve each badge's link to its own point.
    for (let j = callouts.length - 1; j >= 0; j--) {
      const prior = callouts[j];
      if (prior === null) continue;
      if (
        left < prior.left + prior.width + collisionGap &&
        left + labelWidths[i] + collisionGap > prior.left &&
        top < prior.top + laneHeight &&
        top + laneHeight > prior.top
      ) {
        top = prior.top - laneHeight;
        j = callouts.length;
      }
    }
    callouts.push({ left, top, width: labelWidths[i] });
  });
  const topInset = Math.max(
    0,
    4 - Math.min(...callouts.flatMap((item) => (item ? [item.top] : []))),
  );
  const height = (splitDates ? (useCompactAmounts ? 187 + labelSize : 207) : 182) + topInset;
  const zeroY = y(0n);
  return (
    <div
      ref={ref}
      className={styles.chart}
      data-compact={useCompactAmounts}
      style={{ '--trend-label-size': `${labelSize}px` } as CSSProperties}
    >
      <div
        className={styles.plotScroll}
        role="region"
        aria-label="กราฟคอมมิชชันรายวัน"
        tabIndex={plotWidth > width ? 0 : undefined}
      >
        <svg
          style={{ width: plotWidth, height }}
          viewBox={`0 0 ${plotWidth} ${height}`}
          role="img"
          aria-label="คอมมิชชันตามวันที่เกิดรายได้"
        >
          <title>คอมมิชชันตามวันที่เกิดรายได้</title>
          <defs>
            <clipPath id={`${id}-reveal`}>
              <rect
                data-trend-reveal
                data-start={x(0)}
                data-end={x(points.length - 1) + 3}
                x="0"
                y={-topInset}
                width={plotWidth}
                height={height}
              />
            </clipPath>
            <linearGradient
              id={`${id}-line`}
              gradientUnits="userSpaceOnUse"
              x1={inset}
              y1="0"
              x2={plotWidth - inset}
              y2="0"
            >
              <stop stopColor="#c5fa5f" />
              <stop offset="1" stopColor="#32c96b" />
            </linearGradient>
            <linearGradient
              id={`${id}-area`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="36"
              x2="0"
              y2="136"
            >
              <stop stopColor="#a3ef89" stopOpacity=".18" />
              <stop offset="1" stopColor="#a3ef89" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g transform={`translate(0 ${topInset})`}>
            {[36, 86, 136].map((py) => (
              <line
                key={py}
                x1="24"
                x2={plotWidth - 24}
                y1={py}
                y2={py}
                stroke="var(--line)"
                strokeDasharray="2 5"
              />
            ))}
            {paths.map(({ group, path }) => (
              <g key={group[0]} clipPath={`url(#${id}-reveal)`}>
                <path
                  d={`${path} L${x(group.at(-1)!)},${zeroY} L${x(group[0])},${zeroY} Z`}
                  fill={`url(#${id}-area)`}
                />
                <path d={path} fill="none" stroke={`url(#${id}-line)`} strokeWidth="2" />
              </g>
            ))}
            {points.map((point, i) => (
              <g key={`${point.date}-${i}`}>
                {point.amount !== null && callouts[i] ? (
                  <g
                    data-trend-point={points.length === 1 ? 0 : i / (points.length - 1)}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center bottom' }}
                  >
                    <line
                      x1={x(i)}
                      x2={x(i)}
                      y1={callouts[i]!.top + badgeHeight}
                      y2={y(values[i]!) - 5}
                      stroke="var(--muted)"
                      strokeOpacity=".35"
                    />
                    <rect
                      x={callouts[i]!.left}
                      y={callouts[i]!.top}
                      width={callouts[i]!.width}
                      height={badgeHeight}
                      rx={useCompactAmounts ? 4 : 6}
                      fill="#c5fa5f"
                    />
                    <text
                      className={styles.callout}
                      x={x(i)}
                      y={callouts[i]!.top + (useCompactAmounts ? badgeHeight / 2 : 19)}
                      dominantBaseline={useCompactAmounts ? 'central' : undefined}
                      textAnchor="middle"
                    >
                      {labels[i]}
                    </text>
                    <circle cx={x(i)} cy={y(values[i]!)} r="3" fill="var(--chart-dot)">
                      <title>{`${point.date}: ${formatMinor(point.amount.minor)}`}</title>
                    </circle>
                  </g>
                ) : (
                  <text x={x(i)} y="136" textAnchor="middle">
                    <title>{`${point.date}: ยังไม่มีข้อมูล`}</title>—
                  </text>
                )}
                {(showEveryDate || width > 480 || i === 0 || i === points.length - 1) && (
                  <text
                    data-date={point.date}
                    aria-label={new Date(point.date + 'T12:00:00Z').toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                    x={x(i)}
                    y="173"
                    textAnchor={
                      showEveryDate
                        ? 'middle'
                        : i === 0
                          ? 'start'
                          : i === points.length - 1
                            ? 'end'
                            : 'middle'
                    }
                  >
                    {splitDates ? (
                      <>
                        <tspan x={x(i)}>{point.date.slice(8)}</tspan>
                        <tspan x={x(i)} dy={useCompactAmounts ? labelSize + 4 : 20}>
                          {new Date(point.date + 'T12:00:00Z').toLocaleDateString('en-US', {
                            month: 'short',
                            timeZone: 'UTC',
                          })}
                        </tspan>
                      </>
                    ) : (
                      <>
                        {point.date.slice(8)}{' '}
                        {new Date(point.date + 'T12:00:00Z').toLocaleDateString('en-GB', {
                          month: 'short',
                          timeZone: 'UTC',
                        })}
                      </>
                    )}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
      </div>
      {showAxisCaption && (
        <div className={styles.axisCaption}>
          <span>• คอมมิชชันรายวัน</span>
          <span>ตามวันที่เกิดรายได้</span>
        </div>
      )}
    </div>
  );
}
