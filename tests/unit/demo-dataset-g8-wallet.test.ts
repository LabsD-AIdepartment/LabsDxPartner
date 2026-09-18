import { describe, expect, it } from 'vitest';
import { buildDataset, validateDataset, DATASET_IDS } from '../../dev/demo-dataset/dataset';
import { bootstrapWithdrawal } from '../../dev/demo-dataset/bootstrap';
import { datasetScope } from '../../dev/demo-dataset/scope';
import { projectDocument } from '../../dev/demo-dataset/projections';
const asOf = new Date('2026-09-18T14:30:00+07:00');
const normalize = (rows: { generation: string }[]) => rows.map(({ generation, ...row }) => row);
describe('g8 sample Wallet activity', () => {
  it.each(['a', 'b'] as const)(
    'keeps %s balances and evidence coherent with varied activity',
    (identity) => {
      const options = { datasetId: DATASET_IDS[identity], asOf };
      const old = validateDataset(buildDataset({ ...options, generation: 'g7' }));
      const next = validateDataset(buildDataset({ ...options, generation: 'g8' }));
      for (const key of [
        'earnings',
        'allocations',
        'clips',
        'statements',
        'deductions',
        'beneficiaryAccounts',
      ] as const)
        expect(normalize(next[key] ?? [])).toEqual(normalize(old[key] ?? []));
      expect(next.withdrawals.map((w) => w.requestRef)).toEqual(
        old.withdrawals.map((w) => w.requestRef),
      );
      expect(next.withdrawals.map((w) => w.status)).toEqual(old.withdrawals.map((w) => w.status));
      expect(new Set(next.withdrawals.map((w) => w.grossMinor)).size).toBe(5);
      expect(
        next.withdrawals
          .filter((w) => w.status === 'paid')
          .reduce((s, w) => s + BigInt(w.grossMinor), 0n),
      ).toBe(10000000n);
      expect(next.withdrawals.find((w) => w.status === 'requested')?.grossMinor).toBe('2500000');
      for (const settlement of next.settlements) {
        const withdrawal = next.withdrawals.find((w) => w.requestRef === settlement.withdrawalRef)!;
        expect(settlement.cashMinor).toBe(withdrawal.netMinor);
        expect(settlement.obligationSettledMinor).toBe(withdrawal.grossMinor);
        expect(settlement.recordedAt).toBe(withdrawal.paidAt);
        expect(
          projectDocument(next, 'statement-1', `${settlement.settlementId}-evidence`),
        ).toContain(`cash_satang,${withdrawal.netMinor}`);
      }
      const boot = bootstrapWithdrawal(next, datasetScope(next, identity));
      expect(boot.initialState.requests.map((r) => r.gross.minor)).toEqual(
        next.withdrawals.map((w) => w.grossMinor),
      );
      expect(buildDataset({ ...options, generation: 'g7' })).toEqual(old);
      expect(buildDataset({ ...options, generation: 'g8' })).toEqual(next);
    },
  );
});
