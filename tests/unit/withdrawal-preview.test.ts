import { describe, expect, it } from 'vitest';
import {
  createWithdrawalController,
  type ControllerOptions,
} from '../../dev/withdrawals/controller';
import {
  type DevKeyValueStorage,
  memoryStorage,
  WITHDRAWAL_SCENARIO_MARKER,
} from '../../dev/withdrawals/store';
import {
  createWithdrawalScenario,
  createWithdrawalTransport,
  WithdrawalScopeError,
} from '../../dev/withdrawals/transport';
import {
  WithdrawalReadError,
  type WithdrawalQuoteValue,
  type WithdrawalSubmissionValue,
} from '@/contracts/withdrawal-journey';
import type { ScenarioName } from '../../dev/withdrawals/scenarios';

// A DevKeyValueStorage whose read/write/remove faults can be toggled independently. A read
// outage NEVER deletes the backing bytes — it just throws — which is exactly the recoverable
// storage fault the controller must survive without fabricating spendable money (F05).
function faultableStorage(inner: DevKeyValueStorage) {
  const state = { read: false, write: false, remove: false };
  const storage: DevKeyValueStorage = {
    getItem: (k) => {
      if (state.read) throw new Error('read denied');
      return inner.getItem(k);
    },
    setItem: (k, v) => {
      if (state.write) throw new Error('write denied');
      inner.setItem(k, v);
    },
    removeItem: (k) => {
      if (state.remove) throw new Error('remove denied');
      inner.removeItem(k);
    },
  };
  return { storage, state };
}

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
function mutableClock(startMs = 0) {
  let t = startMs;
  return { clock: { now: () => new Date(t) }, advance: (ms: number) => (t += ms) };
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

// =====================================================================================
// Golden acceptance case
// =====================================================================================

describe('golden withdrawal case (20,000 released, 7,000 pending, request 5,000)', () => {
  it('shows 20,000 available with 7,000 pending never folded in', () => {
    const c = make('golden');
    const s = c.summary();
    expect(s.balance).toMatchObject({ state: 'known', available: m('2000000') });
    // Current-period pending is separate and never contributes to the withdrawable balance.
    expect(s.currentPeriodPending).toEqual(m('700000'));
    expect(s.currentPeriod?.periodId).toBe('period-2026-09');
    expect(s.readiness.requestGate).toBe('ready');
    expect(s.beneficiary).toMatchObject({ state: 'known' });
  });

  it('quotes 5,000 as exact cash (no WHT/fee) leaving 15,000 available', () => {
    const c = make('golden');
    const q = c.quote('500000');
    expect(q).toMatchObject({
      state: 'quoted',
      gross: m('500000'),
      net: m('500000'),
      availableAfterRequest: m('1500000'),
    });
    if (q.state === 'quoted') expect(q.deductions).toEqual([]);
  });

  it('accepts the request, reserving 5,000 and leaving 15,000 available', () => {
    const c = make('golden');
    const result = c.submit(submissionFrom(c.quote('500000'), 'idem-1'));
    expect(result.outcome).toBe('accepted');
    // A NEW valid submit auto-initiates to `processing` (reserve retained; never paid from a click).
    expect(result).toMatchObject({
      request: { status: 'processing', reserved: m('500000'), gross: m('500000') },
    });
    expect(c.summary().balance).toMatchObject({ state: 'known', available: m('1500000') });
  });

  it('releasing another prior period increases released exactly once (no double count)', () => {
    const c = make('golden');
    expect(c.releaseNextPeriod()).toBe('period-2026-08');
    expect(c.summary().balance).toMatchObject({ available: m('3000000') });
    // Replaying finds nothing to release and never double counts.
    expect(c.releaseNextPeriod()).toBeNull();
    expect(c.summary().balance).toMatchObject({ available: m('3000000') });
  });

  it('handles a one-satang request exactly', () => {
    const q = make('golden').quote('1');
    expect(q).toMatchObject({ state: 'quoted', net: m('1'), availableAfterRequest: m('1999999') });
  });

  it('rejects an over-balance request as unavailable, not unknown', () => {
    expect(make('golden').quote('3000000')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['amount_exceeds_available']),
    });
  });
});

