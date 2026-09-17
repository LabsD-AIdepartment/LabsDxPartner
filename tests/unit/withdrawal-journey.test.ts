import { describe, expect, it } from 'vitest';
import {
  MaskedBeneficiary,
  PayoutBeneficiary,
  WithdrawalQuote,
  WithdrawalScope,
  WithdrawalSubmitResult,
  type WithdrawalQuoteValue,
  type WithdrawalScopeValue,
  type WithdrawalSubmissionValue,
  type WithdrawalSummaryValue,
} from '@/contracts/withdrawal-journey';
import {
  balanceScopeOf,
  formatThbMinor,
  loadWithdrawalQuote,
  loadWithdrawalSummary,
  parseThbAmountToMinor,
  recoverWithdrawal,
  submitWithdrawal,
  withdrawalKeys,
  withdrawalScopeKey,
  WithdrawalResponseError,
  type WithdrawalTransport,
} from '@/features/withdrawals/model';
import { createWithdrawalScenario } from '../../dev/withdrawals/transport';

const scope: WithdrawalScopeValue = {
  userId: 'u1',
  partnerId: 'partner-1',
  permissionRevision: 'perm-1',
  payerId: 'labsd-th',
  currency: 'THB',
  scenario: 'golden',
};
const m = (minor: string) => ({ currency: 'THB' as const, minor });

// =====================================================================================
// Contract shape / invariants
// =====================================================================================

describe('withdrawal-journey contracts', () => {
  it('carries user/partner/permission + payer/currency + scenario in scope', () => {
    expect(WithdrawalScope.parse(scope)).toEqual(scope);
    // Missing payer/scenario is rejected: the scope is never partially formed.
    expect(() => WithdrawalScope.parse({ ...scope, payerId: undefined })).toThrow();
    expect(() => WithdrawalScope.parse({ ...scope, extra: 1 })).toThrow();
  });

  it('keeps beneficiary known/missing/pending distinct and never leaks an account number', () => {
    expect(
      PayoutBeneficiary.parse({
        state: 'known',
        displayName: 'x',
        bankName: 'y',
        maskedAccount: 'XXX-1',
        version: 'v1',
      }).state,
    ).toBe('known');
    expect(PayoutBeneficiary.parse({ state: 'missing', reasons: ['no'] }).state).toBe('missing');
    expect(
      PayoutBeneficiary.parse({ state: 'pending', version: 'v1', reasons: ['wait'] }).state,
    ).toBe('pending');
    // MaskedBeneficiary is a strict object: no raw account field is accepted.
    expect(() =>
      MaskedBeneficiary.parse({
        displayName: 'x',
        bankName: 'y',
        maskedAccount: 'XXX-1',
        version: 'v1',
        accountNumber: '1234567890',
      }),
    ).toThrow();
  });

  it('enforces exact net + deductions == gross on a quoted quote', () => {
    const base = {
      state: 'quoted' as const,
      quoteId: 'q1',
      scope,
      gross: m('500000'),
      deductions: [{ kind: 'withholding_tax' as const, label: 'WHT', amount: m('15000') }],
      availableAfterRequest: m('1500000'),
      beneficiary: { displayName: 'x', bankName: 'y', maskedAccount: 'XXX-1', version: 'ben-1' },
      bindings: { balanceRevision: 'b1', policyRevision: 'p1', beneficiaryVersion: 'ben-1' },
      issuedAt: '2026-09-16T00:00:00Z',
      expiresAt: '2026-09-16T00:05:00Z',
    };
    // 485000 + 15000 == 500000 reconciles.
    expect(WithdrawalQuote.parse({ ...base, net: m('485000') }).state).toBe('quoted');
    // 490000 + 15000 != 500000 is rejected at the boundary — never displayed.
    expect(() => WithdrawalQuote.parse({ ...base, net: m('490000') })).toThrow();
  });

  it('an unavailable quote carries reasons and no amounts to confirm', () => {
    const quote = WithdrawalQuote.parse({
      state: 'unavailable',
      scope,
      gross: m('500000'),
      codes: ['tax_policy_unknown'],
      reasons: ['unknown tax'],
    });
    expect(quote.state).toBe('unavailable');
    if (quote.state === 'unavailable') expect('net' in quote).toBe(false);
  });
});

// =====================================================================================
// Exact-decimal THB parser (BigInt only, never floating point)
// =====================================================================================

