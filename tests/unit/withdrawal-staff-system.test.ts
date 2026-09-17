import { describe, expect, it } from 'vitest';
import { createWithdrawalController } from '../../dev/withdrawals/controller';
import { createWithdrawalTransport } from '../../dev/withdrawals/transport';
import {
  memoryStorage,
  WITHDRAWAL_SCENARIO_MARKER,
  type DevKeyValueStorage,
} from '../../dev/withdrawals/store';
import {
  applyWithdrawalOutcome,
  loadWithdrawalPeriods,
  withdrawalGatewayStatus,
  withdrawalKeys,
  WithdrawalReadError,
} from '@/features/withdrawals/model';
import {
  isStaffPreviewSegments,
  isStaffPreviewView,
  PREVIEW_SCOPE_BASE,
  readStaffRequestLane,
  staffPartnerRoster,
} from '../../dev/withdrawals/navigation';
import type {
  WithdrawalQuoteValue,
  WithdrawalScopeValue,
  WithdrawalSubmissionValue,
  WithdrawalSubmitResultValue,
} from '@/contracts/withdrawal-journey';
import type { ScenarioName } from '../../dev/withdrawals/scenarios';

// WU03 S1 (period/outcome/nav) system tests. Backed by the SAME synthetic controller/runtime as the
// partner; no beneficiary work. Root runs these.

const scope: WithdrawalScopeValue = {
  userId: 'u1',
  partnerId: 'partner-1',
  permissionRevision: 'perm-1',
  payerId: 'labsd-th',
  currency: 'THB',
  scenario: 'golden',
};
const m = (minor: string) => ({ currency: 'THB' as const, minor });
const signal = new AbortController().signal;
function counterId() {
  let n = 0;
  return { next: (p: string) => `${p}-${++n}` };
}
const gscope = (s: ScenarioName = 'golden'): WithdrawalScopeValue => ({ ...scope, scenario: s });
function makeCtl(s: ScenarioName = 'golden', storage?: DevKeyValueStorage) {
  return createWithdrawalController({ scope: gscope(s), storage, idGen: counterId() });
}
function submissionFrom(q: WithdrawalQuoteValue, key: string): WithdrawalSubmissionValue {
  if (q.state !== 'quoted') throw new Error('quote is not confirmable');
  return { scope: q.scope, idempotencyKey: key, quoteId: q.quoteId, gross: q.gross, net: q.net, bindings: q.bindings };
}
function reqRefOf(r: WithdrawalSubmitResultValue): string {
  if (r.outcome === 'rejected') throw new Error(`unexpected submit reject: ${r.detail}`);
  return r.request.requestRef;
}
const storeKey = [WITHDRAWAL_SCENARIO_MARKER, 'golden', 'u1', 'partner-1', 'perm-1', 'labsd-th', 'THB']
  .map(encodeURIComponent)
  .join('::');

// =====================================================================================
// Periods read
// =====================================================================================