// =====================================================================================
// Idempotency, recovery and unknown outcome
// =====================================================================================

describe('idempotency and recovery', () => {
  it('an identical replay returns the same record and reserves nothing extra', () => {
    const c = make('golden');
    const q = c.quote('500000');
    const first = c.submit(submissionFrom(q, 'idem-1'));
    const replay = c.submit(submissionFrom(q, 'idem-1'));
    expect(replay.outcome).toBe('accepted');
    if (first.outcome !== 'rejected' && replay.outcome !== 'rejected')
      expect(replay.request.requestRef).toBe(first.request.requestRef);
    // Only one reservation exists.
    expect(c.summary().balance).toMatchObject({ available: m('1500000') });
  });

  it('rejects a different payload reusing the same idempotency key', () => {
    const c = make('golden');
    c.submit(submissionFrom(c.quote('500000'), 'idem-1'));
    const other = c.quote('300000');
    expect(c.submit(submissionFrom(other, 'idem-1'))).toMatchObject({
      outcome: 'rejected',
      code: 'idempotency_conflict',
    });
  });

  it('an unknown outcome preserves the reservation and recovers by the same key', () => {
    const c = make('golden');
    c.setUnknownOutcome(true);
    const q = c.quote('500000');
    const result = c.submit(submissionFrom(q, 'idem-u'));
    expect(result.outcome).toBe('unknown');
    expect(result).toMatchObject({ request: { status: 'reconciling', reserved: m('500000') } });
    // Reservation held; not released automatically.
    expect(c.summary().balance).toMatchObject({ available: m('1500000') });
    expect(c.recover({ idempotencyKey: 'idem-u' })).toMatchObject({ state: 'found' });
    expect(c.recover({ idempotencyKey: 'missing' })).toEqual({ state: 'missing' });
    // Recovering with the same key never invents a new key or a second request.
    const again = c.submit(submissionFrom(q, 'idem-u'));
    expect(again.outcome).toBe('unknown');
    if (result.outcome !== 'rejected' && again.outcome !== 'rejected')
      expect(again.request.requestRef).toBe(result.request.requestRef);
  });

  it('recovers a request by its reference', () => {
    const c = make('golden');
    const result = c.submit(submissionFrom(c.quote('500000'), 'idem-r'));
    if (result.outcome === 'rejected') throw new Error('unexpected reject');
    expect(c.recover({ requestRef: result.request.requestRef })).toMatchObject({ state: 'found' });
  });
});

// =====================================================================================
// Freshness: stale quote, changed beneficiary, expiry, duplicate click
// =====================================================================================

describe('quote freshness and mismatches', () => {
  it('rejects a submission bound to a stale balance revision', () => {
    const c = make('golden');
    const q = c.quote('500000');
    c.forceStaleQuote();
    expect(c.submit(submissionFrom(q, 'k'))).toMatchObject({
      outcome: 'rejected',
      code: 'stale_quote',
    });
  });

  it('rejects a submission after the beneficiary changed', () => {
    const c = make('golden');
    const q = c.quote('500000');
    c.changeBeneficiary();
    expect(c.submit(submissionFrom(q, 'k'))).toMatchObject({
      outcome: 'rejected',
      code: 'beneficiary_changed',
    });
  });

  it('rejects an expired quote', () => {
    const { clock, advance } = mutableClock(0);
    const c = make('golden', { clock });
    const q = c.quote('500000');
    advance(6 * 60 * 1000);
    expect(c.submit(submissionFrom(q, 'k'))).toMatchObject({
      outcome: 'rejected',
      code: 'quote_expired',
    });
  });

  it('rejects a duplicate-click second quote once the first reserved the money', () => {
    const c = make('golden');
    const q1 = c.quote('500000');
    const q2 = c.quote('500000');
    expect(c.submit(submissionFrom(q1, 'k1')).outcome).toBe('accepted');
    // q2 was bound to the pre-reservation revision and is now stale.
    expect(c.submit(submissionFrom(q2, 'k2'))).toMatchObject({
      outcome: 'rejected',
      code: 'stale_quote',
    });
  });

  it('rejects a submission that references an unknown quote', () => {
    const c = make('golden');
    const good = submissionFrom(c.quote('500000'), 'k');
    expect(c.submit({ ...good, quoteId: 'does-not-exist' })).toMatchObject({
      outcome: 'rejected',
      code: 'quote_not_found',
    });
  });
});

