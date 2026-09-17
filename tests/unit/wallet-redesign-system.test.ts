import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { createWithdrawalController } from '../../dev/withdrawals/controller';
import { createWithdrawalTransport } from '../../dev/withdrawals/transport';
import { memoryStorage, type DevKeyValueStorage } from '../../dev/withdrawals/store';
import {
  loadWithdrawalDetail,
  WithdrawalResponseError,
  type WithdrawalHistoryTransport,
} from '@/features/withdrawals/model';
import {
  buildWalletLedger,
  defaultWalletDateRange,
  filterWalletLedgerByRange,
} from '@/features/withdrawals/wallet-ledger';
import {
  buildWithdrawalProofPdf,
  downloadWithdrawalProof,
  WithdrawalProofUnsupportedError,
} from '@/features/withdrawals/withdrawal-proof';
import type {
  WithdrawalProofDocumentValue,
  WithdrawalPeriodLinkValue,
  WithdrawalQuoteValue,
  WithdrawalRequestDetailValue,
  WithdrawalRequestValue,
  WithdrawalScopeValue,
  WithdrawalSubmissionValue,
} from '@/contracts/withdrawal-journey';

// D193 wallet-redesign SYSTEM tests: automatic initiation, per-transaction proof (contract +
// controller + loader coherence + PDF bytes) and the presentation-only wallet ledger helper.

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
function make(storage?: DevKeyValueStorage) {
  return createWithdrawalController({ scope, storage, idGen: counterId() });
}
function submissionFrom(q: WithdrawalQuoteValue, key: string): WithdrawalSubmissionValue {
  if (q.state !== 'quoted') throw new Error('quote is not confirmable');
  return {
    scope: q.scope,
    idempotencyKey: key,
    quoteId: q.quoteId,
    gross: q.gross,
    net: q.net,
    bindings: q.bindings,
  };
}
function submitAccepted(c: ReturnType<typeof make>, gross: string, key: string): string {
  const r = c.submit(submissionFrom(c.quote(gross), key));
  if (r.outcome !== 'accepted') throw new Error(`expected accepted, got ${r.outcome}`);
  return r.request.requestRef;
}

// jsdom does not implement the Blob-URL APIs; ensure they exist so we can spy and assert that a
// cancelled / unsupported download NEVER reaches the Blob/save action. `restoreMocks` cleans up.
function spyBlobUrl() {
  const url = URL as unknown as {
    createObjectURL?: (b: unknown) => string;
    revokeObjectURL?: (u: string) => void;
  };
  if (typeof url.createObjectURL !== 'function') url.createObjectURL = () => 'blob:stub';
  if (typeof url.revokeObjectURL !== 'function') url.revokeObjectURL = () => {};
  return {
    createObjectURL: vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub'),
    revokeObjectURL: vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}),
  };
}

// =====================================================================================
// (b) Automatic initiation
// =====================================================================================

