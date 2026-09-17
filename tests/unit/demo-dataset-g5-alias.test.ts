// D169 — focused system tests for the numeric-reference g5 generation, the dev navigation alias, and
// the shortened source-period label. These assert:
//   • g5 stores realistic NUMERIC withdrawal references (YYYYMMDD + a 4-digit per-identity sequence),
//     unique within and across the a/b datasets;
//   • g5 preserves the stable legacy withdrawal row.id (so old bookmarks still resolve);
//   • g5's financial facts are byte-for-byte identical to g4 once ONLY the generation column, the
//     withdrawal requestRef, and the settlement.withdrawalRef (which derives it) are stripped;
//   • g5 keeps g4's synthetic KBank beneficiary + reveal verbatim;
//   • the alias resolver is scope-bounded (old row id → stored ref; current ref/g4 ref/unknown/other
//     identity all pass through unchanged);
//   • the bootstrap source-period label is the shortened form with no `(สรุปคอมมิชชัน #1)` suffix.
//
// It intentionally never asserts DEFAULT_GENERATION: the default stays g4 until root seeds + audits g5.

import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  validateDataset,
  beneficiaryForGeneration,
  DEMO_BENEFICIARY_G4,
  maskCoversFullAccount,
  type DatasetRecords,
} from '../../dev/demo-dataset/dataset';
import { resolveWithdrawalRequestRef } from '../../dev/demo-dataset/alias';
import { bootstrapWithdrawal } from '../../dev/demo-dataset/bootstrap';
import { datasetScope } from '../../dev/demo-dataset/scope';

const ASOF = new Date('2026-09-17T02:00:00Z'); // Bangkok anchor 2026-09-17 (same window as g4)
const build = (generation: string, identity: 'a' | 'b' = 'a'): DatasetRecords =>
  buildDataset({ datasetId: `partner-demo-${identity}`, generation, asOf: ASOF });
const g4 = (identity: 'a' | 'b' = 'a') => build('g4', identity);
const g5 = (identity: 'a' | 'b' = 'a') => build('g5', identity);

// Deep clone stripping ONLY the generation column (everywhere), the withdrawal requestRef and the
// settlement.withdrawalRef that derives it — the exact set of fields g5 is allowed to change vs g4.
function stripGenerationAndRefs(d: DatasetRecords) {
  const dropGen = <T extends { generation: string }>(rows: T[]) =>
    rows.map(({ generation: _g, ...rest }) => rest);
  const { generation: _mg, ...meta } = d.meta;
  return {
    meta,
    earnings: dropGen(d.earnings),
    allocations: dropGen(d.allocations),
    clips: dropGen(d.clips),
    statements: dropGen(d.statements),
    settlements: dropGen(d.settlements).map(({ withdrawalRef: _w, ...rest }) => rest),
    withdrawals: dropGen(d.withdrawals).map(({ requestRef: _r, ...rest }) => rest),
    deductions: dropGen(d.deductions).map(({ requestRef: _r, ...rest }) => rest),
    beneficiaryAccounts: dropGen(d.beneficiaryAccounts ?? []),
  };
}

