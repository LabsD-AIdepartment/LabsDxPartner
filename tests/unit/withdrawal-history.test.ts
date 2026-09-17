import { describe, expect, it } from 'vitest';
import {
  cancelWithdrawal,
  loadWithdrawalDetail,
  loadWithdrawalList,
  recoverCancellation,
  WithdrawalResponseError,
  type WithdrawalHistoryTransport,
} from '@/features/withdrawals/model';
import { WithdrawalCancelResult } from '@/contracts/withdrawal-journey';
import type {
  WithdrawalCancelCommandValue,
  WithdrawalCancellationReceiptValue,
  WithdrawalQuoteValue,
  WithdrawalRequestValue,
  WithdrawalScopeValue,
  WithdrawalSubmissionValue,
  WithdrawalSubmitResultValue,
} from '@/contracts/withdrawal-journey';
import { createWithdrawalController } from '../../dev/withdrawals/controller';
import {
  createWithdrawalTransport,
  getWithdrawalRuntime,
  releaseWithdrawalRuntime,
} from '../../dev/withdrawals/transport';
import {
  memoryStorage,
  STORE_VERSION,
  WITHDRAWAL_SCENARIO_MARKER,
} from '../../dev/withdrawals/store';
import type { DevKeyValueStorage } from '../../dev/withdrawals/store';
import type { ScenarioName } from '../../dev/withdrawals/scenarios';

// WU02 SEAM behaviour tests for the exact defects root's independent probes found
// (review/root-seam-probes.ts). They exercise the IMPLEMENTED model loaders against hand-built
// transports (the controller/store are authored separately); an invalid nested payload must be
// rejected as unrenderable, a valid one accepted. These are behaviour checks, not shape mirrors.

const scope: WithdrawalScopeValue = {
  userId: 'user-a',
  partnerId: 'partner-a',
  permissionRevision: 'perm-a',
  payerId: 'payer-a',
  currency: 'THB',
  scenario: 'golden',
};
const foreign: WithdrawalScopeValue = { ...scope, payerId: 'payer-b' };
const m = (minor: string) => ({ currency: 'THB' as const, minor });
const signal = new AbortController().signal;

const requestedReq: WithdrawalRequestValue = {
  requestRef: 'req-a',
  idempotencyKey: 'key-a',
  scope,
  status: 'requested',
  gross: m('500000'),
  net: m('500000'),
  deductions: [],
  reserved: m('500000'),
  beneficiary: { displayName: 'Synthetic', bankName: 'Synthetic', maskedAccount: 'xxx1234', version: 'b1' },
  quoteId: 'q1',
  bindings: { balanceRevision: 'r1', policyRevision: 'p1', beneficiaryVersion: 'b1' },
  submittedAt: '2026-09-16T00:00:00Z',
  allowedActions: ['cancel', 'check_status'],
};
const cancelledReq: WithdrawalRequestValue = {
  ...requestedReq,
  status: 'cancelled',
  reserved: m('0'),
  allowedActions: ['check_status'],
};
const reconcilingReq: WithdrawalRequestValue = {
  ...requestedReq,
  status: 'reconciling',
  allowedActions: ['check_status', 'contact_support'],
};

const command: WithdrawalCancelCommandValue = {
  scope,
  requestRef: 'req-a',
  requestIdempotencyKey: 'key-a',
  operationKey: 'op-1',
  expectedRevision: 'r1',
};
const receiptBase = {
  scope,
  operationKey: 'op-1',
  requestRef: 'req-a',
  requestIdempotencyKey: 'key-a',
  expectedRevision: 'r1',
  detail: null,
  createdAt: '2026-09-16T00:01:00Z',
} as const;
const acceptedReceipt: WithdrawalCancellationReceiptValue = {
  ...receiptBase,
  outcome: 'accepted',
  code: null,
  resolvedAt: '2026-09-16T00:01:00Z',
};
const unknownReceipt: WithdrawalCancellationReceiptValue = {
  ...receiptBase,
  outcome: 'unknown',
  code: null,
  resolvedAt: null,
};

// A full WithdrawalHistoryTransport whose four WU01 methods are inert and whose WU02 methods
// return a supplied payload. Only the method under test is invoked by each loader.
function historyFake(over: Partial<WithdrawalHistoryTransport>): WithdrawalHistoryTransport {
  return {
    summary: async () => ({}),
    quote: async () => ({}),
    submit: async () => ({}),
    recover: async () => ({ state: 'missing' }),
    list: async () => ({ scope, asOf: '2026-09-16T00:02:00Z', items: [], nextCursor: null, revision: 'r1' }),
    detail: async () => ({ state: 'missing', scope, requestRef: 'req-a' }),
    cancel: async () => ({ outcome: 'unknown', receipt: unknownReceipt }),
    recoverCancellation: async () => ({ state: 'missing', scope, operationKey: 'op-1', requestRef: 'req-a' }),
    ...over,
  };
}
const detailFound = (over: Record<string, unknown> = {}) => ({
  state: 'found' as const,
  detail: {
    request: requestedReq,
    timeline: [{ seq: 1, at: requestedReq.submittedAt, kind: 'submitted', status: 'requested', detail: null }],
    historyComplete: true,
    sourceContext: { state: 'known', periods: [], allocationModeled: false },
    documents: { state: 'pending', reasons: ['not issued'] },
    pendingCancellations: [],
    revision: 'r1',
    ...over,
  },
});

// =====================================================================================
// S01 — every new envelope (including missing) carries scope/identity and correlates handles
// =====================================================================================

