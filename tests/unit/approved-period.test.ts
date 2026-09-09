import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseApprovedPeriod } from '@/server/adapters/approved-period/parse';
import {
  ApprovedPeriodFile,
  ApprovalContext,
  INTAKE_LIMITS,
  entitlementKey,
} from '@/server/adapters/approved-period/schema';
import type { z } from 'zod';

const period = {
  from: '2026-07-01T00:00:00+07:00',
  toExclusive: '2026-08-01T00:00:00+07:00',
  timezone: 'Asia/Bangkok' as const,
};
function sample() {
  const entitlement = {
    authority: 'erp',
    account: 'labsd',
    reference: 'order-1',
    line: 'line-1',
    right: 'sale-commission',
  };
  const file: z.infer<typeof ApprovedPeriodFile> = {
    schema: 'approved-period/1',
    mode: 'complete-snapshot',
    partnerId: 'partner-1',
    period,
    currency: 'THB',
    sources: [
      {
        id: 'approved-export',
        account: 'labsd',
        authority: 'erp',
        canonicalAccount: 'labsd',
        revision: 'snapshot-2',
        asOf: '2026-08-01T00:00:00+07:00',
        controls: {
          rows: 1,
          included: 1,
          excluded: 0,
          unresolved: 0,
          eligibleBaseMinor: '15005',
          amountMinor: '1501',
        },
      },
    ],
    rows: [
      {
        disposition: 'included',
        entitlement,
        sourceId: 'approved-export',
        sourceAccount: 'labsd',
        sourceRevision: 'order-revision-7',
        earnedAt: '2026-07-10T12:00:00+07:00',
        evidenceRef: 'source-evidence-1',
        agreementVersion: 'agreement-3',
        attribution: { kind: 'partner-only' },
        earning: {
          kind: 'commission',
          groupRef: 'group-1',
          sku: 'sku-1',
          channel: 'direct',
          baseMinor: '15005',
          ratePpm: 100_000,
          amountMinor: '1501',
        },
      },
    ],
  };
  const context: z.infer<typeof ApprovalContext> = {
    fileSha256: digest(JSON.stringify(file)),
    approvalRef: 'finance-approval-1',
    partnerId: file.partnerId,
    period,
    currency: 'THB',
    sources: structuredClone(file.sources),
    groups: [
      {
        id: 'group-1',
        right: 'sale-commission',
        agreementVersion: 'agreement-3',
        agreementEvidenceRef: 'agreement-evidence-1',
        policyRef: 'basis-policy-1',
        effective: period,
        calculationWindow: period,
        rounding: { mode: 'per-line', tieBreak: 'half-away-from-zero', allocation: 'none' },
        ratePpm: 100_000,
        skus: ['sku-1'],
        channels: ['direct'],
        rows: 1,
        baseMinor: '15005',
        amountMinor: '1501',
      },
    ],
    amounts: [],
    exclusions: [],
    attributions: [],
  };
  return { file, context };
}
function included(s: ReturnType<typeof sample>, index = 0) {
  const row = s.file.rows[index];
  if (row.disposition !== 'included') throw new Error('test fixture expected included');
  return row;
}
function digest(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}
// Test-only approval authority: each scenario explicitly approves its fixture bytes.
// Production callers must load the previously approved digest from a separate repository.
function run(s: ReturnType<typeof sample>) {
  const raw = JSON.stringify(s.file);
  return parseApprovedPeriod(raw, { ...s.context, fileSha256: digest(raw) });
}
function code(s: ReturnType<typeof sample>) {
  const result = run(s);
  return result.ok ? 'ok' : result.issues[0].code;
}
function controls(
  s: ReturnType<typeof sample>,
  patch: Partial<(typeof s.file.sources)[0]['controls']>,
) {
  Object.assign(s.file.sources[0].controls, patch);
  s.context.sources = structuredClone(s.file.sources);
}

