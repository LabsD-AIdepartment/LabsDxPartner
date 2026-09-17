import { describe, expect, it } from 'vitest';
import {
  createWithdrawalController,
  type ControllerOptions,
} from '../../dev/withdrawals/controller';
import { type DevKeyValueStorage, memoryStorage } from '../../dev/withdrawals/store';
import { getScenario, type ScenarioName } from '../../dev/withdrawals/scenarios';
import {
  WithdrawalSummary,
  type WithdrawalQuoteValue,
  type WithdrawalSubmissionValue,
} from '@/contracts/withdrawal-journey';

// D138 — `summary.lastWithdrawal`: the most recent GENUINELY PAID withdrawal, chosen by its recorded
// PAID EVENT instant (never submittedAt), carrying the request's ACTUAL net cash (never the
// base.settled aggregate). Tri-state: a value, `null` (verified never paid), or `undefined` (unknown
// provenance). These tests own ONLY this projection; they never touch UI/TSX.

const m = (minor: string) => ({ currency: 'THB' as const, minor });

const baseScope = {
  userId: 'u1',
  partnerId: 'partner-1',
  permissionRevision: 'perm-1',
  payerId: 'labsd-th',
  currency: 'THB' as const,
  scenario: 'golden',
};

function counterId() {
  let n = 0;
  return { next: (prefix: string) => `${prefix}-${++n}` };
}
function mutableClock(startMs: number) {
  let t = startMs;
  return { clock: { now: () => new Date(t) }, advance: (ms: number) => (t += ms) };
}
// A storage whose read faults can be toggled; a read outage throws but NEVER deletes the bytes.
function faultableStorage(inner: DevKeyValueStorage) {
  const state = { read: false };
  const storage: DevKeyValueStorage = {
    getItem: (k) => {
      if (state.read) throw new Error('read denied');
      return inner.getItem(k);
    },
    setItem: (k, v) => inner.setItem(k, v),
    removeItem: (k) => inner.removeItem(k),
  };
  return { storage, state };
}

function make(
  scenario: ScenarioName,
  opts: Partial<Pick<ControllerOptions, 'storage' | 'clock' | 'idGen'>> = {},
) {
  return createWithdrawalController({
    scope: { ...baseScope, scenario },
    storage: opts.storage,
    clock: opts.clock,
    idGen: opts.idGen ?? counterId(),
  });
}

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

// Submit `gross` satang and return the accepted request ref.
function submitAccepted(
  c: ReturnType<typeof make>,
  gross: string,
  key: string,
): string {
  const q = c.quote(gross);
  const r = c.submit(submissionFrom(q, key));
  if (r.outcome !== 'accepted') throw new Error(`expected accepted, got ${r.outcome}`);
  return r.request.requestRef;
}

describe('summary.lastWithdrawal — verified none vs unknown provenance (no paid records)', () => {
  it('golden opening (base.settled 0) is a VERIFIED none → null', () => {
    const s = make('golden').summary();
    expect(s.lastWithdrawal).toBeNull();
    expect('lastWithdrawal' in s).toBe(true);
  });

  it('a positive opening settled with no attributable evidence is UNKNOWN → undefined (key absent)', () => {
    for (const name of ['zero-balance', 'deficit'] as const) {
      const s = make(name).summary();
      // zero-balance settled 5,000 / deficit settled 3,000: money was settled but the LAST payment is
      // unattributable, so we never fabricate a `none`.
      expect(s.lastWithdrawal).toBeUndefined();
      expect('lastWithdrawal' in s).toBe(false);
    }
  });

  it('an unavailable balance source is UNKNOWN → undefined even though authored settled is 0', () => {
    const s = make('balance-unknown').summary();
    expect(s.balance.state).toBe('unavailable');
    expect(s.lastWithdrawal).toBeUndefined();
  });

  it('a fresh unreadable restore is UNKNOWN → undefined (never a fabricated none)', () => {
    const { storage, state } = faultableStorage(memoryStorage());
    state.read = true; // faults from construction: a fresh restore is unread
    const s = make('golden', { storage }).summary();
    expect(s.balance.state).toBe('unavailable'); // restore-unread balance
    expect(s.lastWithdrawal).toBeUndefined();
  });
});

describe('summary.lastWithdrawal — authored opening settlement (explicit coherent evidence)', () => {
  it('partner-demo surfaces the opening 11,840 settlement, coherent with base.settled', () => {
    const scenario = getScenario('partner-demo');
    // Coherence is authored, not derived: the opening net equals the sole historical settlement.
    expect(scenario.openingLastWithdrawal?.net).toBe(scenario.base.settled);
    expect(scenario.openingLastWithdrawal?.net).toBe('1184000');

    const s = make('partner-demo').summary();
    expect(s.lastWithdrawal).toEqual({
      requestRef: 'wr-opening-partner-demo',
      net: m('1184000'),
      paidAt: '2026-09-01T00:00:00+07:00',
    });
  });

  it('scenarios WITHOUT authored evidence never gain a fabricated opening (golden → null)', () => {
    expect(getScenario('golden').openingLastWithdrawal).toBeUndefined();
    expect(make('golden').summary().lastWithdrawal).toBeNull();
  });
});

describe('summary.lastWithdrawal — net not gross; never the settled aggregate', () => {
  it('a paid 5,000 gross with 3% WHT surfaces net 4,850, while balance.settled aggregates gross 5,000', () => {
    const c = make('applies-wht');
    const ref = submitAccepted(c, '500000', 'key-wht');
    c.markPaid(ref);

    const s = c.summary();
    expect(s.lastWithdrawal?.net).toEqual(m('485000')); // 4,850.00 NET
    expect(s.lastWithdrawal?.requestRef).toBe(ref);
    // The balance settled aggregate is the GROSS obligation — distinct from the last withdrawal's net.
    expect(s.balance.state).toBe('known');
    if (s.balance.state === 'known') expect(s.balance.settled).toEqual(m('500000')); // 5,000.00 GROSS
    // And they must not be conflated.
    expect(s.lastWithdrawal?.net).not.toEqual(s.balance.state === 'known' ? s.balance.settled : null);
  });
});