describe('parseThbAmountToMinor', () => {
  it('parses whole and fractional THB into exact satang', () => {
    expect(parseThbAmountToMinor('5000')).toEqual({ ok: true, minor: '500000' });
    expect(parseThbAmountToMinor('5000.50')).toEqual({ ok: true, minor: '500050' });
    expect(parseThbAmountToMinor('5000.5')).toEqual({ ok: true, minor: '500050' });
    // One satang.
    expect(parseThbAmountToMinor('0.01')).toEqual({ ok: true, minor: '1' });
    // Grouping separators (comma / spaces) are stripped, digits stay exact.
    expect(parseThbAmountToMinor('5,000')).toEqual({ ok: true, minor: '500000' });
    expect(parseThbAmountToMinor(' 1 000 ')).toEqual({ ok: true, minor: '100000' });
  });

  it('stays exact far beyond Number.MAX_SAFE_INTEGER', () => {
    // 90071992547409.93 THB -> 9007199254740993 satang, exact (2^53 = 9007199254740992).
    expect(parseThbAmountToMinor('90071992547409.93')).toEqual({
      ok: true,
      minor: '9007199254740993',
    });
  });

  it('rejects empty, malformed, over-precise and non-positive amounts distinctly', () => {
    expect(parseThbAmountToMinor('')).toEqual({ ok: false, error: 'empty' });
    expect(parseThbAmountToMinor('abc')).toEqual({ ok: false, error: 'format' });
    expect(parseThbAmountToMinor('1.2.3')).toEqual({ ok: false, error: 'format' });
    expect(parseThbAmountToMinor('-5')).toEqual({ ok: false, error: 'format' });
    expect(parseThbAmountToMinor('1e3')).toEqual({ ok: false, error: 'format' });
    // More than 2 fraction digits is a distinct error, not silently rounded.
    expect(parseThbAmountToMinor('1.005')).toEqual({ ok: false, error: 'too_many_decimals' });
    // Zero is a valid decimal but not a requestable amount.
    expect(parseThbAmountToMinor('0')).toEqual({ ok: false, error: 'not_positive' });
    expect(parseThbAmountToMinor('0.00')).toEqual({ ok: false, error: 'not_positive' });
  });

  it('formats satang back to a THB decimal string exactly', () => {
    expect(formatThbMinor('500000')).toBe('5000.00');
    expect(formatThbMinor('1')).toBe('0.01');
    expect(formatThbMinor('9007199254740993')).toBe('90071992547409.93');
    expect(formatThbMinor('-100000')).toBe('-1000.00');
  });
});

// =====================================================================================
// Scope / query-key helpers
// =====================================================================================

describe('scope and query-key helpers', () => {
  it('derives the W01-A balance scope (partner/payer/currency only)', () => {
    expect(balanceScopeOf(scope)).toEqual({
      partnerId: 'partner-1',
      payerId: 'labsd-th',
      currency: 'THB',
    });
  });

  it('keys carry partner identity + payer/currency/scenario and no earnings date/brand', () => {
    const key = withdrawalScopeKey(scope);
    expect(key).toEqual([
      'withdrawal',
      'u1',
      'partner-1',
      'perm-1',
      'labsd-th',
      'THB',
      'golden',
    ]);
    expect(withdrawalKeys.summary(scope, 'rev-1')).toEqual([...key, 'summary', 'rev-1']);
    expect(withdrawalKeys.quote(scope, '500000', 'rev-1')).toEqual([
      ...key,
      'quote',
      '500000',
      'rev-1',
    ]);
    expect(withdrawalKeys.request(scope, 'idem-1')).toEqual([...key, 'request', 'idem-1']);
  });
});

// =====================================================================================
// Loaders: parse + scope/quote consistency + abort
// =====================================================================================