describe('S01 scope/identity on every envelope', () => {
  it('accepts a well-formed detail (found) and a scoped detail miss', async () => {
    const found = await loadWithdrawalDetail(historyFake({ detail: async () => detailFound() }), {
      scope,
      requestRef: 'req-a',
      signal,
    });
    expect(found.state).toBe('found');
    const missing = await loadWithdrawalDetail(historyFake({}), { scope, requestRef: 'req-a', signal });
    expect(missing.state).toBe('missing');
  });

  it('rejects a detail miss for a different reference', async () => {
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => ({ state: 'missing', scope, requestRef: 'other' }) }), {
        scope,
        requestRef: 'req-a',
        signal,
      }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a detail miss under a foreign scope', async () => {
    await expect(
      loadWithdrawalDetail(
        historyFake({ detail: async () => ({ state: 'missing', scope: foreign, requestRef: 'req-a' }) }),
        { scope, requestRef: 'req-a', signal },
      ),
    ).rejects.toMatchObject({ reason: 'scope_mismatch' });
  });

  it('rejects a cancellation miss that echoes unrelated handles (probe S01)', async () => {
    await expect(
      recoverCancellation(
        historyFake({
          recoverCancellation: async () => ({
            state: 'missing',
            scope,
            operationKey: 'foreign-op',
            requestRef: 'foreign-ref',
          }),
        }),
        { scope, operationKey: 'op-1', requestRef: 'req-a', signal },
      ),
    ).rejects.toMatchObject({ reason: 'identity_mismatch' });
  });

  it('accepts a cancellation miss that echoes the queried handles in scope', async () => {
    const r = await recoverCancellation(historyFake({}), {
      scope,
      operationKey: 'op-1',
      requestRef: 'req-a',
      signal,
    });
    expect(r.state).toBe('missing');
  });

  it('rejects a pending cancellation whose scope/identity does not bind this request', async () => {
    const detail = detailFound({
      pendingCancellations: [{ ...unknownReceipt, scope: foreign }],
    });
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a pending cancellation that is not actually unresolved', async () => {
    const detail = detailFound({ pendingCancellations: [acceptedReceipt] });
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });
});

// =====================================================================================
// S02 — outcome/code/resolvedAt + request-state coherence; no accepted claim over a live reserve
// =====================================================================================