describe('WithdrawalPeriodsView loader', () => {
  it('projects current period, base released provenance and eligible releasable (distinct amount)', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const view = await loadWithdrawalPeriods(t, { scope: gscope(), signal });
    expect(view.scope).toEqual(gscope());
    expect(view.currentPeriod?.periodId).toBe('period-2026-09');
    expect(view.currentPeriodPending).toEqual(m('700000'));
    // Base source periods (June + July, authored release times) — released with an amount.
    expect(view.released.map((p) => p.periodId).sort()).toEqual(['period-2026-06', 'period-2026-07']);
    expect(view.released.every((p) => p.releasedAmount !== null && p.releasedAt !== null)).toBe(true);
    // The eligible prior period is `releasable` with `eligibleAmount` — never a "released" amount.
    expect(view.releasable).toEqual([
      { periodId: 'period-2026-08', label: 'งวด สิงหาคม 2569', eligibleAmount: m('1000000') },
    ]);
  });

  it('moves a period from releasable to released once it is released (recorded time)', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    expect(c.releaseNextPeriod()).toBe('period-2026-08');
    const view = await loadWithdrawalPeriods(t, { scope: gscope(), signal });
    expect(view.releasable).toEqual([]);
    const released = view.released.find((p) => p.periodId === 'period-2026-08');
    expect(released?.releasedAmount).toEqual(m('1000000'));
    expect(released?.releasedAt).toBeTypeOf('string'); // an actual recorded release time
  });

  it('accepts a NULL legacy release time (v1-migrated release) without rejecting', async () => {
    const storage = memoryStorage();
    // A genuine v1 blob whose releasedPeriods has no recorded release time.
    const v1 = {
      version: 1,
      scope: gscope(),
      scenario: 'golden',
      requests: [],
      releasedPeriods: ['period-2026-08'],
      controls: { staleQuote: false, changedBeneficiary: false, unknownOutcome: false },
      beneficiaryBump: 0,
      staleBump: 0,
    };
    storage.setItem(storeKey, JSON.stringify(v1));
    const c = makeCtl('golden', storage);
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const view = await loadWithdrawalPeriods(t, { scope: gscope(), signal });
    const migrated = view.released.find((p) => p.periodId === 'period-2026-08');
    expect(migrated).toBeDefined();
    expect(migrated?.releasedAt).toBeNull(); // legacy honesty: unknown time stays null, not rejected
    expect(migrated?.releasedAmount).toEqual(m('1000000'));
  });

  it('rejects a foreign-scope periods read and surfaces a periods read outage', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    await expect(
      loadWithdrawalPeriods(t, { scope: { ...gscope(), payerId: 'other-payer' }, signal }),
    ).rejects.toMatchObject({ reason: 'scope_mismatch' });
    c.setReadError(true);
    await expect(loadWithdrawalPeriods(t, { scope: gscope(), signal })).rejects.toBeInstanceOf(
      WithdrawalReadError,
    );
  });
});

// =====================================================================================
// Outcome simulation command
// =====================================================================================

describe('staff outcome simulation', () => {
  const cmd = (
    requestRef: string,
    expectedRevision: string,
    target: 'processing' | 'paid' | 'failed' | 'reconciling',
    s: WithdrawalScopeValue = gscope(),
  ) => ({ scope: s, requestRef, expectedRevision, target });

  it('applies paid — settles GROSS exactly once (net cash may differ); reconciling retains', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    const res = await applyWithdrawalOutcome(t, {
      command: cmd(ref, c.summary().revision, 'paid'),
      signal,
    });
    expect(res.outcome).toBe('applied');
    if (res.outcome === 'applied') expect(res.request.status).toBe('paid');
    expect(c.summary().balance).toMatchObject({ available: m('1500000'), reserved: m('0'), settled: m('500000') });

    const c2 = makeCtl('golden');
    const t2 = createWithdrawalTransport(c2, { latencyMs: 0 });
    const ref2 = reqRefOf(c2.submit(submissionFrom(c2.quote('500000'), 'k')));
    await applyWithdrawalOutcome(t2, { command: cmd(ref2, c2.summary().revision, 'reconciling'), signal });
    expect(c2.summary().balance).toMatchObject({ available: m('1500000'), reserved: m('500000') });
  });

  it('rejects a stale money revision without mutating (echoing scope + reference)', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    const stale = c.summary().revision;
    c.releaseNextPeriod(); // money revision advances
    const res = await applyWithdrawalOutcome(t, { command: cmd(ref, stale, 'paid'), signal });
    expect(res.outcome).toBe('rejected');
    if (res.outcome === 'rejected') {
      expect(res.code).toBe('stale_revision');
      expect(res.scope).toEqual(gscope());
      expect(res.requestRef).toBe(ref);
    }
    expect(c.summary().balance).toMatchObject({ reserved: m('500000') }); // untouched
  });

  it('rejects an illegal transition, an unknown reference and a foreign scope (typed)', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    c.markPaid(ref); // terminal
    const paidRev = c.summary().revision;
    const illegal = await applyWithdrawalOutcome(t, { command: cmd(ref, paidRev, 'processing'), signal });
    expect(illegal.outcome === 'rejected' && illegal.code).toBe('not_transitionable');
    const missing = await applyWithdrawalOutcome(t, { command: cmd('nope', c.summary().revision, 'paid'), signal });
    expect(missing.outcome === 'rejected' && missing.code).toBe('not_found');
    const foreign = await applyWithdrawalOutcome(t, {
      command: cmd(ref, c.summary().revision, 'paid', { ...gscope(), payerId: 'other-payer' }),
      signal,
    });
    expect(foreign.outcome === 'rejected' && foreign.code).toBe('payer_mismatch');
  });

  it('rejects at the sequence bound BEFORE mutating (capacity_reached)', () => {
    const cell: { raw: string | null } = { raw: null };
    const storage: DevKeyValueStorage = {
      getItem: () => cell.raw,
      setItem: (_k, v) => {
        cell.raw = v;
      },
      removeItem: () => {
        cell.raw = null;
      },
    };
    const seed = makeCtl('golden', storage);
    const ref = reqRefOf(seed.submit(submissionFrom(seed.quote('500000'), 'k')));
    const stored = cell.raw;
    if (stored === null) throw new Error('expected submit to persist withdrawal state');
    const blob = JSON.parse(stored);
    blob.seq = 1_000_000;
    cell.raw = JSON.stringify(blob);
    const c = makeCtl('golden', storage);
    const res = c.applyOutcomeSim({ scope: gscope(), requestRef: ref, expectedRevision: c.summary().revision, target: 'paid' });
    expect(res.outcome === 'rejected' && res.code).toBe('capacity_reached');
    const d = c.detail(ref);
    expect(d.state === 'found' && d.detail.request.status).toBe('processing'); // unchanged (auto-initiated)
  });
});