describe('model loaders validate and guard scope', () => {
  it('loads and validates a summary for the requested scope', async () => {
    const { transport } = createWithdrawalScenario({ scope, latencyMs: 0 });
    const controller = new AbortController();
    const summary = await loadWithdrawalSummary(transport, { scope, signal: controller.signal });
    expect(summary.scope).toEqual(scope);
    expect(summary.balance.state).toBe('known');
    if (summary.balance.state === 'known') expect(summary.balance.available).toEqual(m('2000000'));
  });

  it('rejects a summary that arrives under a different scope', async () => {
    const { transport } = createWithdrawalScenario({ scope, latencyMs: 0 });
    const controller = new AbortController();
    // Ask under a different user: the controller answers for its own scope -> mismatch.
    await expect(
      loadWithdrawalSummary(transport, {
        scope: { ...scope, userId: 'someone-else' },
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a quote whose gross does not match the requested amount', async () => {
    const controller = new AbortController();
    // A response for a different gross must never appear under the requested amount. The
    // controller always echoes the requested gross, so a fake supplies the mismatch.
    const fake: WithdrawalTransport = {
      summary: async () => ({}),
      quote: async () =>
        WithdrawalQuote.parse({
          state: 'unavailable',
          scope,
          gross: m('500000'),
          codes: ['amount_exceeds_available'],
          reasons: ['too much'],
        }),
      submit: async () => ({}),
      recover: async () => ({ state: 'missing' }),
    };
    await expect(
      loadWithdrawalQuote(fake, { scope, grossMinor: '600000', signal: controller.signal }),
    ).rejects.toMatchObject({ reason: 'quote_mismatch' });
  });

  it('propagates an abort as an AbortError and never renders a late response', async () => {
    const { transport } = createWithdrawalScenario({ scope, latencyMs: 50 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadWithdrawalSummary(transport, { scope, signal: controller.signal }),
    ).rejects.toThrow('Aborted');
  });

  it('validates a rejected submit result and a recovery miss', async () => {
    const rejected = WithdrawalSubmitResult.parse({
      outcome: 'rejected',
      code: 'stale_quote',
      detail: 'stale',
    });
    const fake: WithdrawalTransport = {
      summary: async () => ({}),
      quote: async () => ({}),
      submit: async () => rejected,
      recover: async () => ({ state: 'missing' }),
    };
    const controller = new AbortController();
    const result = await submitWithdrawal(fake, {
      submission: {
        scope,
        idempotencyKey: 'idem-1',
        quoteId: 'q1',
        gross: m('500000'),
        net: m('500000'),
        bindings: { balanceRevision: 'b', policyRevision: 'p', beneficiaryVersion: 'v' },
      },
      signal: controller.signal,
    });
    expect(result.outcome).toBe('rejected');
    const recovery = await recoverWithdrawal(fake, {
      scope,
      idempotencyKey: 'idem-1',
      signal: controller.signal,
    });
    expect(recovery.state).toBe('missing');
  });
});

// =====================================================================================
// F02 — response/request identity is fully checked (scope, nested balance, echoed command,
// honest null readiness bindings, request coherence)
// =====================================================================================

function submissionFrom(quote: WithdrawalQuoteValue, idempotencyKey: string): WithdrawalSubmissionValue {
  if (quote.state !== 'quoted') throw new Error('quote is not confirmable');
  return {
    scope: quote.scope,
    idempotencyKey,
    quoteId: quote.quoteId,
    gross: quote.gross,
    net: quote.net,
    bindings: quote.bindings,
  };
}

async function realSummary(): Promise<WithdrawalSummaryValue> {
  const { transport } = createWithdrawalScenario({ scope, latencyMs: 0 });
  const ac = new AbortController();
  return (await transport.summary({ scope, signal: ac.signal })) as WithdrawalSummaryValue;
}

const fakeFrom = (over: Partial<WithdrawalTransport>): WithdrawalTransport => ({
  summary: async () => ({}),
  quote: async () => ({}),
  submit: async () => ({}),
  recover: async () => ({ state: 'missing' }),
  ...over,
});

describe('F02 response identity checks', () => {
  it('rejects a summary envelope carrying a foreign nested balance scope', async () => {
    const real = await realSummary();
    const tampered = structuredClone(real);
    tampered.balance.scope.payerId = 'someone-elses-payer';
    const ac = new AbortController();
    await expect(
      loadWithdrawalSummary(fakeFrom({ summary: async () => tampered }), { scope, signal: ac.signal }),
    ).rejects.toMatchObject({ reason: 'scope_mismatch' });
  });

  it('accepts an honest blocked summary with NULL expected revision/beneficiary version', async () => {
    const real = await realSummary();
    const honest = structuredClone(real);
    // W01-B makes these nullable: an unresolved current revision/version is an honest unknown,
    // not a substituted-freshness error.
    honest.readiness.context.expectedBalanceRevision = null;
    honest.readiness.context.expectedVersions.beneficiary = null;
    const ac = new AbortController();
    const summary = await loadWithdrawalSummary(fakeFrom({ summary: async () => honest }), {
      scope,
      signal: ac.signal,
    });
    expect(summary.readiness.context.expectedBalanceRevision).toBeNull();
  });

  it('still rejects a NON-NULL readiness revision that disagrees with the known snapshot', async () => {
    const real = await realSummary();
    const tampered = structuredClone(real);
    tampered.readiness.context.expectedBalanceRevision = 'a-different-revision';
    const ac = new AbortController();
    await expect(
      loadWithdrawalSummary(fakeFrom({ summary: async () => tampered }), { scope, signal: ac.signal }),
    ).rejects.toMatchObject({ reason: 'identity_mismatch' });
  });

  it('rejects a same-scope submit result that does not echo the command identity', async () => {
    const { controller } = createWithdrawalScenario({ scope, latencyMs: 0 });
    const submission = submissionFrom(controller.quote('500000'), 'idem-1');
    const real = controller.submit(submission);
    if (real.outcome === 'rejected') throw new Error('unexpected reject');
    const tampered = { outcome: 'accepted' as const, request: { ...real.request, idempotencyKey: 'foreign-key' } };
    const ac = new AbortController();
    await expect(
      submitWithdrawal(fakeFrom({ submit: async () => tampered }), { submission, signal: ac.signal }),
    ).rejects.toMatchObject({ reason: 'identity_mismatch' });
  });

  it('rejects a submit result whose request net + deductions do not reconcile to gross', async () => {
    const { controller } = createWithdrawalScenario({ scope, latencyMs: 0 });
    const submission = submissionFrom(controller.quote('500000'), 'idem-1');
    const real = controller.submit(submission);
    if (real.outcome === 'rejected') throw new Error('unexpected reject');
    // Gross/net still echo the command (identity passes), but a phantom deduction breaks the
    // net + Σ deductions == gross invariant — caught by the coherence guard, not identity.
    const incoherent = {
      outcome: 'accepted' as const,
      request: {
        ...real.request,
        deductions: [{ kind: 'transfer_fee' as const, label: 'phantom', amount: m('100') }],
      },
    };
    const ac = new AbortController();
    await expect(
      submitWithdrawal(fakeFrom({ submit: async () => incoherent }), { submission, signal: ac.signal }),
    ).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('rejects a recovered record that does not match a supplied handle', async () => {
    const { controller } = createWithdrawalScenario({ scope, latencyMs: 0 });
    const submission = submissionFrom(controller.quote('500000'), 'idem-real');
    const real = controller.submit(submission);
    if (real.outcome === 'rejected') throw new Error('unexpected reject');
    const found = { state: 'found' as const, request: real.request };
    const ac = new AbortController();
    // The record is in-scope and coherent, but the caller asked for a DIFFERENT key.
    await expect(
      recoverWithdrawal(fakeFrom({ recover: async () => found }), {
        scope,
        idempotencyKey: 'not-this-key',
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ reason: 'identity_mismatch' });
  });
});

// =====================================================================================
// F06 — parser rejects malformed grouping and enforces the shared Money bound
// =====================================================================================

describe('F06 parser grouping grammar and Money bound', () => {
  it('rejects malformed grouping instead of silently reinterpreting it', () => {
    // "1,5" must NOT become 15 THB and "1 2" must NOT become 12 THB.
    expect(parseThbAmountToMinor('1,5')).toEqual({ ok: false, error: 'format' });
    expect(parseThbAmountToMinor('1 2')).toEqual({ ok: false, error: 'format' });
    expect(parseThbAmountToMinor('12,3456')).toEqual({ ok: false, error: 'format' });
    // Well-formed thousands grouping with a fraction stays exact.
    expect(parseThbAmountToMinor('1,000.50')).toEqual({ ok: true, minor: '100050' });
  });

  it('accepts the exact 40-digit Minor boundary and rejects an over-wide amount', () => {
    // 38 major digits + 2 fraction digits => exactly a 40-digit satang value (Minor max is 40).
    const major40 = '9'.repeat(38);
    expect(parseThbAmountToMinor(`${major40}.99`)).toEqual({ ok: true, minor: '9'.repeat(40) });
    // A 41-digit major amount would need a 43-digit satang value — beyond the Money contract.
    expect(parseThbAmountToMinor('1'.repeat(41))).toEqual({ ok: false, error: 'too_large' });
  });
});