describe('S02 cancellation outcome coherence', () => {
  it('rejects an unknown envelope carrying an accepted receipt (probe S02)', async () => {
    await expect(
      cancelWithdrawal(historyFake({ cancel: async () => ({ outcome: 'unknown', receipt: acceptedReceipt }) }), {
        command,
        signal,
      }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('accepts a coherent unknown cancel (reservation retained, unresolved receipt)', async () => {
    const r = await cancelWithdrawal(historyFake({ cancel: async () => ({ outcome: 'unknown', receipt: unknownReceipt }) }), {
      command,
      signal,
    });
    expect(r.outcome).toBe('unknown');
  });

  it('accepts a coherent accepted cancel that released the reserve exactly once', async () => {
    const r = await cancelWithdrawal(
      historyFake({ cancel: async () => ({ outcome: 'cancelled', receipt: acceptedReceipt, request: cancelledReq }) }),
      { command, signal },
    );
    expect(r.outcome).toBe('cancelled');
  });

  it('rejects a cancelled envelope whose request still holds a reservation', async () => {
    await expect(
      cancelWithdrawal(
        historyFake({ cancel: async () => ({ outcome: 'cancelled', receipt: acceptedReceipt, request: requestedReq }) }),
        { command, signal },
      ),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a found recovery claiming accepted while the request is still reserved', async () => {
    await expect(
      recoverCancellation(
        historyFake({ recoverCancellation: async () => ({ state: 'found', receipt: acceptedReceipt, request: requestedReq }) }),
        { scope, operationKey: 'op-1', signal },
      ),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a found accepted recovery with no released request record', async () => {
    await expect(
      recoverCancellation(
        historyFake({ recoverCancellation: async () => ({ state: 'found', receipt: acceptedReceipt, request: null }) }),
        { scope, operationKey: 'op-1', signal },
      ),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('accepts a found accepted recovery whose request was released once', async () => {
    const r = await recoverCancellation(
      historyFake({ recoverCancellation: async () => ({ state: 'found', receipt: acceptedReceipt, request: cancelledReq }) }),
      { scope, operationKey: 'op-1', requestRef: 'req-a', signal },
    );
    expect(r.state).toBe('found');
  });

  it('accepts a found unknown recovery that keeps the reservation on an active request', async () => {
    const r = await recoverCancellation(
      historyFake({ recoverCancellation: async () => ({ state: 'found', receipt: unknownReceipt, request: requestedReq }) }),
      { scope, operationKey: 'op-1', signal },
    );
    expect(r.state).toBe('found');
  });
});

// =====================================================================================
// S03 — timeline legality: strictly increasing seq, kind<->status, legal transitions,
// submitted/legacy-snapshot prefix and honest incomplete history
// =====================================================================================

describe('S03 timeline legality', () => {
  const detailWithTimeline = (timeline: unknown[], over: Record<string, unknown> = {}) =>
    detailFound({ timeline, ...over });

  it('accepts a legal complete timeline (submitted -> processing -> paid)', async () => {
    const paidReq = { ...requestedReq, status: 'paid', reserved: m('0') };
    const detail = detailWithTimeline(
      [
        { seq: 1, at: '2026-09-16T00:00:00Z', kind: 'submitted', status: 'requested', detail: null },
        { seq: 2, at: '2026-09-16T00:01:00Z', kind: 'processing', status: 'processing', detail: null },
        { seq: 3, at: '2026-09-16T00:02:00Z', kind: 'paid', status: 'paid', detail: null },
      ],
      { request: paidReq },
    );
    const r = await loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal });
    expect(r.state).toBe('found');
  });

  it('rejects paid -> requested with a duplicate sequence and kind/status mismatch (probe S03)', async () => {
    const detail = detailWithTimeline([
      { seq: 1, at: '2026-09-16T00:00:00Z', kind: 'submitted', status: 'requested', detail: null },
      { seq: 2, at: '2026-09-16T00:00:00Z', kind: 'paid', status: 'paid', detail: null },
      { seq: 2, at: '2026-09-16T00:00:00Z', kind: 'processing', status: 'requested', detail: null },
    ]);
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a non-strictly-increasing sequence', async () => {
    const paidReq = { ...requestedReq, status: 'paid', reserved: m('0') };
    const detail = detailWithTimeline(
      [
        { seq: 5, at: '2026-09-16T00:00:00Z', kind: 'submitted', status: 'requested', detail: null },
        { seq: 5, at: '2026-09-16T00:01:00Z', kind: 'paid', status: 'paid', detail: null },
      ],
      { request: paidReq },
    );
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects an event kind that disagrees with its status', async () => {
    const detail = detailWithTimeline([
      { seq: 1, at: '2026-09-16T00:00:00Z', kind: 'submitted', status: 'requested', detail: null },
      { seq: 2, at: '2026-09-16T00:01:00Z', kind: 'processing', status: 'paid', detail: null },
    ]);
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a complete history that does not begin with submission', async () => {
    const detail = detailWithTimeline([
      { seq: 1, at: '2026-09-16T00:00:00Z', kind: 'legacy_snapshot', status: 'requested', detail: null },
    ]);
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a timeline tail that does not match the request status', async () => {
    const detail = detailWithTimeline([
      { seq: 1, at: '2026-09-16T00:00:00Z', kind: 'submitted', status: 'requested', detail: null },
      { seq: 2, at: '2026-09-16T00:01:00Z', kind: 'paid', status: 'paid', detail: null },
    ]); // request is still `requested`
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('accepts an honest incomplete (v1) history as a legacy snapshot at the original submittedAt', async () => {
    const detail = detailWithTimeline(
      [{ seq: 1, at: reconcilingReq.submittedAt, kind: 'legacy_snapshot', status: 'reconciling', detail: null }],
      { request: reconcilingReq, historyComplete: false, sourceContext: { state: 'unavailable', reasons: ['legacy'] } },
    );
    const r = await loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal });
    expect(r.state).toBe('found');
  });

  it('accepts a legacy snapshot followed by a real appended transition', async () => {
    const paidReq = { ...requestedReq, status: 'paid', reserved: m('0') };
    const detail = detailWithTimeline(
      [
        { seq: 1, at: requestedReq.submittedAt, kind: 'legacy_snapshot', status: 'reconciling', detail: null },
        { seq: 2, at: '2026-09-16T01:00:00Z', kind: 'paid', status: 'paid', detail: null },
      ],
      { request: paidReq, historyComplete: false, sourceContext: { state: 'unavailable', reasons: ['legacy'] } },
    );
    const r = await loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal });
    expect(r.state).toBe('found');
  });

  it('rejects an incomplete history that invents a submitted-at-current-status event', async () => {
    const detail = detailWithTimeline(
      [{ seq: 1, at: reconcilingReq.submittedAt, kind: 'submitted', status: 'reconciling', detail: null }],
      { request: reconcilingReq, historyComplete: false, sourceContext: { state: 'unavailable', reasons: ['legacy'] } },
    );
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });

  it('rejects a legacy snapshot that is not anchored to the original submittedAt', async () => {
    const detail = detailWithTimeline(
      [{ seq: 1, at: '2026-09-16T09:00:00Z', kind: 'legacy_snapshot', status: 'reconciling', detail: null }],
      { request: reconcilingReq, historyComplete: false, sourceContext: { state: 'unavailable', reasons: ['legacy'] } },
    );
    await expect(
      loadWithdrawalDetail(historyFake({ detail: async () => detail }), { scope, requestRef: 'req-a', signal }),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });
});

// =====================================================================================
// S04 — a resolved cancellation-OPERATION failure is historical: recovering it stays valid
// after the request later proceeds to paid / failed / cancelled (by a NEW operation), while an
// accepted claim over a live reserve and an unresolved-over-terminal remain rejected.
// =====================================================================================

describe('S04 historical operation_failed receipt survives later request outcomes', () => {
  const failedReceipt: WithdrawalCancellationReceiptValue = {
    ...receiptBase,
    outcome: 'operation_failed',
    code: 'not_cancellable',
    resolvedAt: '2026-09-16T00:01:00Z',
  };
  const laterStates: [string, WithdrawalRequestValue][] = [
    ['paid', { ...requestedReq, status: 'paid', reserved: m('0'), allowedActions: ['check_status'] }],
    ['failed', { ...requestedReq, status: 'failed', reserved: m('0'), allowedActions: ['check_status', 'contact_support'] }],
    ['cancelled', cancelledReq],
  ];
  it.each(laterStates)(
    'recovers a past failed cancellation with a subsequently %s request, keeping the exact record',
    async (_label, request) => {
      const r = await recoverCancellation(
        historyFake({ recoverCancellation: async () => ({ state: 'found', receipt: failedReceipt, request }) }),
        { scope, operationKey: 'op-1', requestRef: 'req-a', signal },
      );
      expect(r.state).toBe('found');
      if (r.state === 'found') {
        // The original failed receipt is preserved verbatim alongside the current request status.
        expect(r.receipt).toEqual(failedReceipt);
        expect(r.request).toEqual(request);
      }
    },
  );

  it('still rejects an accepted receipt whose request is not released, and an unknown over a terminal request', async () => {
    await expect(
      recoverCancellation(
        historyFake({
          recoverCancellation: async () => ({
            state: 'found',
            receipt: acceptedReceipt,
            request: { ...requestedReq, status: 'paid', reserved: m('0') },
          }),
        }),
        { scope, operationKey: 'op-1', signal },
      ),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
    await expect(
      recoverCancellation(
        historyFake({ recoverCancellation: async () => ({ state: 'found', receipt: unknownReceipt, request: cancelledReq }) }),
        { scope, operationKey: 'op-1', signal },
      ),
    ).rejects.toBeInstanceOf(WithdrawalResponseError);
  });
});

// =====================================================================================
// List — full six-field scope on the envelope and on every row
// =====================================================================================

describe('history list scope isolation', () => {
  it('accepts an in-scope list and rejects a foreign row', async () => {
    const ok = await loadWithdrawalList(
      historyFake({ list: async () => ({ scope, asOf: '2026-09-16T00:02:00Z', items: [requestedReq], nextCursor: null, revision: 'r1' }) }),
      { scope, signal },
    );
    expect(ok.items).toHaveLength(1);
    await expect(
      loadWithdrawalList(
        historyFake({
          list: async () => ({
            scope,
            asOf: '2026-09-16T00:02:00Z',
            items: [{ ...requestedReq, scope: foreign }],
            nextCursor: null,
            revision: 'r1',
          }),
        }),
        { scope, signal },
      ),
    ).rejects.toMatchObject({ reason: 'scope_mismatch' });
  });
});

// =====================================================================================
// Controller lifecycle: money conservation, transitions, durable cancellation, v1->v2
// migration, frozen provenance and the shared runtime registry. These drive the REAL
// synthetic controller (through the dev transport + model loaders where end-to-end coherence
// matters), not hand-built payloads.
// =====================================================================================

function counterId() {
  let n = 0;
  return { next: (prefix: string) => `${prefix}-${++n}` };
}
function mutableClock(startMs = 0) {
  let t = startMs;
  return { clock: { now: () => new Date(t) }, advance: (ms: number) => (t += ms) };
}
const gscope = (scenario: ScenarioName = 'golden'): WithdrawalScopeValue => ({ ...scope, scenario });
function makeCtl(scenario: ScenarioName = 'golden', storage?: DevKeyValueStorage) {
  const controller = createWithdrawalController({ scope: gscope(scenario), storage, idGen: counterId() });
  // This file exercises the WU02 lifecycle/cancellation machinery, which is built on a NEW submit
  // sitting at `requested` (the only cancellable status). Automatic initiation now advances a NEW
  // valid submit to `processing`; to PRESERVE this meaningful cancellation/lifecycle coverage without
  // weakening it, seed legacy `requested` records via the explicit test-only initiation seam.
  // (Automatic initiation itself is covered by tests/unit/wallet-redesign-system.test.ts and the
  // updated preview/latest/staff-system tests.)
  controller.setSubmitInitiationMode('legacy_manual');
  return controller;
}
function submissionFrom(q: WithdrawalQuoteValue, key: string): WithdrawalSubmissionValue {
  if (q.state !== 'quoted') throw new Error('quote is not confirmable');
  return { scope: q.scope, idempotencyKey: key, quoteId: q.quoteId, gross: q.gross, net: q.net, bindings: q.bindings };
}
function reqRefOf(r: WithdrawalSubmitResultValue): string {
  if (r.outcome === 'rejected') throw new Error(`unexpected submit reject: ${r.detail}`);
  return r.request.requestRef;
}
function cmdFor(
  c: ReturnType<typeof makeCtl>,
  requestRef: string,
  key: string,
  operationKey: string,
  scenario: ScenarioName = 'golden',
): WithdrawalCancelCommandValue {
  return {
    scope: gscope(scenario),
    requestRef,
    requestIdempotencyKey: key,
    operationKey,
    expectedRevision: c.summary().revision,
  };
}

describe('controller money conservation across the lifecycle', () => {
  it('paid converts reserved GROSS (not net) to settled exactly once', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k1')));
    expect(c.summary().balance).toMatchObject({ available: m('1500000'), reserved: m('500000') });
    c.markPaid(ref);
    expect(c.summary().balance).toMatchObject({ available: m('1500000'), reserved: m('0'), settled: m('500000') });
    // Re-marking paid is an illegal transition (terminal) and never double-settles.
    c.markPaid(ref);
    expect(c.summary().balance).toMatchObject({ settled: m('500000'), available: m('1500000') });
  });

  it('a WHT request settles gross 5,000 though net cash is 4,850', () => {
    const c = makeCtl('applies-wht');
    const q = c.quote('500000');
    expect(q).toMatchObject({ state: 'quoted', net: m('485000') });
    const ref = reqRefOf(c.submit(submissionFrom(q, 'k')));
    c.markPaid(ref);
    expect(c.summary().balance).toMatchObject({ settled: m('500000'), reserved: m('0'), available: m('1500000') });
  });

  it('confirmed failure returns the reserve; reconciling retains it', () => {
    const c = makeCtl('golden');
    c.markFailed(reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k'))));
    expect(c.summary().balance).toMatchObject({ available: m('2000000'), reserved: m('0') });
    const c2 = makeCtl('golden');
    c2.markReconciling(reqRefOf(c2.submit(submissionFrom(c2.quote('500000'), 'k'))));
    expect(c2.summary().balance).toMatchObject({ available: m('1500000'), reserved: m('500000') });
  });

  it('two released periods total 30,000; a 25,000 request leaves 5,000', () => {
    const c = makeCtl('golden');
    expect(c.releaseNextPeriod()).toBe('period-2026-08');
    expect(c.summary().balance).toMatchObject({ available: m('3000000') });
    c.submit(submissionFrom(c.quote('2500000'), 'k'));
    expect(c.summary().balance).toMatchObject({ available: m('500000'), reserved: m('2500000') });
  });

  it('the zero/deficit/unavailable baselines still work', () => {
    expect(makeCtl('zero-balance').summary().balance).toMatchObject({ state: 'known', available: m('0') });
    expect(makeCtl('deficit').summary().balance).toMatchObject({ state: 'known', available: m('0'), deficit: m('200000') });
    expect(makeCtl('balance-unknown').summary().balance).toMatchObject({ state: 'unavailable' });
  });
});

describe('a status transition stales an outstanding quote even with equal totals', () => {
  it('processing (reserve unchanged) still moves the revision and stales a quote', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k1')));
    const outstanding = c.quote('500000');
    c.markProcessing(ref); // totals unchanged (still reserved), but seq advances
    expect(c.submit(submissionFrom(outstanding, 'k2'))).toMatchObject({ outcome: 'rejected', code: 'stale_quote' });
  });
});

describe('durable cancellation', () => {
  it('cancels once, replays idempotently and refuses a new op on the cancelled request', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    const cmd = cmdFor(c, ref, 'k', 'op1');
    expect(c.cancel(cmd).outcome).toBe('cancelled');
    expect(c.summary().balance).toMatchObject({ available: m('2000000'), reserved: m('0') });
    // Same operationKey replay -> same accepted result, NO second release.
    expect(c.cancel(cmd).outcome).toBe('cancelled');
    expect(c.summary().balance).toMatchObject({ available: m('2000000') });
    // A NEW operationKey against a cancelled request is too late.
    const again = c.cancel(cmdFor(c, ref, 'k', 'op2'));
    expect(again.outcome === 'rejected' && again.receipt.code).toBe('not_cancellable');
  });

  it('an unknown cancellation is durable, retains the reserve and recovers by the same key', () => {
    const storage = memoryStorage();
    const c = makeCtl('golden', storage);
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    c.setCancelMode('unknown');
    expect(c.cancel(cmdFor(c, ref, 'k', 'op1')).outcome).toBe('unknown');
    expect(c.summary().balance).toMatchObject({ available: m('1500000'), reserved: m('500000') });
    // Discoverable after reload; detail exposes the unresolved intent; reserve still held.
    const reloaded = makeCtl('golden', storage);
    const rec = reloaded.recoverCancellation({ operationKey: 'op1' });
    expect(rec.state === 'found' && rec.receipt.outcome).toBe('unknown');
    if (rec.state === 'found') expect(rec.request?.status).toBe('requested');
    const d = reloaded.detail(ref);
    expect(d.state === 'found' && d.detail.pendingCancellations.map((x) => x.operationKey)).toContain('op1');
    expect(reloaded.summary().balance).toMatchObject({ available: m('1500000') });
  });

  it('a definite cancel-operation failure leaves the reserve and permits a new key', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    c.setCancelMode('operation_failure');
    expect(c.cancel(cmdFor(c, ref, 'k', 'op1')).outcome).toBe('operation_failed');
    expect(c.summary().balance).toMatchObject({ available: m('1500000'), reserved: m('500000') });
    c.setCancelMode('success');
    expect(c.cancel(cmdFor(c, ref, 'k', 'op2')).outcome).toBe('cancelled');
    expect(c.summary().balance).toMatchObject({ available: m('2000000') });
    // The historical failed op remains recoverable alongside the now-cancelled request (S04).
    const rec = c.recoverCancellation({ operationKey: 'op1' });
    expect(rec.state === 'found' && rec.receipt.outcome).toBe('operation_failed');
    if (rec.state === 'found') expect(rec.request?.status).toBe('cancelled');
  });

  it('a lost response after an accepted cancel is recovered without a second release', async () => {
    const storage = memoryStorage();
    const c = makeCtl('golden', storage);
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    c.setCancelMode('lost_after_accept');
    const cmd = cmdFor(c, ref, 'k', 'op1');
    await expect(t.cancel({ command: cmd, signal })).rejects.toThrow('lost');
    // Committed exactly once: reserve released.
    expect(c.summary().balance).toMatchObject({ available: m('2000000'), reserved: m('0') });
    // Recovery through the model loader proves end-to-end coherence (accepted + released request).
    const rec = await recoverCancellation(t, { scope: gscope(), operationKey: 'op1', signal });
    expect(rec.state === 'found' && rec.receipt.outcome).toBe('accepted');
    if (rec.state === 'found') expect(rec.request?.status).toBe('cancelled');
    // Retrying the same op RECOVERS the accepted result (the loss was one-time) — no second release.
    // The model loader parses + fully validates the recovered result (typed outcome).
    const retry = await cancelWithdrawal(t, { command: cmd, signal });
    expect(retry.outcome).toBe('cancelled');
    expect(c.summary().balance).toMatchObject({ available: m('2000000') });
  });

  it('a race moves the request first: the cancel OPERATION fails and the request continues', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    c.setCancelMode('race');
    const res = c.cancel(cmdFor(c, ref, 'k', 'op1'));
    expect(res.outcome).toBe('operation_failed');
    const d = c.detail(ref);
    expect(d.state === 'found' && d.detail.request.status).toBe('processing');
    expect(c.summary().balance).toMatchObject({ reserved: m('500000') }); // reserve retained
  });

  it('a stale expected revision is refused without mutation', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    const stale = cmdFor(c, ref, 'k', 'op1');
    c.releaseNextPeriod(); // moves the revision
    const res = c.cancel(stale);
    expect(res.outcome === 'rejected' && res.receipt.code).toBe('stale_revision');
    expect(c.recover({ requestRef: ref })).toMatchObject({ state: 'found', request: { status: 'requested' } });
  });

  it('the same operation key with a different payload is a conflict', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    c.setCancelMode('unknown');
    c.cancel(cmdFor(c, ref, 'k', 'op1'));
    const conflict = c.cancel({ ...cmdFor(c, ref, 'k', 'op1'), expectedRevision: 'different-revision' });
    expect(conflict.outcome === 'rejected' && conflict.receipt.code).toBe('operation_conflict');
  });

  it('a cancelled result passes model validation end-to-end and shows in the list', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    const res = await cancelWithdrawal(t, { command: cmdFor(c, ref, 'k', 'op1'), signal });
    expect(res.outcome).toBe('cancelled');
    const listed = await loadWithdrawalList(t, { scope: gscope(), signal });
    expect(listed.items.find((x) => x.requestRef === ref)?.status).toBe('cancelled');
  });
});

