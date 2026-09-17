import { describe, expect, it } from 'vitest';
import { buildDataset, validateDataset, DATASET_IDS } from '../../dev/demo-dataset/dataset';
import { projectOverview } from '../../dev/demo-dataset/projections';
const priorClock = new Date('2026-09-17T10:26:10+07:00');
const nextClock = new Date('2026-09-18T02:34:00+07:00');
const normalize = (rows: { generation: string }[]) => rows.map(({ generation, ...row }) => row);
describe('Sep-18 addition to the approved dataset', () => {
  it.each(Object.values(DATASET_IDS))(
    'preserves every old record in %s and adds one unreleased day',
    (datasetId) => {
      const old = validateDataset(buildDataset({ datasetId, generation: 'g6', asOf: priorClock }));
      const next = validateDataset(buildDataset({ datasetId, generation: 'g7', asOf: nextClock }));
      for (const key of [
        'clips',
        'statements',
        'settlements',
        'withdrawals',
        'deductions',
        'beneficiaryAccounts',
      ] as const)
        expect(normalize(next[key] ?? [])).toEqual(normalize(old[key] ?? []));
      expect(normalize(next.earnings.slice(0, -1))).toEqual(normalize(old.earnings));
      expect(normalize(next.allocations.slice(0, -1))).toEqual(normalize(old.allocations));
      expect(next.earnings.at(-1)).toMatchObject({
        earnedDate: '2026-09-18',
        amountMinor: '2145000',
        released: false,
      });
      const closed = { from: '2026-07-01', toExclusive: '2026-09-01' };
      expect({ ...projectOverview(next, closed).earnings, generation: 'g6' }).toEqual(
        projectOverview(old, closed).earnings,
      );
      expect({ ...projectOverview(next, closed).obligation, asOf: old.meta.asOf }).toEqual(
        projectOverview(old, closed).obligation,
      );
      const week = projectOverview(next, { from: '2026-09-12', toExclusive: '2026-09-19' }).earnings
        .trend;
      expect(week).toHaveLength(7);
      const day = projectOverview(next, { from: '2026-09-18', toExclusive: '2026-09-19' }).earnings;
      expect(day.confirmed?.minor).toBe('2145000');
      expect(day.eligibleSales?.minor).toBe('21450000');
      expect(week.find((point) => point.date === '2026-09-18')).toEqual(day.trend[0]);
    },
  );
});