// =====================================================================================
// Scenario-authored deductions vs. explicit no-policy
// =====================================================================================

describe('scenario-authored deductions', () => {
  it('applies a WHT line bound to the exact gross and reconciles net', () => {
    const c = make('applies-wht');
    const q = c.quote('500000');
    expect(q).toMatchObject({ state: 'quoted', gross: m('500000'), net: m('485000') });
    if (q.state === 'quoted')
      expect(q.deductions).toEqual([
        { kind: 'withholding_tax', label: 'หัก ณ ที่จ่าย 3%', amount: m('15000') },
      ]);
  });

  it('returns unavailable for an unsupported amount instead of inventing a rate', () => {
    expect(make('applies-wht').quote('333333')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['amount_unsupported']),
    });
  });
});

// =====================================================================================
// Blocked / missing / unknown states — never a fabricated confirmable figure
// =====================================================================================

describe('blocked and unknown scenarios', () => {
  it('missing beneficiary blocks readiness and quoting', () => {
    const c = make('missing-beneficiary');
    expect(c.summary().beneficiary).toMatchObject({ state: 'missing' });
    expect(c.summary().readiness.requestGate).toBe('blocked');
    expect(c.quote('500000')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['beneficiary_missing']),
    });
  });

  it('pending beneficiary is presented as pending and is not confirmable', () => {
    const c = make('pending-beneficiary');
    expect(c.summary().beneficiary).toMatchObject({ state: 'pending' });
    expect(c.quote('500000')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['beneficiary_pending']),
    });
  });

  it('unknown tax policy blocks a quote with no default 0%', () => {
    expect(make('unknown-tax').quote('500000')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['tax_policy_unknown']),
    });
  });

  it('unknown balance stays unavailable, never a fabricated zero', () => {
    const c = make('balance-unknown');
    expect(c.summary().balance).toMatchObject({ state: 'unavailable' });
    expect(c.quote('500000')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['balance_unknown']),
    });
  });

  it('known zero is distinct from unknown and blocks over-balance', () => {
    const c = make('zero-balance');
    expect(c.summary().balance).toMatchObject({ state: 'known', available: m('0') });
    expect(c.quote('100000')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['amount_exceeds_available']),
    });
  });

  it('preserves a negative correction as a signed deficit', () => {
    expect(make('deficit').summary().balance).toMatchObject({
      state: 'known',
      available: m('0'),
      rawAvailable: m('-200000'),
      deficit: m('200000'),
    });
  });
});

// =====================================================================================
// Scope / permission / payer / scenario rejection
// =====================================================================================

describe('cross-scope submissions are rejected distinctly', () => {
  const cases: [string, Partial<typeof baseScope>][] = [
    ['scenario_mismatch', { scenario: 'applies-wht' }],
    ['payer_mismatch', { payerId: 'other-payer' }],
    ['permission_mismatch', { userId: 'other-user' }],
    ['permission_mismatch', { permissionRevision: 'perm-2' }],
    ['scope_mismatch', { partnerId: 'other-partner' }],
  ];
  it.each(cases)('rejects %s', (code, patch) => {
    const c = make('golden');
    const good = submissionFrom(c.quote('500000'), 'k');
    expect(c.submit({ ...good, scope: { ...good.scope, ...patch } })).toMatchObject({
      outcome: 'rejected',
      code,
    });
  });
});

// =====================================================================================
// Persistence: restore, namespace isolation, invalid/denied storage
// =====================================================================================