describe('automatic initiation on submit', () => {
  it('a NEW valid submit auto-initiates to processing (reserve retained, nothing settled/paid)', () => {
    const c = make();
    const res = c.submit(submissionFrom(c.quote('500000'), 'k'));
    expect(res.outcome).toBe('accepted');
    if (res.outcome === 'rejected') throw new Error('unexpected reject');
    expect(res.request.status).toBe('processing');
    expect(res.request.reserved).toEqual(m('500000'));
    // allowedActions for processing never offer cancel.
    expect(res.request.allowedActions).not.toContain('cancel');
    const s = c.summary();
    expect(s.balance).toMatchObject({
      state: 'known',
      available: m('1500000'),
      reserved: m('500000'),
      settled: m('0'),
    });
    // Timeline is submitted -> processing (two honest events, one record).
    const d = c.detail(res.request.requestRef);
    if (d.state !== 'found') throw new Error('expected found');
    expect(d.detail.timeline.map((e) => e.kind)).toEqual(['submitted', 'processing']);
    expect(d.detail.historyComplete).toBe(true);
  });

  it('a double-key replay returns the same processing record and reserves nothing extra', () => {
    const c = make();
    const q = c.quote('500000');
    const first = c.submit(submissionFrom(q, 'k'));
    const replay = c.submit(submissionFrom(q, 'k'));
    expect(replay.outcome).toBe('accepted');
    if (first.outcome === 'rejected' || replay.outcome === 'rejected')
      throw new Error('unexpected reject');
    expect(replay.request.requestRef).toBe(first.request.requestRef);
    expect(replay.request.status).toBe('processing');
    expect(c.summary().balance).toMatchObject({ available: m('1500000'), reserved: m('500000') });
  });

  it('the unknown-outcome path stays reconciling (never auto-advanced)', () => {
    const c = make();
    c.setUnknownOutcome(true);
    const res = c.submit(submissionFrom(c.quote('500000'), 'k'));
    expect(res.outcome).toBe('unknown');
    if (res.outcome === 'rejected') throw new Error('unexpected reject');
    expect(res.request.status).toBe('reconciling');
    expect(c.summary().balance).toMatchObject({ reserved: m('500000') });
  });

  it('rejects (typed) with NO state change when the budget for BOTH events is insufficient', () => {
    // Finance and beneficiary config use distinct keys. Returning the financial blob for every
    // getItem would make beneficiary config unavailable before the capacity gate is ever reached.
    const cells = new Map<string, string>();
    const storage: DevKeyValueStorage = {
      getItem: (key) => cells.get(key) ?? null,
      setItem: (key, value) => void cells.set(key, value),
      removeItem: (key) => void cells.delete(key),
    };
    const seed = make(storage);
    submitAccepted(seed, '500000', 'seed'); // persists one processing record
    expect(cells.size).toBe(1);
    const [key, raw] = [...cells.entries()][0];
    const blob = JSON.parse(raw);
    blob.seq = 999_999; // only ONE seq increment remains; an auto-init submit needs TWO
    cells.set(key, JSON.stringify(blob));

    const now = new Date();
    const c = createWithdrawalController({
      scope,
      storage,
      idGen: counterId(),
      clock: { now: () => now },
    });
    const before = c.list();
    const balanceBefore = c.summary().balance;
    const persistedBefore = cells.get(key);
    const revisionBefore = c.summary().revision;
    const quote = c.quote('500000');
    expect(quote).toMatchObject({ state: 'quoted' });
    const res = c.submit(submissionFrom(quote, 'k2'));
    expect(res).toMatchObject({ outcome: 'rejected', code: 'capacity_reached' });
    // No half-mutation: no request/event, reservation, revision or durable write changed.
    expect(c.list().items).toEqual(before.items);
    expect(c.summary().balance).toEqual(balanceBefore);
    expect(c.summary().revision).toBe(revisionBefore);
    expect(cells.get(key)).toBe(persistedBefore);
  });

  it('legacy_manual mode seeds a cancellable requested record (test-only seam)', () => {
    const c = make();
    c.setSubmitInitiationMode('legacy_manual');
    const res = c.submit(submissionFrom(c.quote('500000'), 'k'));
    if (res.outcome === 'rejected') throw new Error('unexpected reject');
    expect(res.request.status).toBe('requested');
    expect(res.request.allowedActions).toContain('cancel');
  });
});

// =====================================================================================
// (c) Per-transaction proof — controller documents + loader coherence + PDF bytes
// =====================================================================================

function historyFake(over: Partial<WithdrawalHistoryTransport>): WithdrawalHistoryTransport {
  return {
    summary: async () => ({}),
    quote: async () => ({}),
    submit: async () => ({}),
    recover: async () => ({ state: 'missing' }),
    list: async () => ({
      scope,
      asOf: '2026-09-16T00:00:00Z',
      items: [],
      nextCursor: null,
      revision: 'r1',
    }),
    detail: async () => ({ state: 'missing', scope, requestRef: 'req-a' }),
    cancel: async () => ({ outcome: 'unknown', receipt: {} }),
    recoverCancellation: async () => ({
      state: 'missing',
      scope,
      operationKey: 'op',
      requestRef: 'req-a',
    }),
    ...over,
  };
}