describe('v1 -> v2 in-place migration', () => {
  const storeKey = [WITHDRAWAL_SCENARIO_MARKER, 'golden', 'user-a', 'partner-a', 'perm-a', 'payer-a', 'THB']
    .map(encodeURIComponent)
    .join('::');
  const v1Request = {
    requestRef: 'wr-old',
    idempotencyKey: 'old-key',
    scope: gscope(),
    status: 'requested',
    gross: m('500000'),
    net: m('500000'),
    deductions: [],
    reserved: m('500000'),
    beneficiary: { displayName: 'x', bankName: 'y', maskedAccount: 'zzz1', version: 'ben-v1-b0' },
    quoteId: 'q-old',
    bindings: { balanceRevision: 'b', policyRevision: 'p', beneficiaryVersion: 'ben-v1-b0' },
    submittedAt: '2026-09-01T00:00:00Z',
    allowedActions: ['cancel', 'check_status'],
  };
  const v1Blob = {
    version: 1,
    scope: gscope(),
    scenario: 'golden',
    requests: [v1Request],
    releasedPeriods: [],
    controls: { staleQuote: false, changedBeneficiary: false, unknownOutcome: false },
    beneficiaryBump: 0,
    staleBump: 0,
  };

  it('preserves the request and marks history incomplete with an honest legacy snapshot', async () => {
    const storage = memoryStorage();
    storage.setItem(storeKey, JSON.stringify(v1Blob));
    const c = makeCtl('golden', storage);
    // Ref/key/amount/beneficiary/submittedAt preserved exactly; no reset.
    expect(c.recover({ idempotencyKey: 'old-key' })).toMatchObject({
      state: 'found',
      request: { requestRef: 'wr-old', submittedAt: '2026-09-01T00:00:00Z', reserved: m('500000') },
    });
    expect(c.summary().balance).toMatchObject({ available: m('1500000') });
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const d = await loadWithdrawalDetail(t, { scope: gscope(), requestRef: 'wr-old', signal });
    expect(d.state).toBe('found');
    if (d.state === 'found') {
      expect(d.detail.historyComplete).toBe(false);
      expect(d.detail.timeline).toHaveLength(1);
      expect(d.detail.timeline[0]).toMatchObject({ kind: 'legacy_snapshot', at: '2026-09-01T00:00:00Z', status: 'requested' });
      expect(d.detail.sourceContext.state).toBe('unavailable');
    }
  });

  it('upgrades the stored bytes to v2 on the next save', () => {
    const storage = memoryStorage();
    storage.setItem(storeKey, JSON.stringify(v1Blob));
    const c = makeCtl('golden', storage);
    c.releaseNextPeriod(); // any mutation persists
    const stored = JSON.parse(storage.getItem(storeKey) as string);
    expect(stored.version).toBe(STORE_VERSION);
    expect(stored.requests[0].requestRef).toBe('wr-old');
    expect(stored.requests[0].historyComplete).toBe(false);
  });
});