describe('g5 numeric withdrawal references', () => {
  it('validates and stores realistic numeric references for the fixed Sep-17 anchor', () => {
    const data = validateDataset(g5('a'));
    expect(data.withdrawals.map((w) => w.requestRef)).toEqual([
      '202609011001', // paid-1 submitted 2026-09-01
      '202609041002', // paid-2 submitted 2026-09-04
      '202609081003', // paid-3 submitted 2026-09-08
      '202609111004', // paid-4 submitted 2026-09-11
      '202609141005', // pending submitted anchor-3 = 2026-09-14
    ]);
    // Every reference is exactly YYYYMMDD + a 4-digit sequence (no legacy `partner-demo-...` code).
    for (const w of data.withdrawals) expect(w.requestRef).toMatch(/^\d{12}$/);
    const b = validateDataset(g5('b'));
    expect(b.withdrawals.map((w) => w.requestRef)).toEqual([
      '202609012001',
      '202609042002',
      '202609082003',
      '202609112004',
      '202609142005',
    ]);
  });

  it('references are unique within and across the a/b datasets', () => {
    const refs = [...g5('a').withdrawals, ...g5('b').withdrawals].map((w) => w.requestRef);
    expect(new Set(refs).size).toBe(refs.length); // 10 distinct references
  });

  it('preserves the stable legacy withdrawal row.id across generations (alias anchor)', () => {
    const g4Rows = g4('a').withdrawals;
    const g5Rows = g5('a').withdrawals;
    expect(g5Rows.map((w) => w.id)).toEqual(g4Rows.map((w) => w.id));
    // g4's reference IS its row id; g5's is a different numeric value but the id is unchanged.
    expect(g4Rows.at(-1)!.requestRef).toBe('partner-demo-a-wr-pending-1');
    expect(g5Rows.at(-1)!.id).toBe('partner-demo-a-wr-pending-1');
    expect(g5Rows.at(-1)!.requestRef).not.toBe(g5Rows.at(-1)!.id);
  });

  it('every settlement.withdrawalRef derives the stored numeric requestRef', () => {
    const data = g5('a');
    const stored = new Set(data.withdrawals.map((w) => w.requestRef));
    for (const s of data.settlements) {
      expect(s.withdrawalRef).not.toBeNull();
      expect(stored.has(s.withdrawalRef!)).toBe(true);
      expect(s.withdrawalRef).toMatch(/^\d{12}$/);
    }
  });

  it('is byte-for-byte identical to g4 except generation + withdrawal/settlement references', () => {
    expect(stripGenerationAndRefs(g5('a'))).toEqual(stripGenerationAndRefs(g4('a')));
  });

  it('keeps g4 synthetic KBank beneficiary + reveal verbatim', () => {
    expect(beneficiaryForGeneration('g5')).toEqual(DEMO_BENEFICIARY_G4);
    const data = g5('a');
    expect(data.beneficiaryAccounts).toHaveLength(1);
    const acct = data.beneficiaryAccounts![0];
    expect(acct.bankName).toBe('ธนาคารกสิกรไทย');
    expect(acct.fullAccount).toBe('1234512345');
    expect(acct.maskedAccount).toBe('XXX-X-X1234-5');
    expect(acct.synthetic).toBe(true);
    expect(maskCoversFullAccount(acct.maskedAccount, acct.fullAccount)).toBe(true);
    for (const w of data.withdrawals) {
      expect(w.bankName).toBe('ธนาคารกสิกรไทย');
      expect(w.maskedAccount).toBe('XXX-X-X1234-5');
    }
  });
});

describe('resolveWithdrawalRequestRef (dev navigation alias)', () => {
  const dataA = g5('a');
  const pendingRef = dataA.withdrawals.at(-1)!.requestRef; // 202609141005

  it('maps an old bookmarked row id to the current stored numeric reference', () => {
    expect(resolveWithdrawalRequestRef('partner-demo-a-wr-pending-1', dataA)).toBe(pendingRef);
    expect(resolveWithdrawalRequestRef('partner-demo-a-wr-paid-1', dataA)).toBe('202609011001');
  });

  it('passes a current stored numeric reference through unchanged', () => {
    expect(resolveWithdrawalRequestRef('202609011001', dataA)).toBe('202609011001');
    expect(resolveWithdrawalRequestRef(pendingRef, dataA)).toBe(pendingRef);
  });

  it('returns unknown references and null unchanged (no fuzzy match)', () => {
    expect(resolveWithdrawalRequestRef('nope', dataA)).toBe('nope');
    expect(resolveWithdrawalRequestRef(null, dataA)).toBeNull();
    expect(resolveWithdrawalRequestRef('202609011001', null)).toBe('202609011001');
  });

  it('never resolves an id that belongs to another identity/scope', () => {
    // partner-demo-b's row id must NOT resolve against partner-demo-a's dataset.
    expect(resolveWithdrawalRequestRef('partner-demo-b-wr-pending-1', dataA)).toBe(
      'partner-demo-b-wr-pending-1',
    );
  });

  it('leaves a g4 reference (requestRef === row id) unchanged', () => {
    const dataG4 = g4('a');
    expect(resolveWithdrawalRequestRef('partner-demo-a-wr-pending-1', dataG4)).toBe(
      'partner-demo-a-wr-pending-1',
    );
  });
});

describe('bootstrap source-period label is shortened', () => {
  it('drops the `(สรุปคอมมิชชัน #1)` suffix in both the scenario and seeded source context', () => {
    const data = g5('a');
    const boot = bootstrapWithdrawal(data, datasetScope(data, 'a'));
    expect(boot.scenarioOverride.base.sourcePeriods[0].label).toBe('งวด ก.ค.–ส.ค. 2569');
    const context = boot.initialState.requests[0].sourceContext;
    expect(context.state).toBe('known');
    if (context.state !== 'known') throw new Error('Expected known seeded source periods');
    expect(context.periods[0].label).toBe('งวด ก.ค.–ส.ค. 2569');
    const serialized = JSON.stringify(boot);
    expect(serialized).not.toContain('สรุปคอมมิชชัน');
  });
});