// =====================================================================================
// P08 reset-epoch fence across the delayed transport
// =====================================================================================

describe('outcome reset-epoch fence', () => {
  it('a stale captured epoch is rejected even for an otherwise fully-valid command', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    const command = { scope: gscope(), requestRef: ref, expectedRevision: c.summary().revision, target: 'paid' as const };
    // Same command, only the captured epoch differs: the epoch fence alone must reject + not mutate.
    const stale = c.applyOutcomeSim(command, c.epoch() + 1);
    expect(stale.outcome === 'rejected' && stale.code).toBe('stale_revision');
    const d = c.detail(ref);
    expect(d.state === 'found' && d.detail.request.status).toBe('processing'); // untouched (auto-initiated)
    // With the current epoch the identical command applies.
    const ok = c.applyOutcomeSim(command, c.epoch());
    expect(ok.outcome).toBe('applied');
  });

  it('a reset during the transport delay stops the in-flight outcome from touching new state', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 20 });
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    const pending = applyWithdrawalOutcome(t, {
      command: { scope: gscope(), requestRef: ref, expectedRevision: c.summary().revision, target: 'paid' },
      signal,
    });
    c.reset(); // epoch advances; requests cleared
    const res = await pending;
    expect(res.outcome).toBe('rejected'); // epoch captured before the reset != current
    expect(c.summary().resume).toEqual([]); // nothing resurrected
    expect(c.summary().balance).toMatchObject({ available: m('2000000') });
  });
});

// =====================================================================================
// Static gateway + keys + navigation helpers
// =====================================================================================

describe('static gateway status', () => {
  it('is a truthful not_connected config with reasons', () => {
    const g = withdrawalGatewayStatus();
    expect(g.state).toBe('not_connected');
    if (g.state === 'not_connected') expect(g.reasons.length).toBeGreaterThan(0);
  });
});

describe('withdrawalKeys.periods', () => {
  it('carries the full scope prefix + periods + revision', () => {
    expect(withdrawalKeys.periods(gscope(), 'rev-9')).toEqual([
      'withdrawal',
      'u1',
      'partner-1',
      'perm-1',
      'labsd-th',
      'THB',
      'golden',
      'periods',
      'rev-9',
    ]);
  });
});