describe('versioned scenario persistence', () => {
  it('restores requests and balance after a reload / same-tab navigation', () => {
    const storage = memoryStorage();
    const a = make('golden', { storage });
    const submitted = a.submit(submissionFrom(a.quote('500000'), 'idem-persist'));
    expect(submitted.outcome).toBe('accepted');
    // A fresh controller over the SAME storage simulates reload / partner<->staff navigation.
    const b = make('golden', { storage });
    expect(b.recover({ idempotencyKey: 'idem-persist' })).toMatchObject({ state: 'found' });
    expect(b.summary().balance).toMatchObject({ available: m('1500000') });
  });

  it('isolates each scenario namespace', () => {
    const storage = memoryStorage();
    const c = make('golden', { storage });
    c.submit(submissionFrom(c.quote('500000'), 'idem-g'));
    c.selectScenario('applies-wht');
    // The applies-wht namespace never sees golden's request.
    expect(c.recover({ idempotencyKey: 'idem-g' })).toEqual({ state: 'missing' });
    c.selectScenario('golden');
    expect(c.recover({ idempotencyKey: 'idem-g' })).toMatchObject({ state: 'found' });
  });

  it('resets only this namespace on a schema-invalid blob and warns', () => {
    // The store key carries the FULL declared scope (user + permission included, F03).
    const key = [WITHDRAWAL_SCENARIO_MARKER, 'golden', 'u1', 'partner-1', 'perm-1', 'labsd-th', 'THB']
      .map(encodeURIComponent)
      .join('::');
    const storage = memoryStorage({ [key]: '{"version":99,"broken":true}' });
    const c = make('golden', { storage });
    expect(c.summary().persistenceWarning).toBeTruthy();
    // Reset to scenario defaults, not a fabricated state.
    expect(c.summary().balance).toMatchObject({ available: m('2000000') });
  });

  it('warns on a save failure but never rolls back a shown successful submission (F05)', () => {
    // Read succeeds (clean defaults, state known) but the durable WRITE fails. The shown
    // submission is kept in memory and a durability caveat is surfaced — never a silent rollback.
    const saveOnly: DevKeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    const c = make('golden', { storage: saveOnly });
    const result = c.submit(submissionFrom(c.quote('500000'), 'idem-x'));
    expect(result.outcome).toBe('accepted');
    expect(c.summary().persistenceWarning).toBeTruthy();
    expect(c.recover({ idempotencyKey: 'idem-x' })).toMatchObject({ state: 'found' });
    expect(c.summary().balance).toMatchObject({ available: m('1500000') });
  });
});

// =====================================================================================
// F05 — read faults preserve reservations; a fresh unreadable restore fabricates no money
// =====================================================================================

describe('F05 storage read faults are distinct from data loss', () => {
  it('a transport read outage throws a typed error and preserves the reservation', () => {
    const storage = memoryStorage();
    const c = make('golden', { storage });
    c.submit(submissionFrom(c.quote('500000'), 'idem-y'));
    c.setReadError(true);
    // A bounded, typed read error — NOT a restored 20,000. The reservation is untouched.
    expect(() => c.summary()).toThrow(WithdrawalReadError);
    c.setReadError(false);
    expect(c.summary().balance).toMatchObject({ state: 'known', available: m('1500000') });
    expect(c.recover({ idempotencyKey: 'idem-y' })).toMatchObject({ state: 'found' });
  });

  it('a fresh unreadable restore fabricates no spendable balance and blocks new writes', () => {
    const inner = memoryStorage();
    const seed = make('golden', { storage: inner });
    seed.submit(submissionFrom(seed.quote('500000'), 'idem-persist')); // reserve 5,000 -> stored
    const { storage, state } = faultableStorage(inner);
    state.read = true; // getItem throws, setItem works
    const b = make('golden', { storage });
    // No fabricated 20,000: the balance is genuinely unavailable while the state is unreadable.
    expect(b.summary().balance.state).toBe('unavailable');
    expect(b.summary().persistenceWarning).toBeTruthy();
    // A quote cannot be confirmed and a submission is refused (no phantom reservation).
    expect(b.quote('500000').state).toBe('unavailable');
    const blocked = b.submit({
      scope: { ...baseScope, scenario: 'golden' },
      idempotencyKey: 'idem-block',
      quoteId: 'q-any',
      gross: m('500000'),
      net: m('500000'),
      bindings: { balanceRevision: 'x', policyRevision: 'y', beneficiaryVersion: 'z' },
    });
    expect(blocked).toMatchObject({ outcome: 'rejected', code: 'restore_unread' });
    // The still-stored reservation was never deleted or overwritten: once the read recovers, it
    // is restored exactly.
    state.read = false;
    b.reload();
    expect(b.summary().balance).toMatchObject({ state: 'known', available: m('1500000') });
    expect(b.recover({ idempotencyKey: 'idem-persist' })).toMatchObject({ state: 'found' });
  });

  it('a transient reload fault keeps the existing in-memory reservation', () => {
    const inner = memoryStorage();
    const { storage, state } = faultableStorage(inner);
    const c = make('golden', { storage });
    c.submit(submissionFrom(c.quote('500000'), 'idem-t')); // known in-memory + stored
    state.read = true;
    c.reload(); // transient fault AFTER state is known: keep the reservation, do not wipe it
    expect(c.summary().balance).toMatchObject({ state: 'known', available: m('1500000') });
    expect(c.summary().persistenceWarning).toBeTruthy();
  });

  it('a failed reset retains a durability caveat and the old data can reappear on reload', () => {
    const inner = memoryStorage();
    const seed = make('golden', { storage: inner });
    seed.submit(submissionFrom(seed.quote('500000'), 'idem-z')); // stored reservation
    const { storage, state } = faultableStorage(inner);
    const c = make('golden', { storage }); // reads the stored reservation
    expect(c.summary().balance).toMatchObject({ available: m('1500000') });
    state.remove = true; // removeItem fails
    c.reset();
    expect(c.view().persistenceWarning).toBeTruthy(); // never silently claims a clean reset
    // The bytes are still present: a fresh controller reloads the old reservation.
    state.remove = false;
    const again = make('golden', { storage });
    expect(again.recover({ idempotencyKey: 'idem-z' })).toMatchObject({ state: 'found' });
  });
});