describe('frozen source provenance', () => {
  it('freezes provenance at submission; a later release does not rewrite it', () => {
    const c = makeCtl('golden');
    const ref1 = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k1')));
    const d1 = c.detail(ref1);
    if (d1.state === 'found' && d1.detail.sourceContext.state === 'known') {
      expect(d1.detail.sourceContext.allocationModeled).toBe(false);
      expect(d1.detail.sourceContext.periods.map((p) => p.periodId).sort()).toEqual([
        'period-2026-06',
        'period-2026-07',
      ]);
    } else throw new Error('expected known provenance');
    c.releaseNextPeriod();
    const ref2 = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k2')));
    const d2 = c.detail(ref2);
    if (d2.state === 'found' && d2.detail.sourceContext.state === 'known')
      expect(d2.detail.sourceContext.periods.map((p) => p.periodId)).toContain('period-2026-08');
    // The earlier request's provenance is unchanged.
    const d1b = c.detail(ref1);
    if (d1b.state === 'found' && d1b.detail.sourceContext.state === 'known')
      expect(d1b.detail.sourceContext.periods.map((p) => p.periodId)).not.toContain('period-2026-08');
  });
});

describe('history list ordering and detail found/missing', () => {
  it('lists all requests newest-first and serves detail found/missing', () => {
    const { clock, advance } = mutableClock(0);
    const c = createWithdrawalController({ scope: gscope(), idGen: counterId(), clock });
    const r1 = reqRefOf(c.submit(submissionFrom(c.quote('100000'), 'k1')));
    advance(1000);
    const r2 = reqRefOf(c.submit(submissionFrom(c.quote('100000'), 'k2')));
    expect(c.list().items.map((x) => x.requestRef)).toEqual([r2, r1]);
    expect(c.detail('does-not-exist')).toMatchObject({ state: 'missing', requestRef: 'does-not-exist' });
  });
});