describe('approved-period intake trust and exact accounting', () => {
  it('retains exact half-satang rounding, separate revisions and draft-only authority', () => {
    const result = run(sample());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      kind: 'validated-draft',
      publicationReady: false,
      blockers: [],
    });
    expect(result.data.rows[0].sourceRevision).toBe('order-revision-7');
    expect(result.data.sources[0].revision).toBe('snapshot-2');
  });
  it.each(['email', 'approved', 'status', 'customerName'])(
    'rejects undeclared %s instead of promoting file authority',
    (key) => {
      const s = sample();
      expect(
        parseApprovedPeriod(
          JSON.stringify({ ...s.file, [key]: 'sensitive arbitrary text' }),
          s.context,
        ),
      ).toEqual({ ok: false, issues: [{ code: 'invalid_schema' }] });
    },
  );
  it('rejects omitted trusted context even if the file contains an approval flag', () => {
    expect(parseApprovedPeriod(JSON.stringify(sample().file), undefined)).toEqual({
      ok: false,
      issues: [{ code: 'invalid_approval_context' }],
    });
  });
  it('rejects changed evidence despite unchanged counts and money against the original approved hash', () => {
    const s = sample();
    s.file.rows[0].evidenceRef = 'forged-evidence';
    expect(parseApprovedPeriod(JSON.stringify(s.file), s.context)).toEqual({
      ok: false,
      issues: [{ code: 'snapshot_mismatch' }],
    });
  });
  it.each(['1.01', '01', '-0', '1e3', '9007199254740993.0'])(
    'rejects noncanonical minor %s',
    (amount) => {
      const s = sample();
      included(s).earning.amountMinor = amount;
      expect(code(s)).toBe('invalid_schema');
    },
  );
  it('rejects non-THB and partial snapshot formats', () => {
    const s = sample();
    for (const patch of [{ currency: 'USD' }, { mode: 'incremental' }]) {
      expect(parseApprovedPeriod(JSON.stringify({ ...s.file, ...patch }), s.context).ok).toBe(
        false,
      );
    }
  });
  it('bounds bytes before parsing and does not reflect input in errors', () => {
    expect(parseApprovedPeriod('x'.repeat(INTAKE_LIMITS.bytes + 1), {})).toEqual({
      ok: false,
      issues: [{ code: 'input_too_large' }],
    });
    expect(parseApprovedPeriod('{secret:', {})).toEqual({
      ok: false,
      issues: [{ code: 'invalid_json' }],
    });
    expect(
      parseApprovedPeriod(JSON.stringify({ rows: Array(INTAKE_LIMITS.rows + 1).fill(null) }), {}),
    ).toEqual({ ok: false, issues: [{ code: 'invalid_schema' }] });
  });
  it('rejects foreign partner and period despite internally balanced totals', () => {
    const s = sample();
    s.file.partnerId = 'partner-2';
    expect(code(s)).toBe('scope_mismatch');
    s.file.partnerId = s.context.partnerId;
    s.file.period = { ...period, toExclusive: '2026-07-31T00:00:00+07:00' };
    expect(code(s)).toBe('scope_mismatch');
  });
  it('requires independent controls, source revision and coverage', () => {
    const s = sample();
    s.file.sources[0].controls.amountMinor = '0';
    expect(code(s)).toBe('source_mismatch');
    s.file.sources = structuredClone(s.context.sources);
    s.file.sources[0].revision = 'older';
    expect(code(s)).toBe('source_mismatch');
    s.file.sources = structuredClone(s.context.sources);
    s.context.sources.push({ ...s.context.sources[0], id: 'another-feed' });
    expect(code(s)).toBe('source_mismatch');
  });
  it('rejects duplicate source and approval identifiers', () => {
    const s = sample();
    s.context.sources.push(structuredClone(s.context.sources[0]));
    expect(code(s)).toBe('invalid_approval_context');
    const t = sample();
    t.context.groups.push(structuredClone(t.context.groups[0]));
    expect(code(t)).toBe('invalid_approval_context');
  });
  it('does not pay a mirrored entitlement again under another delivery or revision', () => {
    const s = sample();
    const mirror = { ...s.file.sources[0], id: 'chatmesh' };
    s.file.sources.push(mirror);
    s.context.sources = structuredClone(s.file.sources);
    s.file.rows.push({
      ...structuredClone(s.file.rows[0]),
      sourceId: 'chatmesh',
      sourceRevision: 'different',
    });
    expect(code(s)).toBe('duplicate_entitlement');
  });
  it('uses unambiguous canonical tuples independent of transport', () => {
    const e = sample().file.rows[0].entitlement;
    expect(entitlementKey({ ...e, reference: 'a:b', line: 'c' })).not.toBe(
      entitlementKey({ ...e, reference: 'a', line: 'b:c' }),
    );
  });
  it('requires the approved account and excludes the end instant', () => {
    const s = sample();
    s.file.rows[0].entitlement.account = 'other';
    expect(code(s)).toBe('source_mismatch');
    s.file.rows[0].entitlement.account = 'labsd';
    s.file.rows[0].earnedAt = period.toExclusive;
    expect(code(s)).toBe('outside_period');
  });
  it('does not accept a complete-period claim when the source snapshot predates period end', () => {
    const s = sample();
    s.file.sources[0].asOf = period.from;
    s.context.sources = structuredClone(s.file.sources);
    expect(code(s)).toBe('source_mismatch');
  });
  it('rejects invented rates, rights, SKUs and agreement versions', () => {
    for (const mutation of ['rate', 'right', 'sku', 'agreement']) {
      const s = sample(),
        row = included(s);
      if (row.earning.kind !== 'commission') throw new Error();
      if (mutation === 'rate') row.earning.ratePpm = 30000;
      if (mutation === 'right') row.entitlement.right = 'another-right';
      if (mutation === 'sku') row.earning.sku = 'another-sku';
      if (mutation === 'agreement') row.agreementVersion = 'another-agreement';
      expect(code(s)).toBe('unapproved_rule');
    }
  });
  it('rejects incomplete calculation windows and expired agreements', () => {
    const s = sample();
    s.context.groups[0].calculationWindow = { ...period, from: '2026-06-01T00:00:00+07:00' };
    expect(code(s)).toBe('incomplete_calculation_window');
    const t = sample();
    t.context.groups[0].effective = { ...period, from: '2026-07-15T00:00:00+07:00' };
    expect(code(t)).toBe('incomplete_calculation_window');
  });
  it('does not trust matching source totals when commission math is wrong', () => {
    const s = sample();
    included(s).earning.amountMinor = '1500';
    controls(s, { amountMinor: '1500' });
    s.context.groups[0].amountMinor = '1500';
    expect(code(s)).toBe('calculation_mismatch');
  });
  it('reconciles full control counts and exact values above JS integer precision', () => {
    const s = sample();
    const row = included(s);
    if (row.earning.kind !== 'commission') throw new Error();
    row.earning.baseMinor = '90071992547409930';
    row.earning.amountMinor = '9007199254740993';
    Object.assign(s.context.groups[0], {
      baseMinor: row.earning.baseMinor,
      amountMinor: row.earning.amountMinor,
    });
    controls(s, { eligibleBaseMinor: row.earning.baseMinor, amountMinor: row.earning.amountMinor });
    expect(code(s)).toBe('ok');
    controls(s, { rows: 2 });
    expect(code(s)).toBe('control_mismatch');
  });
  it('allocates period rounding once across source deliveries, invariant to row order', () => {
    const s = sample();
    const row = included(s);
    if (row.earning.kind !== 'commission') throw new Error();
    Object.assign(row.earning, { baseMinor: '5', amountMinor: '1' });
    const second = structuredClone(row);
    second.entitlement.reference = 'order-2';
    second.sourceId = 'other-export';
    second.earning.amountMinor = '0';
    s.file.rows.push(second);
    controls(s, { eligibleBaseMinor: '5', amountMinor: '1' });
    s.file.sources.push({
      ...structuredClone(s.file.sources[0]),
      id: 'other-export',
      controls: { ...s.file.sources[0].controls, amountMinor: '0' },
    });
    s.context.sources = structuredClone(s.file.sources);
    Object.assign(s.context.groups[0], {
      rows: 2,
      baseMinor: '10',
      amountMinor: '1',
      rounding: {
        mode: 'per-period',
        tieBreak: 'half-away-from-zero',
        allocation: 'largest-remainder-stable-id',
      },
    });
    expect(code(s)).toBe('ok');
    s.file.rows.reverse();
    expect(code(s)).toBe('ok');
    included(s, 0).earning.amountMinor = '1';
    expect(code(s)).toBe('calculation_mismatch');
  });
  it('requires independent attribution and does not silently downgrade a known mapping', () => {
    const s = sample();
    const row = included(s);
    row.attribution = { kind: 'content', contentId: 'clip-1', evidenceRef: 'mapping-1' };
    expect(code(s)).toBe('unapproved_attribution');
    s.context.attributions.push({
      entitlement: row.entitlement,
      contentId: 'clip-1',
      evidenceRef: 'mapping-1',
    });
    expect(code(s)).toBe('ok');
    row.attribution = { kind: 'partner-only' };
    expect(code(s)).toBe('unapproved_attribution');
  });
  it.each(['fixed-fee', 'bonus', 'adjustment'] as const)(
    'requires a distinct approved %s and retains adjustment history gate',
    (kind) => {
      const s = sample(),
        row = included(s);
      row.earning =
        kind === 'adjustment'
          ? {
              kind,
              approvalRef: 'approved-amount-1',
              amountMinor: '-50',
              originalLineRef: 'issued-line-1',
              reasonRef: 'refund-1',
            }
          : { kind, approvalRef: 'approved-amount-1', amountMinor: '12345' };
      s.context.groups = [];
      controls(s, { eligibleBaseMinor: '0', amountMinor: row.earning.amountMinor });
      expect(code(s)).toBe('unapproved_amount');
      if (row.earning.kind === 'commission') throw new Error('expected fixed approved amount');
      s.context.amounts.push({
        entitlement: row.entitlement,
        agreementVersion: row.agreementVersion,
        earnedAt: row.earnedAt,
        evidenceRef: row.evidenceRef,
        earning: row.earning,
      });
      const result = run(s);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.blockers).toEqual(
          kind === 'adjustment' ? [{ code: 'original_history_required', row: 0 }] : [],
        );
    },
  );
  it('distinguishes approved exclusions from unresolved rows without treating unknown as zero payable', () => {
    const s = sample(),
      { agreementVersion: _a, attribution: _b, earning: _c, ...base } = included(s);
    s.file.rows = [
      { ...base, disposition: 'excluded', reasonRef: 'returned', approvalRef: 'exclusion-1' },
    ];
    s.context.groups = [];
    controls(s, { included: 0, excluded: 1, eligibleBaseMinor: '0', amountMinor: '0' });
    expect(code(s)).toBe('unapproved_exclusion');
    s.context.exclusions.push({
      entitlement: base.entitlement,
      reasonRef: 'returned',
      approvalRef: 'exclusion-1',
    });
    expect(code(s)).toBe('ok');
    s.context.exclusions = [];
    s.file.rows = [{ ...base, disposition: 'unresolved', reasonRef: 'missing-basis' }];
    controls(s, { excluded: 0, unresolved: 1 });
    expect(run(s)).toMatchObject({
      ok: true,
      publicationReady: false,
      blockers: [{ code: 'unresolved_row', row: 0 }],
    });
  });
  it('requires explicit complete zero controls for an empty period', () => {
    const s = sample();
    s.file.rows = [];
    s.context.groups = [];
    expect(code(s)).toBe('control_mismatch');
    controls(s, { rows: 0, included: 0, eligibleBaseMinor: '0', amountMinor: '0' });
    expect(code(s)).toBe('ok');
  });
  it('retains a signed approved base with exact negative tie rounding', () => {
    const s = sample(),
      row = included(s);
    if (row.earning.kind !== 'commission') throw new Error();
    Object.assign(row.earning, { baseMinor: '-15005', amountMinor: '-1501' });
    Object.assign(s.context.groups[0], { baseMinor: '-15005', amountMinor: '-1501' });
    controls(s, { eligibleBaseMinor: '-15005', amountMinor: '-1501' });
    expect(code(s)).toBe('ok');
  });
  it('accepts an explicitly approved zero rate but never supplies one if missing', () => {
    const s = sample(),
      row = included(s);
    if (row.earning.kind !== 'commission') throw new Error();
    Object.assign(row.earning, { ratePpm: 0, amountMinor: '0' });
    Object.assign(s.context.groups[0], { ratePpm: 0, amountMinor: '0' });
    controls(s, { amountMinor: '0' });
    expect(code(s)).toBe('ok');
    const raw = JSON.stringify(s.file).replace('"ratePpm":0,', '');
    expect(parseApprovedPeriod(raw, s.context)).toEqual({
      ok: false,
      issues: [{ code: 'invalid_schema' }],
    });
  });
  it('cannot drop a required approved fixed earning or exclusion by changing aggregate controls', () => {
    const s = sample();
    s.context.amounts.push({
      entitlement: { ...s.file.rows[0].entitlement, right: 'fixed' },
      agreementVersion: 'agreement-3',
      earnedAt: s.file.rows[0].earnedAt,
      evidenceRef: 'fixed-evidence',
      earning: { kind: 'fixed-fee', amountMinor: '100', approvalRef: 'fixed-approval' },
    });
    expect(code(s)).toBe('control_mismatch');
  });
});