// =====================================================================================
// F01 — an immutable issued quote cannot be bypassed
// =====================================================================================

describe('F01 issued-quote immutability', () => {
  it('rejects an old quote replayed with forged CURRENT bindings/amounts', () => {
    const c = make('golden');
    const qA = c.quote('500000'); // bound to the pre-change beneficiary/balance revision
    c.changeBeneficiary(); // current beneficiary version moves on
    const qB = c.quote('500000'); // a fresh, currently-valid quote
    if (qA.state !== 'quoted' || qB.state !== 'quoted') throw new Error('expected quoted');
    // Point at the OLD quote id but echo the NEW quote's current bindings + amounts. The command
    // must be compared to the IMMUTABLE issued quote, not trusted, so this is stale.
    const forged: WithdrawalSubmissionValue = {
      ...submissionFrom(qA, 'k-forge'),
      gross: qB.gross,
      net: qB.net,
      bindings: qB.bindings,
    };
    expect(c.submit(forged)).toMatchObject({ outcome: 'rejected', code: 'stale_quote' });
  });

  it('a one-use quote cannot be replayed under a FRESH key to mint a second reservation', () => {
    const c = make('golden');
    const q = c.quote('500000');
    expect(c.submit(submissionFrom(q, 'k1')).outcome).toBe('accepted');
    // Same quote, brand new key: distinct from an unknown quote — it was consumed.
    expect(c.submit(submissionFrom(q, 'k2'))).toMatchObject({
      outcome: 'rejected',
      code: 'quote_consumed',
    });
    // Only the one reservation exists.
    expect(c.summary().balance).toMatchObject({ available: m('1500000') });
  });

  it('treats the expiry boundary as inclusive (>= expiry is expired)', () => {
    const { clock, advance } = mutableClock(0);
    const c = make('golden', { clock });
    const q = c.quote('500000');
    advance(5 * 60 * 1000); // exactly at the 5-minute TTL
    expect(c.submit(submissionFrom(q, 'k'))).toMatchObject({
      outcome: 'rejected',
      code: 'quote_expired',
    });
  });
});

// =====================================================================================
// F03 — persisted state must satisfy scope/accounting invariants before projection
// =====================================================================================

function storeKeyOf(scope: typeof baseScope): string {
  return [
    WITHDRAWAL_SCENARIO_MARKER,
    scope.scenario,
    scope.userId,
    scope.partnerId,
    scope.permissionRevision,
    scope.payerId,
    scope.currency,
  ]
    .map(encodeURIComponent)
    .join('::');
}