describe('shared runtime registry (one writer per scope + storage)', () => {
  it('shares a controller for the same scope+storage, isolates other scopes, refreshes on mutation', () => {
    const storage = memoryStorage();
    const opts = { scope: gscope(), storage, latencyMs: 0, idGen: counterId() };
    const a = getWithdrawalRuntime(opts);
    expect(getWithdrawalRuntime(opts).controller).toBe(a.controller);
    const other = getWithdrawalRuntime({ ...opts, scope: { ...gscope(), payerId: 'SYNTH-payer-b' } });
    expect(other.controller).not.toBe(a.controller);

    let ticks = 0;
    const unsub = a.subscribe(() => (ticks += 1));
    const before = a.version();
    a.controller.submit(submissionFrom(a.controller.quote('500000'), 'k'));
    expect(ticks).toBeGreaterThan(0);
    expect(a.version()).toBeGreaterThan(before);

    // Unsubscribing NEVER aborts a command: a subsequent command still commits.
    unsub();
    a.controller.releaseNextPeriod();
    expect(a.controller.summary().balance).toMatchObject({ state: 'known' });

    releaseWithdrawalRuntime(storage, opts.scope);
    expect(getWithdrawalRuntime(opts).controller).not.toBe(a.controller);
  });
});

// =====================================================================================
// Runtime probes S05 (durable intent before async), S06 (reactive UI version distinct from
// the financial seq), S07 (sequence budget checked BEFORE mutation), and explicit-reset epoch.
// =====================================================================================