describe('staff navigation helpers', () => {
  it('rosters exactly the allowlisted A/B partner scopes (no arbitrary identity)', () => {
    const roster = staffPartnerRoster('applies-wht');
    expect(roster.map((r) => r.identity)).toEqual(['a', 'b']);
    expect(roster[0].scope).toEqual({
      ...PREVIEW_SCOPE_BASE,
      partnerId: 'SYNTH-withdrawal-partner-a',
      payerId: 'SYNTH-payer-a',
      scenario: 'applies-wht',
    });
    expect(roster[1].scope.payerId).toBe('SYNTH-payer-b');
    // Unknown scenario falls back to golden; no injected string appears in a derived scope.
    const injected = staffPartnerRoster('../secret');
    expect(injected.every((r) => r.scope.scenario === 'golden')).toBe(true);
    expect(JSON.stringify(injected)).not.toContain('secret');
  });

  it('allowlists only /ops-preview/requests and reads the request lane safely', () => {
    expect(isStaffPreviewView('requests')).toBe(true);
    expect(isStaffPreviewView('periods')).toBe(false);
    expect(isStaffPreviewSegments(['requests'])).toBe(true);
    expect(isStaffPreviewSegments(['requests', 'x'])).toBe(false);
    expect(isStaffPreviewSegments(['periods'])).toBe(false);
    expect(readStaffRequestLane('scenario=applies-wht&identity=b&request=wr-2-abc')).toEqual({
      scenario: 'applies-wht',
      identity: 'b',
      requestRef: 'wr-2-abc',
    });
    expect(readStaffRequestLane('scenario=nope&identity=z&request=../bad')).toEqual({
      scenario: 'golden',
      identity: 'a',
      requestRef: null,
    });
  });
});

// =====================================================================================
// S1-F01 — a fresh unread restore must not confidently show fixture/empty/missing
// =====================================================================================

// A storage whose reads can be blocked on demand (throws), WITHOUT deleting the backing bytes.
function blockable(base: DevKeyValueStorage) {
  const state = { blocked: false };
  const storage: DevKeyValueStorage = {
    getItem: (k) => {
      if (state.blocked) throw new Error('synthetic read denied');
      return base.getItem(k);
    },
    setItem: (k, v) => base.setItem(k, v),
    removeItem: (k) => base.removeItem(k),
  };
  return { storage, state };
}

describe('S1-F01 fresh unread restore read guard', () => {
  it('throws a typed read error (not fixture/empty/missing) and recovers actual state on reload', () => {
    const base = memoryStorage();
    // Seed a KNOWN stored request + a released period.
    const seed = makeCtl('golden', base);
    const ref = reqRefOf(seed.submit(submissionFrom(seed.quote('500000'), 'k')));
    expect(seed.releaseNextPeriod()).toBe('period-2026-08');
    const bytesBefore = base.getItem(storeKey);
    // A fresh controller whose restore cannot read storage.
    const { storage, state } = blockable(base);
    state.blocked = true;
    const c = makeCtl('golden', storage);
    // summary stays unavailable (WU02); the staff reads must NOT confidently answer.
    expect(c.summary().balance.state).toBe('unavailable');
    expect(() => c.periods()).toThrow(WithdrawalReadError); // not August-releasable-again
    expect(() => c.list()).toThrow(WithdrawalReadError); // not false-empty
    expect(() => c.detail(ref)).toThrow(WithdrawalReadError); // not false-missing
    // Stored bytes are preserved untouched during the unread restore.
    expect(base.getItem(storeKey)).toBe(bytesBefore);
    // Storage recovers + reload -> the ACTUAL request + released state is restored.
    state.blocked = false;
    c.reload();
    const periods = c.periods();
    expect(periods.released.map((p) => p.periodId)).toContain('period-2026-08');
    expect(periods.releasable).toEqual([]);
    expect(c.list().items.map((x) => x.requestRef)).toContain(ref);
    expect(c.detail(ref).state).toBe('found');
  });

  it('surfaces the unread restore through the staff periods loader as a read error', async () => {
    const base = memoryStorage();
    const seed = makeCtl('golden', base);
    seed.submit(submissionFrom(seed.quote('500000'), 'seed'));
    const { storage, state } = blockable(base);
    state.blocked = true;
    const c = makeCtl('golden', storage);
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    await expect(loadWithdrawalPeriods(t, { scope: gscope(), signal })).rejects.toBeInstanceOf(
      WithdrawalReadError,
    );
  });
});

// =====================================================================================
// S1-F02 — period identity coherence in loadWithdrawalPeriods (no money sums)
// =====================================================================================