// Seed storage with a genuine golden reservation, then corrupt the persisted blob in place.
function seededThenCorrupted(mutate: (blob: any) => void) {
  const inner = memoryStorage();
  const a = make('golden', { storage: inner });
  a.submit(submissionFrom(a.quote('500000'), 'idem-seed'));
  const key = storeKeyOf({ ...baseScope, scenario: 'golden' });
  const blob = JSON.parse(inner.getItem(key) as string);
  mutate(blob);
  inner.setItem(key, JSON.stringify(blob));
  return inner;
}

describe('F03 persisted-state accounting/identity invariants', () => {
  const corruptions: [string, (blob: any) => void][] = [
    ['a zeroed reserve on an active request', (b) => (b.requests[0].reserved.minor = '0')],
    ['a net that does not reconcile to gross', (b) => (b.requests[0].net.minor = '400000')],
    ['a duplicate request id/key', (b) => b.requests.push({ ...b.requests[0] })],
    ['an arbitrary released period id', (b) => (b.releasedPeriods = ['period-not-real'])],
    ['a terminal status WU01 does not settle', (b) => (b.requests[0].status = 'paid')],
  ];
  it.each(corruptions)('rejects and resets on %s (no phantom availability)', (_label, mutate) => {
    const inner = seededThenCorrupted(mutate);
    const b = make('golden', { storage: inner });
    // Rejected with a visible warning and reset to scenario defaults — never trusted.
    expect(b.summary().persistenceWarning).toBeTruthy();
    expect(b.summary().balance).toMatchObject({ state: 'known', available: m('2000000') });
    expect(b.recover({ idempotencyKey: 'idem-seed' })).toEqual({ state: 'missing' });
  });

  it('never lets a different actor/permission restore another actor reserved money', () => {
    const inner = memoryStorage();
    const actorA = make('golden', { storage: inner });
    actorA.submit(submissionFrom(actorA.quote('500000'), 'idem-a'));
    // ActorB: different user + permission over the SAME partner/payer/scenario.
    const bScope = { ...baseScope, scenario: 'golden', userId: 'u2', permissionRevision: 'perm-9' };
    const actorB = createWithdrawalController({ scope: bScope, storage: inner, idGen: counterId() });
    // Key isolation: ActorB sees its own empty namespace, not ActorA's reservation.
    expect(actorB.recover({ idempotencyKey: 'idem-a' })).toEqual({ state: 'missing' });
    expect(actorB.summary().balance).toMatchObject({ available: m('2000000') });
    // Defence in depth: even a blob planted under ActorB's key but carrying ActorA's scope is
    // rejected by the stored-scope check.
    const planted = inner.getItem(storeKeyOf({ ...baseScope, scenario: 'golden' })) as string;
    inner.setItem(storeKeyOf(bScope), planted);
    const actorB2 = createWithdrawalController({ scope: bScope, storage: inner, idGen: counterId() });
    expect(actorB2.summary().persistenceWarning).toBeTruthy();
    expect(actorB2.recover({ idempotencyKey: 'idem-a' })).toEqual({ state: 'missing' });
    expect(actorB2.summary().balance).toMatchObject({ available: m('2000000') });
  });
});

// =====================================================================================
// F04 — a reloaded UI rediscovers an unresolved submission via summary.resume
// =====================================================================================

describe('F04 durable reload recovery', () => {
  it('rediscovers a timeout-after-accept submission without a remembered client key', () => {
    const storage = memoryStorage();
    const a = make('golden', { storage });
    a.setUnknownOutcome(true);
    const res = a.submit(submissionFrom(a.quote('500000'), 'idem-lost'));
    expect(res.outcome).toBe('unknown'); // reserved, but the caller may have no response

    // A fresh controller (reload) that does NOT know the client key.
    const b = make('golden', { storage });
    const resume = b.summary().resume;
    expect(resume.length).toBe(1);
    expect(resume[0]).toMatchObject({ status: 'reconciling', reserved: m('500000') });
    // Recover the full record using only the descriptor's handles — no new key invented.
    expect(b.recover({ requestRef: resume[0].requestRef })).toMatchObject({ state: 'found' });
    expect(b.recover({ idempotencyKey: resume[0].idempotencyKey })).toMatchObject({ state: 'found' });
    // The reservation is confirmed held; no payment completion is fabricated.
    expect(b.summary().balance).toMatchObject({ available: m('1500000') });
  });

  it('exposes no resume descriptor once nothing is outstanding', () => {
    const storage = memoryStorage();
    expect(make('golden', { storage }).summary().resume).toEqual([]);
  });
});

