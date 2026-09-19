import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DailyFill, bangkokDay, generateDailyFill } from './model';

export const FILL_FILE = 'demo-daily-chart-fill-v1.json';
export function fillEnabled(env: Record<string, string | undefined> = process.env) {
  return env.LABSD_DEMO_DAILY_CHART_FILL_ENABLED === '1';
}
export function fillDirectory(env: Record<string, string | undefined> = process.env) {
  return env.LABSD_DEMO_DAILY_CHART_FILL_DIR || env.LABSD_HOSTED_DATA_DIR;
}
export async function readDailyFill(directory: string) {
  return DailyFill.parse(JSON.parse(await readFile(join(directory, FILL_FILE), 'utf8')));
}
/** Sole writer. Rebuild deterministic daily rows, then atomically publish; no source DB writes. */
export async function fillThroughToday(env: Record<string, string | undefined>, now = new Date()) {
  if (!fillEnabled(env)) return { enabled: false, changed: false };
  const directory = fillDirectory(env);
  if (!directory) throw new Error('Demo fill data directory missing');
  const through = bangkokDay(now);
  const next = generateDailyFill(through);
  try {
    const existing = await readDailyFill(directory);
    if (JSON.stringify(existing) === JSON.stringify(next))
      return { enabled: true, changed: false, through, rows: next.rows.length };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `${FILL_FILE}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    await rename(temp, join(directory, FILL_FILE));
  } finally {
    await unlink(temp).catch(() => {});
  }
  return { enabled: true, changed: true, through, rows: next.rows.length };
}