describe('S05 durable cancellation intent before the async outcome', () => {
  it('a hard reload during send discovers the operation and recovers by the same key', async () => {
    const storage = memoryStorage();
    const c = makeCtl('golden', storage);
    const t = createWithdrawalTransport(c, { latencyMs: 30 });
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    c.setCancelMode('unknown');
    const cmd = cmdFor(c, ref, 'k', 'op1');
    const pending = t.cancel({ command: cmd, signal }); // persists intent, THEN delays
    // Reconstruct from the SAME storage DURING the delay: the intent is already durable.
    const restored = makeCtl('golden', storage);
    const before = restored.recoverCancellation({ operationKey: 'op1', requestRef: ref });
    expect(before.state).toBe('found');
    if (before.state === 'found') {
      expect(before.receipt.outcome).toBe('unknown');
      expect(before.request?.status).toBe('requested'); // reserve retained pending resolution
    }
    const resolved = WithdrawalCancelResult.parse(await pending);
    expect(resolved.outcome).toBe('unknown'); // mode unknown stays unresolved
  });
});

describe('S06 reactive UI version is distinct from the financial seq', () => {
  it('read-error / cancel-mode / reset notifications each change version without moving seq', () => {
    const storage = memoryStorage();
    const runtime = getWithdrawalRuntime({ scope: gscope(), storage, latencyMs: 0, idGen: counterId() });
    let notices = 0;
    runtime.subscribe(() => (notices += 1));
    const v0 = runtime.version();
    runtime.controller.setReadError(true);
    const v1 = runtime.version();
    runtime.controller.setReadError(false);
    runtime.controller.setCancelMode('unknown');
    const v2 = runtime.version();
    runtime.controller.reset();
    const v3 = runtime.version();
    expect(new Set([v0, v1, v2, v3]).size).toBe(4); // every notify changed the snapshot
    expect(notices).toBe(4);
    // None of these toggles moved the FINANCIAL seq (no submit happened; reset returns it to 0).
    expect(runtime.controller.mutationSeq()).toBe(0);
    releaseWithdrawalRuntime(storage, gscope());
  });
});

// Read a single-slot fixture storage through its getItem, failing loudly if the expected persisted
// state is ABSENT — an absent seed is a broken fixture, never a silent null fallback.
function readFixture(storage: DevKeyValueStorage): string {
  const raw = storage.getItem('withdrawal-fixture'); // single-slot fixtures ignore the key
  if (typeof raw !== 'string') throw new Error('fixture storage has no persisted state');
  return raw;
}

describe('S07 sequence budget is enforced before any mutation', () => {
  it('a submit at the seq bound is rejected without changing in-memory or persisted state', () => {
    let raw: string | null = null;
    // Single-slot MONEY fixture, but KEY-AWARE for the distinct beneficiary namespace: the payout
    // config lives under a `::beneficiary::` key and must NOT be served the money blob (that would be
    // parsed as a corrupt config -> unavailable). Returning null there keeps the config truly absent
    // (legacy fixture), which is exactly what these sequence-budget assertions rely on.
    const storage: DevKeyValueStorage = {
      getItem: (k) => (k.includes('::beneficiary::') ? null : raw),
      setItem: (k, v) => {
        if (!k.includes('::beneficiary::')) raw = v;
      },
      removeItem: (k) => {
        if (!k.includes('::beneficiary::')) raw = null;
      },
    };
    const seed = makeCtl('golden', storage);
    seed.setUnknownOutcome(false); // force a persist of a fresh v2 blob
    const seeded = JSON.parse(readFixture(storage));
    seeded.seq = 1_000_000;
    raw = JSON.stringify(seeded);
    const c = makeCtl('golden', storage);
    const q = c.quote('500000');
    if (q.state !== 'quoted') throw new Error('quote');
    const before = c.mutationSeq();
    const res = c.submit(submissionFrom(q, 'at-bound'));
    expect(res).toMatchObject({ outcome: 'rejected', code: 'capacity_reached' });
    expect(c.mutationSeq()).toBe(before); // in-memory seq unchanged
    expect(JSON.parse(readFixture(storage)).seq).toBe(1_000_000); // persisted seq unchanged
    expect(c.summary().balance).toMatchObject({ available: m('2000000') }); // known state intact
  });
});