// =====================================================================================
// F02 — the raw dev transport gates the caller scope BEFORE any controller side effect
// =====================================================================================

describe('F02 raw transport declared-scope gate', () => {
  const gscope = { ...baseScope, scenario: 'golden' as const };
  const foreignFields: [string, Partial<typeof baseScope>][] = [
    ['userId', { userId: 'foreign-user' }],
    ['partnerId', { partnerId: 'foreign-partner' }],
    ['permissionRevision', { permissionRevision: 'perm-foreign' }],
    ['payerId', { payerId: 'foreign-payer' }],
    ['scenario', { scenario: 'applies-wht' }],
  ];

  it.each(foreignFields)(
    'rejects summary/quote/recover when %s differs, with no side-effect quote',
    async (_field, patch) => {
      const c = make('golden');
      const t = createWithdrawalTransport(c, { latencyMs: 0 });
      const foreign = { ...gscope, ...patch };
      const signal = new AbortController().signal;
      await expect(t.summary({ scope: foreign, signal })).rejects.toBeInstanceOf(WithdrawalScopeError);
      await expect(
        t.quote({ scope: foreign, grossMinor: '100', signal }),
      ).rejects.toBeInstanceOf(WithdrawalScopeError);
      await expect(
        t.recover({ scope: foreign, idempotencyKey: 'any', signal }),
      ).rejects.toBeInstanceOf(WithdrawalScopeError);
      // A rejected quote must NOT have minted an issued quote: a fresh (matching-scope) submit
      // that references any prior quote id finds nothing, proving no reservation side effect.
      expect(c.summary().resume).toEqual([]);
      expect(c.summary().balance).toMatchObject({ state: 'known', available: m('2000000') });
    },
  );

  it('answers a fully matching scope on every read/quote/recover', async () => {
    const c = make('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const signal = new AbortController().signal;
    const summary = (await t.summary({ scope: gscope, signal })) as { balance: { available: unknown } };
    expect(summary.balance.available).toEqual(m('2000000'));
    const quote = (await t.quote({ scope: gscope, grossMinor: '500000', signal })) as { state: string };
    expect(quote.state).toBe('quoted');
    const recovery = (await t.recover({ scope: gscope, idempotencyKey: 'none', signal })) as {
      state: string;
    };
    expect(recovery.state).toBe('missing');
  });
});

// =====================================================================================
// F04 — bounded synthetic capacity is refused BEFORE mutation; the summary stays readable
// =====================================================================================

describe('F04 synthetic store capacity', () => {
  it('accepts up to the bound, then rejects a NEW key with a synthetic capacity reason', () => {
    const storage = memoryStorage();
    const c = make('golden', { storage });
    // 200 one-satang requests fit exactly within the store bound. Keep the first command to prove
    // an idempotent replay still works once the store is full.
    let firstCommand: WithdrawalSubmissionValue | null = null;
    for (let i = 0; i < 200; i++) {
      const q = c.quote('1');
      if (q.state !== 'quoted') throw new Error('expected a confirmable quote');
      const command = submissionFrom(q, `small-${i}`);
      if (i === 0) firstCommand = command;
      expect(c.submit(command).outcome).toBe('accepted');
    }
    // The 201st NEW request is refused BEFORE any mutation — the reservation never grows past 200.
    const overflow = c.quote('1');
    if (overflow.state !== 'quoted') throw new Error('expected a confirmable quote');
    const rejected = c.submit(submissionFrom(overflow, 'small-200'));
    expect(rejected).toMatchObject({ outcome: 'rejected', code: 'capacity_reached' });

    // The summary is still readable (resume is exactly at the bound, never over it) and the
    // reserved total reflects only the 200 accepted requests.
    const summary = c.summary();
    expect(summary.resume.length).toBe(200);
    expect(summary.balance).toMatchObject({ state: 'known', reserved: m('200'), available: m('1999800') });

    // An EXISTING key still replays at capacity: the replay is matched by idempotency key BEFORE
    // the capacity gate, so it returns the same record and reserves nothing more.
    const replay = c.submit(firstCommand as WithdrawalSubmissionValue);
    expect(replay.outcome).toBe('accepted');
    expect(c.summary().balance).toMatchObject({ reserved: m('200') });

    // A fresh controller reloads the 200-record store consistently (no serialisation overflow).
    const reloaded = make('golden', { storage });
    const rs = reloaded.summary();
    expect(rs.resume.length).toBe(200);
    expect(rs.balance).toMatchObject({ state: 'known', reserved: m('200'), available: m('1999800') });
  });
});

// =====================================================================================
// F04 — a LOST response (transport drops/throws AFTER an accepted submit) is rediscovered
// via the durable resume, distinct from the true-unknown reconciling scenario
// =====================================================================================

describe('F04 lost-response recovery', () => {
  it('rediscovers an auto-initiated record after the response is lost, with the reservation intact', async () => {
    const storage = memoryStorage();
    const controller = make('golden', { storage });
    const transport = createWithdrawalTransport(controller, { latencyMs: 0 });
    // A transport wrapper that calls the underlying (accepted) submit and THEN throws: the
    // controller has already committed + persisted the reservation, but the caller never sees
    // the response and loses its client idempotency key. This is the timeout/dropped-response
    // path AFTER acceptance — NOT a genuine unknown transfer outcome (the record auto-initiated to
    // `processing`, never `reconciling`, and no payment completion is invented).
    const lossy = {
      ...transport,
      async submit(input: Parameters<typeof transport.submit>[0]) {
        await transport.submit(input);
        throw new Error('response lost after accept');
      },
    };
    const quote = controller.quote('500000');
    if (quote.state !== 'quoted') throw new Error('expected a confirmable quote');
    const submission = submissionFrom(quote, 'idem-lost-response');
    const signal = new AbortController().signal;
    await expect(lossy.submit({ submission, signal })).rejects.toThrow('response lost after accept');

    // A fresh controller (a reload with NO remembered key) rediscovers the durable record.
    const reloaded = make('golden', { storage });
    const resume = reloaded.summary().resume;
    expect(resume.length).toBe(1);
    expect(resume[0]).toMatchObject({ status: 'processing', reserved: m('500000'), gross: m('500000') });
    // Recover the full record from the descriptor's handles alone — no new key invented.
    expect(reloaded.recover({ requestRef: resume[0].requestRef })).toMatchObject({
      state: 'found',
      request: { status: 'processing' },
    });
    expect(reloaded.recover({ idempotencyKey: resume[0].idempotencyKey })).toMatchObject({
      state: 'found',
    });
    // The reservation is unchanged; nothing was marked paid or reconciled away by the loss.
    expect(reloaded.summary().balance).toMatchObject({ state: 'known', available: m('1500000') });
  });

  it('keeps the true-unknown (reconciling) outcome distinct from a lost response', () => {
    const storage = memoryStorage();
    const c = make('golden', { storage });
    c.setUnknownOutcome(true);
    const q = c.quote('500000');
    if (q.state !== 'quoted') throw new Error('expected a confirmable quote');
    const res = c.submit(submissionFrom(q, 'idem-unknown'));
    expect(res.outcome).toBe('unknown');
    // A genuine unknown transfer outcome holds the reservation as `reconciling` (not `requested`),
    // which recover preserves — it is never silently promoted to a completed/lost-then-found
    // requested record.
    const reloaded = make('golden', { storage });
    expect(reloaded.summary().resume[0]).toMatchObject({ status: 'reconciling', reserved: m('500000') });
    expect(reloaded.recover({ idempotencyKey: 'idem-unknown' })).toMatchObject({
      state: 'found',
      request: { status: 'reconciling' },
    });
  });
});

// =====================================================================================
// Transport abort
// =====================================================================================

describe('transport abort', () => {
  it('rejects an aborted request without producing a late value', async () => {
    const { transport } = createWithdrawalScenario({ scope: baseScope, latencyMs: 50 });
    const ac = new AbortController();
    ac.abort();
    await expect(transport.summary({ scope: baseScope, signal: ac.signal })).rejects.toThrow(
      'Aborted',
    );
  });
});