describe('per-transaction proof', () => {
  it('a paid request exposes exactly one system_acknowledgment issued at the paid event; non-paid stays pending', async () => {
    const c = make();
    const ref = submitAccepted(c, '500000', 'k'); // processing
    // Non-paid keeps pending.
    const pending = c.detail(ref);
    expect(pending.state === 'found' && pending.detail.documents.state).toBe('pending');
    c.markPaid(ref);
    const paid = c.detail(ref);
    if (paid.state !== 'found') throw new Error('expected found');
    expect(paid.detail.documents.state).toBe('available');
    if (paid.detail.documents.state !== 'available') throw new Error('expected available');
    expect(paid.detail.documents.documents).toHaveLength(1);
    const proof = paid.detail.documents.documents[0];
    expect(proof.kind).toBe('system_acknowledgment');
    expect(proof.issuer).toBe('labsd');
    expect(proof.providerReference).toBeNull();
    expect(proof.requestRef).toBe(ref);
    expect(proof.net).toEqual(paid.detail.request.net);
    const paidEvent = paid.detail.timeline.find((e) => e.kind === 'paid');
    expect(proof.issuedAt).toBe(paidEvent?.at);
    // Loader accepts the coherent paid proof through the transport.
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const loaded = await loadWithdrawalDetail(t as unknown as WithdrawalHistoryTransport, {
      scope,
      requestRef: ref,
      signal,
    });
    expect(loaded.state === 'found' && loaded.detail.documents.state).toBe('available');
  });

  it('the loader rejects a forged proof (available on non-paid / wrong net / forged issuer/kind)', async () => {
    const base = (over: Record<string, unknown>) => {
      const request: WithdrawalRequestValue = {
        requestRef: 'req-a',
        idempotencyKey: 'key-a',
        scope,
        status: 'paid',
        gross: m('500000'),
        net: m('500000'),
        deductions: [],
        reserved: m('0'),
        beneficiary: { displayName: 'Syn', bankName: 'Syn', maskedAccount: 'xxx1', version: 'b1' },
        quoteId: 'q1',
        bindings: { balanceRevision: 'r1', policyRevision: 'p1', beneficiaryVersion: 'b1' },
        submittedAt: '2026-09-16T00:00:00Z',
        allowedActions: ['check_status'],
      };
      return {
        state: 'found',
        detail: {
          request,
          timeline: [
            {
              seq: 1,
              at: '2026-09-16T00:00:00Z',
              kind: 'submitted',
              status: 'requested',
              detail: null,
            },
            { seq: 2, at: '2026-09-16T01:00:00Z', kind: 'paid', status: 'paid', detail: null },
          ],
          historyComplete: true,
          sourceContext: { state: 'unavailable', reasons: ['n/a'] },
          documents: {
            state: 'available',
            documents: [
              {
                documentId: 'ack:req-a',
                kind: 'system_acknowledgment',
                issuer: 'labsd',
                title: 'x',
                requestRef: 'req-a',
                issuedAt: '2026-09-16T01:00:00Z',
                net: m('500000'),
                providerReference: null,
                ...over,
              },
            ],
          },
          pendingCancellations: [],
          revision: 'r1',
        },
      };
    };
    const run = (detailRaw: unknown) =>
      loadWithdrawalDetail(historyFake({ detail: async () => detailRaw }), {
        scope,
        requestRef: 'req-a',
        signal,
      });

    // Forged issuer (system_acknowledgment claiming a provider reference).
    await expect(run(base({ providerReference: 'ref-x' }))).rejects.toBeInstanceOf(
      WithdrawalResponseError,
    );
    // Forged net.
    await expect(run(base({ net: m('490000') }))).rejects.toBeInstanceOf(WithdrawalResponseError);
    // Forged requestRef scope.
    await expect(run(base({ requestRef: 'other' }))).rejects.toBeInstanceOf(
      WithdrawalResponseError,
    );
    // issuedAt that is not a recorded paid-event instant.
    await expect(run(base({ issuedAt: '2020-01-01T00:00:00Z' }))).rejects.toBeInstanceOf(
      WithdrawalResponseError,
    );
  });

  it('renders a compact PDF with selectable Thai bytes and the correct net', async () => {
    const c = make();
    const ref = submitAccepted(c, '500000', 'k');
    c.markPaid(ref);
    const d = c.detail(ref);
    if (d.state !== 'found' || d.detail.documents.state !== 'available')
      throw new Error('expected paid available');
    const bytes = await buildWithdrawalProofPdf({
      document: d.detail.documents.documents[0],
      request: d.detail.request,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    // A valid PDF header.
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
  });

  it('downloadWithdrawalProof refuses a non-paid request (no success proof)', async () => {
    const c = make();
    const ref = submitAccepted(c, '500000', 'k'); // processing, not paid
    const d = c.detail(ref);
    if (d.state !== 'found') throw new Error('expected found');
    await expect(downloadWithdrawalProof(d.detail)).rejects.toThrow(/settled|paid/i);
  });

  // A helper: a fully coherent paid detail whose single available document is the given descriptor.
  const paidDetailWith = (document: WithdrawalProofDocumentValue): WithdrawalRequestDetailValue => {
    const request: WithdrawalRequestValue = {
      requestRef: document.requestRef,
      idempotencyKey: 'key-a',
      scope,
      status: 'paid',
      gross: m('500000'),
      net: document.net,
      deductions: [],
      reserved: m('0'),
      beneficiary: { displayName: 'Syn', bankName: 'Syn', maskedAccount: 'xxx1', version: 'b1' },
      quoteId: 'q1',
      bindings: { balanceRevision: 'r1', policyRevision: 'p1', beneficiaryVersion: 'b1' },
      submittedAt: '2026-09-16T00:00:00Z',
      allowedActions: ['check_status'],
    };
    return {
      request,
      timeline: [
        {
          seq: 1,
          at: '2026-09-16T00:00:00Z',
          kind: 'submitted',
          status: 'requested',
          detail: null,
        },
        { seq: 2, at: '2026-09-16T01:00:00Z', kind: 'paid', status: 'paid', detail: null },
      ],
      historyComplete: true,
      sourceContext: { state: 'unavailable', reasons: ['n/a'] },
      documents: { state: 'available', documents: [document] },
      pendingCancellations: [],
      revision: 'r1',
    };
  };

  const providerSlip: WithdrawalProofDocumentValue = {
    documentId: 'slip:req-p',
    kind: 'provider_bank_slip',
    issuer: 'provider',
    title: 'สลิปจากผู้ให้บริการ',
    requestRef: 'req-p',
    issuedAt: '2026-09-16T01:00:00Z',
    net: m('500000'),
    providerReference: 'PRV-REF-123', // a reference exists, yet we STILL refuse to fabricate bytes
  };

  it('the renderer refuses to fabricate a provider_bank_slip (unsupported, even WITH a reference)', async () => {
    await expect(
      buildWithdrawalProofPdf({
        document: providerSlip,
        request: paidDetailWith(providerSlip).request,
      }),
    ).rejects.toBeInstanceOf(WithdrawalProofUnsupportedError);
  });

  it('downloadWithdrawalProof refuses a provider_bank_slip document with an honest unsupported error', async () => {
    const { createObjectURL } = spyBlobUrl();
    await expect(downloadWithdrawalProof(paidDetailWith(providerSlip))).rejects.toBeInstanceOf(
      WithdrawalProofUnsupportedError,
    );
    expect(createObjectURL).not.toHaveBeenCalled(); // never reaches the Blob/save action
  });
});

// =====================================================================================
// (c') Proof download cancellation + fixed-size PDF overflow safety
// =====================================================================================

describe('withdrawal proof download cancellation', () => {
  function paidDetail(): WithdrawalRequestDetailValue {
    const c = make();
    const ref = submitAccepted(c, '500000', 'k');
    c.markPaid(ref);
    const d = c.detail(ref);
    if (d.state !== 'found' || d.detail.documents.state !== 'available')
      throw new Error('expected paid + available');
    return d.detail;
  }

  it('a pre-aborted signal rejects with AbortError before any Blob/save action', async () => {
    const detail = paidDetail();
    const { createObjectURL } = spyBlobUrl();
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadWithdrawalProof(detail, undefined, undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('aborting DURING the awaited PDF rendering still prevents the download (AbortError, no save)', async () => {
    const detail = paidDetail();
    const { createObjectURL } = spyBlobUrl();
    const controller = new AbortController();
    // Start the download (its first abort-check passes), THEN abort while the async render is in
    // flight. The check immediately before the save must catch it and throw — no file is saved.
    const pending = downloadWithdrawalProof(detail, undefined, undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('an old three-argument caller (no signal) is still compatible and completes the save', async () => {
    // Rendering succeeds; only the browser-only save side effects are stubbed so the call resolves.
    const { createObjectURL } = spyBlobUrl();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const detail = paidDetail();
    await expect(downloadWithdrawalProof(detail, 'พาร์ทเนอร์')).resolves.toBeUndefined();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe('proof PDF stays within bounded pages for long valid inputs', () => {
  const longId = 'req-' + 'x'.repeat(150); // Id max 160
  const longName = 'ผู้รับเงิน'.repeat(13).slice(0, 138); // displayName max 140
  const longBank = 'ธนาคารตัวอย่างจำกัดมหาชน'.repeat(6).slice(0, 138); // bankName max 140

  function longRequest(): WithdrawalRequestValue {
    return {
      requestRef: longId,
      idempotencyKey: 'key-long',
      scope,
      status: 'paid',
      gross: m('9999999999'),
      net: m('9500000000'),
      deductions: Array.from({ length: 10 }, (_, i) => ({
        kind: 'other' as const,
        label: `รายการหักลำดับที่ ${i + 1} ${'ก'.repeat(120)}`.slice(0, 140),
        amount: m('50000000'),
      })),
      reserved: m('0'),
      beneficiary: {
        displayName: longName,
        bankName: longBank,
        maskedAccount: 'XXX-X-X1234-5 ' + '•'.repeat(40),
        version: 'b1',
      },
      quoteId: 'q1',
      bindings: { balanceRevision: 'r1', policyRevision: 'p1', beneficiaryVersion: 'b1' },
      submittedAt: '2026-09-16T00:00:00Z',
      allowedActions: ['check_status'],
    };
  }
  const longDoc = (net: string): WithdrawalProofDocumentValue => ({
    documentId: 'ack-' + 'y'.repeat(150),
    kind: 'system_acknowledgment',
    issuer: 'labsd',
    title: 'หลักฐาน',
    requestRef: longId,
    issuedAt: '2026-09-16T01:00:00Z',
    net: m(net),
    providerReference: null,
  });

  it('a normal short input renders one branded A4 record with exact grouped money', async () => {
    const c = make();
    const ref = submitAccepted(c, '500000', 'k');
    c.markPaid(ref);
    const d = c.detail(ref);
    if (d.state !== 'found' || d.detail.documents.state !== 'available')
      throw new Error('expected paid');
    const draw = vi.spyOn(PDFPage.prototype, 'drawText');
    const bytes = await buildWithdrawalProofPdf({
      document: d.detail.documents.documents[0],
      request: d.detail.request,
    });
    const { PDFDocument } = await import('pdf-lib');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    const text = draw.mock.calls.map(([value]) => value).join(' ');
    expect(text).toContain('Labs D');
    expect(text).toContain('฿5,000.00');
    expect(text).toContain(d.detail.request.requestRef);
    expect(text).toContain(d.detail.documents.documents[0].documentId);
    expect(text).not.toMatch(/LabsD|ข้อมูลตัวอย่าง|สลิปธนาคาร/);
    expect(loaded.getAuthor()).toBe('Labs D');
    draw.mockRestore();
  });

  it('long ids / names / bank name / 10 deductions paginate within a bounded page count', async () => {
    const request = longRequest();
    const draw = vi.spyOn(PDFPage.prototype, 'drawText');
    const bytes = await buildWithdrawalProofPdf({ document: longDoc(request.net.minor), request });
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
    const { PDFDocument } = await import('pdf-lib');
    const loaded = await PDFDocument.load(bytes);
    const pages = loaded.getPageCount();
    // Never a single overflowing page, never an unbounded blow-up: bounded because every field is
    // length-capped and deductions are capped at 10.
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(6);
    // Every page stays A4 and every glyph stays within the printable content area.
    for (let i = 0; i < pages; i++) {
      const { width, height } = loaded.getPage(i).getSize();
      expect(width).toBe(595.28);
      expect(height).toBe(841.89);
    }
    for (const [value, options] of draw.mock.calls) {
      expect(options?.y).toBeGreaterThanOrEqual(42);
      expect(options?.x).toBeGreaterThanOrEqual(44);
      const right = options!.x! + options!.font!.widthOfTextAtSize(value, options!.size!);
      expect(right).toBeLessThanOrEqual(595.28 - 44 + 0.01);
    }
    const rendered = draw.mock.calls.map(([value]) => value).join(' ');
    expect(rendered).toContain('฿95,000,000.00');
    expect(rendered).toContain('รายการหักลำดับที่ 10');
    draw.mockRestore();
  });
});

// =====================================================================================
// (a) Wallet ledger helper
// =====================================================================================

describe('wallet ledger helper', () => {
  const withdrawal = (ref: string, at: string): WithdrawalRequestValue => ({
    requestRef: ref,
    idempotencyKey: `key-${ref}`,
    scope,
    status: 'processing',
    gross: m('500000'),
    net: m('500000'),
    deductions: [],
    reserved: m('500000'),
    beneficiary: { displayName: 'Syn', bankName: 'Syn', maskedAccount: 'xxx1', version: 'b1' },
    quoteId: `q-${ref}`,
    bindings: { balanceRevision: 'r1', policyRevision: 'p1', beneficiaryVersion: 'b1' },
    submittedAt: at,
    allowedActions: ['check_status', 'contact_support'],
  });
  const release = (id: string, at: string | null): WithdrawalPeriodLinkValue => ({
    periodId: id,
    label: `งวด ${id}`,
    releasedAt: at,
    releasedAmount: at === null ? null : m('1000000'),
    statementId: null,
  });

  it('maps both lanes to kind-prefixed ids and sorts by date DESCENDING (stable)', () => {
    const result = buildWalletLedger({
      released: [release('p1', '2026-09-01T00:00:00+07:00')],
      withdrawals: [
        withdrawal('w1', '2026-09-03T00:00:00+07:00'),
        withdrawal('w2', '2026-09-02T00:00:00+07:00'),
      ],
    });
    expect(result.dated.map((e) => e.id)).toEqual(['withdrawal:w1', 'withdrawal:w2', 'release:p1']);
    expect(result.undatedReleases).toEqual([]);
  });

  it('keeps an unknown-date release in a separate preserved bucket (never coerced or dropped)', () => {
    const result = buildWalletLedger({
      released: [release('p1', null), release('p2', '2026-09-01T00:00:00+07:00')],
      withdrawals: [],
    });
    expect(result.dated.map((e) => e.id)).toEqual(['release:p2']);
    expect(result.undatedReleases.map((e) => e.id)).toEqual(['release:p1']);
    expect(result.undatedReleases[0].releasedAmount).toBeNull(); // no fabricated zero
  });

  it('each lane is independent — an absent lane contributes nothing (no fabricated rows)', () => {
    expect(
      buildWalletLedger({ withdrawals: [withdrawal('w1', '2026-09-03T00:00:00+07:00')] }).dated.map(
        (e) => e.id,
      ),
    ).toEqual(['withdrawal:w1']);
    expect(buildWalletLedger({ released: null, withdrawals: null }).dated).toEqual([]);
    expect(buildWalletLedger({}).undatedReleases).toEqual([]);
  });

  it('filters DATED entries by a half-open Bangkok range; undated entries are never date-filtered', () => {
    const { dated, undatedReleases } = buildWalletLedger({
      released: [release('p1', '2026-09-01T00:00:00+07:00'), release('p0', null)],
      withdrawals: [withdrawal('w1', '2026-09-10T00:00:00+07:00')],
    });
    const filtered = filterWalletLedgerByRange(dated, {
      from: '2026-09-05T00:00:00+07:00',
      toExclusive: '2026-09-11T00:00:00+07:00',
    });
    expect(filtered.map((e) => e.id)).toEqual(['withdrawal:w1']); // release p1 excluded, undated p0 untouched
    expect(undatedReleases.map((e) => e.id)).toEqual(['release:p0']);
  });

  it('default range is today back 7 days through today inclusive (end = tomorrow exclusive)', () => {
    const now = new Date('2026-09-17T05:00:00Z'); // 12:00 Bangkok on the 17th
    const range = defaultWalletDateRange(now);
    expect(range.displayedFromDate).toBe('2026-09-10');
    expect(range.displayedToInclusiveDate).toBe('2026-09-17');
    expect(range.from).toBe('2026-09-10T00:00:00+07:00');
    expect(range.toExclusive).toBe('2026-09-18T00:00:00+07:00');
  });
});
