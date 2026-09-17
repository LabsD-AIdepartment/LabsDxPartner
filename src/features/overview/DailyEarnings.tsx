'use client';
import { useEffect, useRef, useState } from 'react';
import type { MoneyValue } from '@/contracts/common';
import { Money } from '@/shared/ui/Money';
import { dateLabel } from '@/shared/ui/format-date';
import styles from './daily-earnings.module.css';

type SalesPlatform = 'facebook' | 'tiktok' | 'shopee' | 'lazada' | 'web' | 'unattributed';
const platformLabels: Record<SalesPlatform, string> = {
  facebook: 'Facebook',
  tiktok: 'TikTok',
  shopee: 'Shopee',
  lazada: 'Lazada',
  web: 'LabsD Online',
  unattributed: 'ยังไม่ระบุแหล่งขาย',
};

type DailyPoint = {
  date: string;
  amount: MoneyValue;
  sales?: MoneyValue | null;
  salesByPlatform?: readonly { platform: SalesPlatform; sales: MoneyValue }[] | null;
};
const dayLabel = (date: string) => dateLabel(`${date}T00:00:00+07:00`);
const compactDate = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Bangkok',
});

/** Supplied confirmed daily amounts only; source labels never derive from a clip's platform. */
export function DailyEarnings({ points }: { points: readonly DailyPoint[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [columns, setColumns] = useState(1);
  const hasPoints = points.length > 0;
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      // Wide groups reserve a 144px row heading; two-day groups use a 104px heading.
      setColumns(width >= 900 ? 7 : width >= 576 ? 4 : width >= 300 ? 2 : 1);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasPoints]);
  if (!hasPoints) return null;
  const suppliedPlatforms = new Set(
    points.flatMap((point) => point.salesByPlatform?.map((x) => x.platform) ?? []),
  );
  const platforms = (Object.keys(platformLabels) as SalesPlatform[]).filter((platform) =>
    suppliedPlatforms.has(platform),
  );
  const groups: (readonly DailyPoint[])[] = [];
  for (let i = 0; i < points.length; i += columns) groups.push(points.slice(i, i + columns));
  return (
    <details ref={ref} className={styles.disclosure}>
      <summary>ดูตัวเลขรายวัน</summary>
      <div className={styles.tables}>
        {groups.map((group) => (
          <table
            key={group[0].date}
            className={styles.table}
            aria-label={`ยอดรายวัน ${dayLabel(group[0].date)} ถึง ${dayLabel(group[group.length - 1].date)}`}
          >
            <colgroup>
              <col className={styles.labelColumn} />
              {group.map((point) => (
                <col key={point.date} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">รายการ</th>
                {group.map((point) => (
                  <th key={point.date} scope="col" aria-label={dayLabel(point.date)}>
                    <time dateTime={point.date}>
                      {compactDate.format(new Date(`${point.date}T00:00:00+07:00`))}
                    </time>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.some((point) => point.sales != null) && (
                <tr>
                  <th scope="row">ยอดขายที่ยืนยันแล้ว</th>
                  {group.map((point) => (
                    <td key={point.date}>
                      <Money
                        value={point.sales ?? null}
                        reason="ยังไม่มีข้อมูลยอดขายที่ยืนยันแล้วของวันนี้"
                      />
                    </td>
                  ))}
                </tr>
              )}
              {group.some((point) => point.amount != null) && (
                <tr>
                  <th scope="row">คอมมิชชัน</th>
                  {group.map((point) => (
                    <td key={point.date}>
                      <Money value={point.amount} />
                    </td>
                  ))}
                </tr>
              )}
              {platforms
                .filter((platform) =>
                  group.some((point) =>
                    point.salesByPlatform?.some(
                      (source) => source.platform === platform && source.sales != null,
                    ),
                  ),
                )
                .map((platform) => (
                  <tr key={platform}>
                    <th scope="row">{platformLabels[platform]}</th>
                    {group.map((point) => (
                      <td key={point.date}>
                        <Money
                          value={
                            point.salesByPlatform?.find((source) => source.platform === platform)
                              ?.sales ?? null
                          }
                          reason={`ยังไม่มีข้อมูลยอดขาย ${platformLabels[platform]} ของวันนี้`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        ))}
      </div>
    </details>
  );
}