describe('explicit reset supersedes a delayed command (epoch semantics)', () => {
  it('a cancel that began before an explicit reset does not resurrect pre-reset data', async () => {
    const storage = memoryStorage();
    const c = makeCtl('golden', storage);
    const t = createWithdrawalTransport(c, { latencyMs: 20 });
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'k')));
    c.setCancelMode('success');
    const cmd = cmdFor(c, ref, 'k', 'op1');
    const pending = t.cancel({ command: cmd, signal }); // intent persisted, then delay
    const epochBefore = c.epoch();
    c.reset(); // explicit reset DURING the delay
    expect(c.epoch()).toBe(epochBefore + 1);
    const res = WithdrawalCancelResult.parse(await pending); // resolve after reset: intent cleared
    expect(res.outcome).toBe('rejected'); // not_found — nothing resurrected
    expect(c.summary().resume).toEqual([]);
    expect(c.recoverCancellation({ operationKey: 'op1' }).state).toBe('missing');
    expect(c.summary().balance).toMatchObject({ available: m('2000000') });
  });
});

// A storage whose reads can be blocked on demand (throws), without deleting the backing bytes.
function blockableStorage(base: DevKeyValueStorage) {
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

describe('S06 reload publishes a UI snapshot on warning/recovery via the shared runtime', () => {
  it('a reload that raises then clears a persistence warning notifies subscribers each time', () => {
    const base = memoryStorage();
    const { storage, state } = blockableStorage(base);
    const runtime = getWithdrawalRuntime({ scope: gscope(), storage, latencyMs: 0, idGen: counterId() });
    let notices = 0;
    runtime.subscribe(() => (notices += 1));
    const v0 = runtime.version();
    // Reload during a storage read outage: a warning appears and the UI snapshot changes.
    state.blocked = true;
    runtime.controller.reload();
    const v1 = runtime.version();
    expect(v1).not.toBe(v0);
    expect(notices).toBe(1);
    expect(runtime.controller.view().persistenceWarning).toBeTruthy();
    // Reload with the outage cleared: the warning clears and the UI snapshot changes again.
    state.blocked = false;
    runtime.controller.reload();
    const v2 = runtime.version();
    expect(v2).not.toBe(v1);
    expect(notices).toBe(2);
    expect(runtime.controller.view().persistenceWarning).toBeNull();
    releaseWithdrawalRuntime(storage, gscope());
  });

  it('a reload that recovers data after a fresh unreadable restore notifies subscribers', () => {
    const base = memoryStorage();
    // Seed a persisted golden reservation.
    const seed = makeCtl('golden', base);
    seed.submit(submissionFrom(seed.quote('500000'), 'seed-key'));
    const { storage, state } = blockableStorage(base);
    state.blocked = true; // the fresh restore cannot read
    const runtime = getWithdrawalRuntime({ scope: gscope(), storage, latencyMs: 0, idGen: counterId() });
    let notices = 0;
    runtime.subscribe(() => (notices += 1));
    expect(runtime.controller.summary().balance.state).toBe('unavailable'); // no fabricated money
    const v0 = runtime.version();
    // The read recovers: the reservation is restored and a new snapshot is published.
    state.blocked = false;
    runtime.controller.reload();
    expect(runtime.version()).not.toBe(v0);
    expect(notices).toBe(1);
    expect(runtime.controller.summary().balance).toMatchObject({ state: 'known', available: m('1500000') });
    expect(runtime.controller.recover({ idempotencyKey: 'seed-key' })).toMatchObject({ state: 'found' });
    releaseWithdrawalRuntime(storage, gscope());
  });
});

describe('S07 beneficiary bump bound is enforced before any mutation', () => {
  // Seed a controller whose persisted beneficiaryBump/seq are set to the given values.
  function seedBumped(beneficiaryBump: number, seq: number) {
    let raw: string | null = null;
    // Single-slot MONEY fixture, KEY-AWARE for the distinct beneficiary namespace (see the seq-budget
    // fixture above): the `::beneficiary::` key returns null so the config stays truly absent (legacy
    // fixture) instead of parsing the money blob as a corrupt config. These beneficiary-BUMP assertions
    // exercise the money-store beneficiaryBump, which is independent of the payout config store.
    const storage: DevKeyValueStorage = {
      getItem: (k) => (k.includes('::beneficiary::') ? null : raw),
      setItem: (k, v) => {
        if (!k.includes('::beneficiary::')) raw = v;
      },
      removeItem: (k) => {
        if (!k.includes('::beneficiary::')) raw = null;
      },
    };
    const first = makeCtl('golden', storage);
    first.setUnknownOutcome(false); // force a persist of a fresh v2 blob
    const blob = JSON.parse(readFixture(storage));
    blob.beneficiaryBump = beneficiaryBump;
    blob.seq = seq;
    raw = JSON.stringify(blob);
    return { c: makeCtl('golden', storage), read: () => JSON.parse(readFixture(storage)) };
  }

  it('refuses changeBeneficiary at the bound without changing state, revision or bytes', () => {
    const { c, read } = seedBumped(10_000, 10);
    const beforeVersion = c.summary().beneficiary;
    const beforeSeq = c.mutationSeq();
    c.changeBeneficiary();
    expect(c.summary().beneficiary).toEqual(beforeVersion); // beneficiary version unchanged
    expect(c.mutationSeq()).toBe(beforeSeq); // seq unchanged
    expect(read().seq).toBe(10); // persisted seq unchanged
    expect(read().beneficiaryBump).toBe(10_000); // persisted bump unchanged
    expect(c.view().persistenceWarning).toBeNull(); // no warning-only partial change
  });

  it('still increments the beneficiary version normally below the bound', () => {
    const { c, read } = seedBumped(9_999, 10);
    const before = c.summary().beneficiary;
    c.changeBeneficiary();
    expect(c.summary().beneficiary).not.toEqual(before); // version advanced
    expect(c.mutationSeq()).toBe(11); // seq advanced
    expect(read().beneficiaryBump).toBe(10_000); // persisted (still within bound)
  });
});