describe('summary.lastWithdrawal — newest by PAID EVENT time, not submission time', () => {
  it('an earlier-submitted request paid later is the latest; paidAt is the paid event instant', () => {
    const base = 1_700_000_000_000; // arbitrary absolute ms
    const clk = mutableClock(base);
    const c = make('golden', { clock: clk.clock });

    const refA = submitAccepted(c, '500000', 'key-a'); // submitted first
    clk.advance(1000);
    const refB = submitAccepted(c, '500000', 'key-b'); // submitted second
    const submittedAtA = new Date(base).toISOString();

    clk.advance(1000);
    c.markPaid(refB); // B paid first
    clk.advance(1000);
    const paidAtA = new Date(base + 3000).toISOString();
    c.markPaid(refA); // A paid last (later paid event, though submitted earlier)

    const last = c.summary().lastWithdrawal;
    expect(last?.requestRef).toBe(refA); // chosen by PAID time, not submission order
    expect(last?.paidAt).toBe(paidAtA); // the paid EVENT instant
    expect(last?.paidAt).not.toBe(submittedAtA); // not the submission time
  });
});

describe('summary.lastWithdrawal — failed / cancelled / reconciling / requested are excluded', () => {
  it('only a paid request counts; non-paid states never surface, and never fabricate a value', () => {
    const clk = mutableClock(2_000_000_000_000);
    const c = make('golden', { clock: clk.clock });
    // Legacy_manual seeds cancellable `requested` records (a NEW submit now auto-initiates to
    // `processing`, which is not cancellable). This preserves the cancel/fail/reconcile/pay exclusion
    // coverage without weakening it; it is an explicit test-only initiation mode.
    c.setSubmitInitiationMode('legacy_manual');

    const refFail = submitAccepted(c, '500000', 'key-fail');
    const refCancel = submitAccepted(c, '500000', 'key-cancel');
    const refRecon = submitAccepted(c, '500000', 'key-recon');
    const refPaid = submitAccepted(c, '500000', 'key-paid');

    // Cancel one (default success mode releases the reserve) — read the live revision immediately.
    const cancelRes = c.cancel({
      scope: c.currentScope(),
      requestRef: refCancel,
      requestIdempotencyKey: 'key-cancel',
      operationKey: 'op-cancel',
      expectedRevision: c.summary().revision,
    });
    expect(cancelRes.outcome).toBe('cancelled');
    c.markFailed(refFail);
    c.markReconciling(refRecon);

    // No paid request yet, golden opening settled is 0 → VERIFIED none (not a stray failed/cancelled).
    expect(c.summary().lastWithdrawal).toBeNull();

    // Now pay the remaining requested one: it becomes the ONLY last withdrawal.
    clk.advance(1000);
    c.markPaid(refPaid);
    const last = c.summary().lastWithdrawal;
    expect(last?.requestRef).toBe(refPaid);
    expect(last?.net).toEqual(m('500000'));
  });
});

describe('summary.lastWithdrawal — reload persistence & per-scope isolation', () => {
  it('a paid withdrawal survives reload from the same storage (recomputed from the persisted paid event)', () => {
    const storage = memoryStorage();
    const clk = mutableClock(1_800_000_000_000);
    const c = make('golden', { storage, clock: clk.clock });
    const ref = submitAccepted(c, '500000', 'key-p');
    clk.advance(5000);
    c.markPaid(ref);
    const before = c.summary().lastWithdrawal;

    // A fresh controller over the SAME storage reloads the v2 record incl. its paid event timeline.
    const reloaded = make('golden', { storage, clock: clk.clock });
    expect(reloaded.summary().lastWithdrawal).toEqual(before);
    expect(before?.requestRef).toBe(ref);
  });

  it('a paid withdrawal in one scope never leaks into a different scope', () => {
    const clk = mutableClock(1_900_000_000_000);
    const paid = make('golden', { storage: memoryStorage(), clock: clk.clock });
    const ref = submitAccepted(paid, '500000', 'key-iso');
    clk.advance(1000);
    paid.markPaid(ref);
    expect(paid.summary().lastWithdrawal?.requestRef).toBe(ref);

    // A separate golden scope (own storage) is unaffected — still a verified none.
    const other = make('golden', { storage: memoryStorage(), clock: clk.clock });
    expect(other.summary().lastWithdrawal).toBeNull();
  });
});

describe('summary.lastWithdrawal — legacy/transport compatibility (older summaries parse)', () => {
  it('a summary object WITHOUT the key still parses; the field reads as undefined', () => {
    const withValue = make('partner-demo').summary();
    expect(withValue.lastWithdrawal).not.toBeUndefined();

    // Simulate an OLDER transport that never emitted the field.
    const legacy: Record<string, unknown> = { ...withValue };
    delete legacy.lastWithdrawal;
    const parsedLegacy = WithdrawalSummary.parse(legacy);
    expect(parsedLegacy.lastWithdrawal).toBeUndefined();

    // A present value and an explicit null both parse (the tri-state is accepted).
    expect(WithdrawalSummary.parse(withValue).lastWithdrawal).toEqual(withValue.lastWithdrawal);
    expect(WithdrawalSummary.parse({ ...withValue, lastWithdrawal: null }).lastWithdrawal).toBeNull();
  });
});
