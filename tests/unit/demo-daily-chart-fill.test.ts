// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  generateDailyFill,
  bangkokDay,
  nextMidnightDelay,
} from '@/server/hosted-demo/daily-chart-fill/model';
import {
  fillThroughToday,
  readDailyFill,
  FILL_FILE,
} from '@/server/hosted-demo/daily-chart-fill/store';
import {
  applyDailyChartFill,
  createDailyChartFillTransport,
} from '../../dev/daily-chart-fill-transport';
import { overviewFixture } from '../../dev/overview-transport';
import { Overview } from '@/contracts/overview';
import { coverageForPeriod } from '@/contracts/coverage';
const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(folders.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function directory() {
  const root = resolve('.agent-work/20260919-demo-daily-fill/tmp');
  await mkdir(root, { recursive: true });
  const p = await mkdtemp(root + '/store-');
  folders.push(p);
  return p;
}
const at = (date: string) => new Date(date + 'T00:00:00+07:00');
it('rolls at Bangkok midnight independently of UTC day', () => {
  expect(bangkokDay(new Date('2026-09-18T16:59:59Z'))).toBe('2026-09-18');
  expect(bangkokDay(new Date('2026-09-18T17:00:00Z'))).toBe('2026-09-19');
  expect(nextMidnightDelay(new Date('2026-09-18T16:59:59Z'))).toBe(1000);
  expect(nextMidnightDelay(at('2026-09-19'))).toBe(86400000);
});
it('backfills19th at startup and catches up skipped days without changing existing dates', async () => {
  const dir = await directory();
  const env = { LABSD_DEMO_DAILY_CHART_FILL_ENABLED: '1', LABSD_HOSTED_DATA_DIR: dir };
  expect(await fillThroughToday(env, at('2026-09-19'))).toMatchObject({
    changed: true,
    through: '2026-09-19',
    rows: 5,
  });
  const before = await readFile(resolve(dir, FILL_FILE), 'utf8');
  expect(await fillThroughToday(env, at('2026-09-19'))).toMatchObject({ changed: false });
  expect(await readFile(resolve(dir, FILL_FILE), 'utf8')).toBe(before);
  await fillThroughToday(env, at('2026-09-22'));
  const data = await readDailyFill(dir);
  expect(data.rows).toHaveLength(20);
  expect(data.rows.slice(0, 5)).toEqual(JSON.parse(before).rows);
  expect(data.rows.every((r) => r.date <= '2026-09-22')).toBe(true);
});
it('flag off performs no filesystem write even without a directory', async () => {
  expect(await fillThroughToday({}, at('2026-09-19'))).toEqual({ enabled: false, changed: false });
});
it('rejects malformed dates and bounds horizon while preserving pre-start emptiness', () => {
  expect(() => generateDailyFill('2026-02-30')).toThrow();
  expect(() => generateDailyFill('2099-01-01')).toThrow();
  expect(generateDailyFill('2026-09-18').rows).toEqual([]);
});
function base() {
  const data = overviewFixture(
    { from: '2026-09-18', toExclusive: '2026-09-21', brand: null },
    'empty',
  );
  data.earnings.coverage = coverageForPeriod(data.earnings.period, [
    {
      from: '2026-09-18T00:00:00+07:00',
      toExclusive: '2026-09-19T00:00:00+07:00',
      timezone: 'Asia/Bangkok',
    },
  ]);
  return Overview.parse(data);
}
it('fills only missing eligible dates and reconciles per-brand sums without changing the source', () => {
  const original = base();
  const copy = JSON.stringify(original);
  const fill = generateDailyFill('2026-09-19');
  const all = applyDailyChartFill(original, fill, null);
  expect(all.earnings.trend.map((p) => p.date)).toEqual(['2026-09-19']);
  const sum = fill.rows.reduce((n, r) => n + BigInt(r.minor), 0n);
  expect(all.earnings.confirmed?.minor).toBe(String(sum));
  const brands = ['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova'];
  expect(
    brands.reduce(
      (n, b) => n + BigInt(applyDailyChartFill(original, fill, b).earnings.confirmed!.minor),
      0n,
    ),
  ).toBe(sum);
  expect(all.obligation).toEqual(original.obligation);
  expect(JSON.stringify(original)).toBe(copy);
  expect(applyDailyChartFill(original, fill, 'unknown')).toBe(original);
  expect(Overview.safeParse(all).success).toBe(true);
});
it('preserves explicit source zeros and complete covered zero days', () => {
  const original = base();
  const fill = generateDailyFill('2026-09-19');
  original.earnings.coverage = coverageForPeriod(original.earnings.period, [
    { ...original.earnings.period, toExclusive: '2026-09-20T00:00:00+07:00' },
  ]);
  expect(applyDailyChartFill(original, fill, null)).toBe(original);
  original.earnings.trend = [{ date: '2026-09-19', amount: { currency: 'THB', minor: '0' } }];
  expect(applyDailyChartFill(original, fill, null)).toBe(original);
});
it('disabled/unavailable endpoint returns exact original transport result', async () => {
  const original = base();
  const source = vi.fn().mockResolvedValue(original);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  const transport = createDailyChartFillTransport(source);
  expect(
    await transport({
      filters: { from: '2026-09-18', toExclusive: '2026-09-21', brand: null },
      scope: { userId: 'u', partnerId: 'p', permissionRevision: '1' },
      signal: new AbortController().signal,
    }),
  ).toBe(original);
});

it('fills the exact gap in the real demo projection without changing headline or Wallet projection', async () => {
  const { buildDataset } = await import('../../dev/demo-dataset/dataset');
  const { projectOverview } = await import('../../dev/demo-dataset/projections');
  const dataset = buildDataset({
    asOf: new Date('2026-09-18T10:00:00+07:00'),
    anchorDate: '2026-09-18',
  });
  const original = projectOverview(dataset, { from: '2026-09-13', toExclusive: '2026-09-20' });
  const headline = projectOverview(dataset, { from: '2026-07-01', toExclusive: '2026-09-01' });
  const before = JSON.stringify(dataset);
  const result = applyDailyChartFill(original, generateDailyFill('2026-09-19'), null);
  expect(result.earnings.trend.find((p) => p.date === '2026-09-19')?.amount.minor).toMatch(
    /^[1-9]\d+$/,
  );
  expect(result.earnings.trend.filter((p) => p.date < '2026-09-19')).toEqual(
    original.earnings.trend,
  );
  expect(result.obligation).toEqual(original.obligation);
  expect(JSON.stringify(dataset)).toBe(before);
  expect(projectOverview(dataset, { from: '2026-07-01', toExclusive: '2026-09-01' })).toEqual(
    headline,
  );
});