describe('S1-F02 period identity coherence', () => {
  const validView = () => ({
    scope: gscope(),
    asOf: '2026-09-16T00:00:00Z',
    currentPeriod: {
      periodId: 'period-2026-09',
      label: 'current',
      from: '2026-09-01T00:00:00+07:00',
      toExclusive: '2026-10-01T00:00:00+07:00',
    },
    currentPeriodPending: m('700000'),
    released: [
      { periodId: 'period-2026-06', label: 'jun', releasedAt: '2026-07-01T00:00:00+07:00', releasedAmount: m('1000000'), statementId: null },
    ],
    releasable: [{ periodId: 'period-2026-08', label: 'aug', eligibleAmount: m('1000000') }],
    revision: 'wr-sum-golden-0',
  });
  // Reuse a real transport but override only `periods` with the supplied (mal)formed view.
  const periodsFake = (view: unknown) => ({
    ...createWithdrawalTransport(makeCtl('golden'), { latencyMs: 0 }),
    periods: async () => view,
  });
  const rejects = (view: unknown) =>
    expect(loadWithdrawalPeriods(periodsFake(view), { scope: gscope(), signal })).rejects.toMatchObject({
      reason: 'invalid',
    });

  it('rejects a duplicate id within released', () =>
    rejects({ ...validView(), released: [validView().released[0], validView().released[0]] }));

  it('rejects a duplicate id within releasable', () =>
    rejects({ ...validView(), releasable: [validView().releasable[0], validView().releasable[0]] }));

  it('rejects a period that is BOTH released and releasable (probe S1-F02)', () =>
    rejects({
      ...validView(),
      released: [{ ...validView().released[0], periodId: 'period-2026-06' }],
      releasable: [{ periodId: 'period-2026-06', label: 'jun', eligibleAmount: m('1000000') }],
    }));

  it('rejects a current period that also appears released or releasable', async () => {
    await rejects({ ...validView(), currentPeriod: { ...validView().currentPeriod, periodId: 'period-2026-06' } });
    await rejects({ ...validView(), currentPeriod: { ...validView().currentPeriod, periodId: 'period-2026-08' } });
  });

  it('rejects a non-increasing current period range', () =>
    rejects({
      ...validView(),
      currentPeriod: { ...validView().currentPeriod, from: '2026-10-01T00:00:00+07:00', toExclusive: '2026-09-01T00:00:00+07:00' },
    }));

  it('accepts legitimate nullable legacy release time/amount and null current pending', async () => {
    const view = {
      ...validView(),
      currentPeriodPending: null,
      released: [{ periodId: 'period-2026-06', label: 'jun', releasedAt: null, releasedAmount: null, statementId: null }],
    };
    const res = await loadWithdrawalPeriods(periodsFake(view), { scope: gscope(), signal });
    expect(res.released[0].releasedAt).toBeNull();
    expect(res.released[0].releasedAmount).toBeNull();
    expect(res.currentPeriodPending).toBeNull();
  });
});

// =====================================================================================
// S1-F03 — unknown source must not render as a known-empty periods snapshot
// =====================================================================================

describe('S1-F03 unknown source periods guard', () => {
  it('refuses periods() for a balance-unknown scenario with a typed read error (not known-empty)', async () => {
    const c = makeCtl('balance-unknown');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    // The balance/source authority stays summary(), which has an honest unavailable arm.
    expect(c.summary().balance.state).toBe('unavailable');
    // periods() must NOT return empty released/releasable (which reads as known-empty).
    expect(() => c.periods()).toThrow(WithdrawalReadError);
    await expect(
      loadWithdrawalPeriods(t, { scope: gscope('balance-unknown'), signal }),
    ).rejects.toBeInstanceOf(WithdrawalReadError);
  });

  it('keeps a KNOWN-zero scenario a valid readable periods snapshot', async () => {
    const c = makeCtl('zero-balance');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    expect(c.summary().balance).toMatchObject({ state: 'known', available: m('0') });
    const view = await loadWithdrawalPeriods(t, { scope: gscope('zero-balance'), signal });
    expect(view.released.length).toBeGreaterThan(0); // readable, not refused
    expect(view.releasable.map((p) => p.periodId)).toContain('period-2026-08');
  });
});
