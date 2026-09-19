import { z } from 'zod';

export const FILL_START = '2026-09-19';
export const FILL_BRANDS = ['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova'] as const;
export const DailyFill = z.object({
  version: z.literal(1),
  source: z.literal('demo-daily-chart-fill'),
  through: z.iso.date(),
  rows: z
    .array(
      z.object({
        date: z.iso.date(),
        brand: z.enum(FILL_BRANDS),
        minor: z.string().regex(/^\d{1,10}$/),
      }),
    )
    .max(25000),
});
export type DailyFillValue = z.infer<typeof DailyFill>;
export function bangkokDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function nextMidnightDelay(now: Date): number {
  const today = bangkokDay(now);
  return Date.parse(`${today}T00:00:00+07:00`) + 86400000 - now.getTime();
}
/** Stable illustrative amounts only. No source ledger or clip identity is invented. */
export function generateDailyFill(through: string): DailyFillValue {
  z.iso.date().parse(through);
  if (through < FILL_START)
    return { version: 1, source: 'demo-daily-chart-fill', through, rows: [] };
  const days = Math.round((Date.parse(through) - Date.parse(FILL_START)) / 86400000) + 1;
  if (days > 5000) throw new Error('Demo fill date horizon exceeded');
  const rows: DailyFillValue['rows'] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.parse(FILL_START) + i * 86400000).toISOString().slice(0, 10);
    for (const brand of FILL_BRANDS) {
      let hash = 2166136261;
      for (const char of `${date}:${brand}:v1`)
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
      rows.push({ date, brand, minor: String((2000 + (hash % 4001)) * 100) });
    }
  }
  return { version: 1, source: 'demo-daily-chart-fill', through, rows };
}
