import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  validateDataset,
  DatasetValidationError,
  maskCoversFullAccount,
  beneficiaryForGeneration,
  DEMO_BENEFICIARY,
  DEMO_BENEFICIARY_G4,
  type DatasetRecords,
} from '../../dev/demo-dataset/dataset';
import {
  bootstrapWithdrawal,
  beneficiaryRevealEntriesFromDataset,
  SEED_BENEFICIARY_VERSION,
} from '../../dev/demo-dataset/bootstrap';
import { datasetScope } from '../../dev/demo-dataset/scope';

const ASOF = new Date('2026-09-17T02:00:00Z'); // Bangkok anchor 2026-09-17 (same window as g3)
const g4 = (identity: 'a' | 'b' = 'a'): DatasetRecords =>
  buildDataset({ datasetId: `partner-demo-${identity}`, generation: 'g4', asOf: ASOF });
const g3 = (): DatasetRecords =>
  buildDataset({ datasetId: 'partner-demo-a', generation: 'g3', asOf: ASOF });

describe('demo-dataset synthetic beneficiary account (g4)', () => {
  it('authors one synthetic reveal record with the realistic bank + consistent mask', () => {
    const data = g4();
    expect(data.beneficiaryAccounts).toHaveLength(1);
    const row = data.beneficiaryAccounts![0];
    expect(row.bankName).toBe('ธนาคารกสิกรไทย');
    expect(row.fullAccount).toBe('1234512345');
    expect(row.maskedAccount).toBe('XXX-X-X1234-5');
    expect(row.synthetic).toBe(true);
    // Every seeded withdrawal snapshot carries the SAME realistic bank/mask (data ownership).
    for (const w of data.withdrawals) {
      expect(w.bankName).toBe('ธนาคารกสิกรไทย');
      expect(w.maskedAccount).toBe(row.maskedAccount);
    }
  });

  it('keeps g3 (default) on its old bank and authors NO reveal record', () => {
    const data = g3();
    expect(data.beneficiaryAccounts ?? []).toHaveLength(0);
    expect(data.withdrawals[0].bankName).toBe('ธนาคารตัวอย่าง');
    expect(beneficiaryForGeneration('g3')).toEqual(DEMO_BENEFICIARY);
    expect(beneficiaryForGeneration('g4')).toEqual(DEMO_BENEFICIARY_G4);
  });

  it('clones g3 monetary facts — only the beneficiary differs', () => {
    // Compare financial shape ONLY, ignoring the generation column and ids.
    const money = (d: DatasetRecords) =>
      JSON.stringify({
        earnings: d.earnings
          .map((e) => [e.earnedDate, e.amountMinor, e.eligibleBaseMinor, e.status, e.released, e.channel])
          .sort(),
        withdrawals: d.withdrawals
          .map((w) => [w.grossMinor, w.netMinor, w.status, w.submittedAt, w.paidAt])
          .sort(),
        settlements: d.settlements.map((s) => [s.cashMinor, s.obligationSettledMinor, s.recordedAt]).sort(),
      });
    expect(money(g4())).toBe(money(g3()));
  });

  it('validates a g4 dataset and reveals its exact reveal entry', () => {
    const data = validateDataset(g4());
    const entries = beneficiaryRevealEntriesFromDataset(data);
    expect(entries).toEqual([
      {
        displayName: DEMO_BENEFICIARY_G4.beneficiaryName,
        bankName: 'ธนาคารกสิกรไทย',
        maskedAccount: 'XXX-X-X1234-5',
        version: SEED_BENEFICIARY_VERSION,
        fullAccount: '1234512345',
      },
    ]);
    // g3 offers no reveal entry.
    expect(beneficiaryRevealEntriesFromDataset(validateDataset(g3()))).toEqual([]);
  });

  it('rejects a corrupt reveal record (inconsistent mask or non-synthetic)', () => {
    const badMask = structuredClone(g4());
    badMask.beneficiaryAccounts![0].maskedAccount = 'XXX-X-X9999-9';
    expect(() => validateDataset(badMask)).toThrow(DatasetValidationError);

    const notSynthetic = structuredClone(g4()) as unknown as { beneficiaryAccounts: unknown[] };
    (notSynthetic.beneficiaryAccounts[0] as { synthetic: boolean }).synthetic = false;
    expect(() => validateDataset(notSynthetic)).toThrow(DatasetValidationError);
  });

  it('bootstraps the seeded beneficiary from the DB rows (per-generation bank)', () => {
    const data = g4();
    const boot = bootstrapWithdrawal(data, datasetScope(data, 'a'));
    expect(boot.scenarioOverride.beneficiary).toMatchObject({
      state: 'known',
      bankName: 'ธนาคารกสิกรไทย',
    });
    expect(boot.initialState.requests[0].beneficiary).toMatchObject({
      bankName: 'ธนาคารกสิกรไทย',
      maskedAccount: 'XXX-X-X1234-5',
      version: SEED_BENEFICIARY_VERSION,
    });
    const old = g3();
    const boot3 = bootstrapWithdrawal(old, datasetScope(old, 'a'));
    expect(boot3.scenarioOverride.beneficiary).toMatchObject({ bankName: 'ธนาคารตัวอย่าง' });
  });

  it('maskCoversFullAccount enforces mechanical consistency', () => {
    expect(maskCoversFullAccount('XXX-X-X1234-5', '1234512345')).toBe(true);
    expect(maskCoversFullAccount('XXX-X-X1234-5', '9999912345')).toBe(true); // hidden digits free
    expect(maskCoversFullAccount('XXX-X-X1234-5', '1234599999')).toBe(false); // revealed tail wrong
    expect(maskCoversFullAccount('XXX-X-X1234-5', '123451234')).toBe(false); // length mismatch
  });
});
