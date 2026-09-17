import { describe, expect, it } from 'vitest';
import { createWithdrawalController } from '../../dev/withdrawals/controller';
import { createWithdrawalTransport } from '../../dev/withdrawals/transport';
import {
  memoryStorage,
  WITHDRAWAL_SCENARIO_MARKER,
  type DevKeyValueStorage,
} from '../../dev/withdrawals/store';
import {
  loadPayoutBeneficiaryConfig,
  setPayoutBeneficiary,
} from '@/features/withdrawals/model';
import {
  SetPayoutBeneficiaryCommand,
  type SetPayoutBeneficiaryCommandValue,
  type WithdrawalQuoteValue,
  type WithdrawalScopeValue,
  type WithdrawalSubmissionValue,
  type WithdrawalSubmitResultValue,
} from '@/contracts/withdrawal-journey';
import type { ScenarioName } from '../../dev/withdrawals/scenarios';

// WU03 S2 — shared editable payout beneficiary config. Real controller + Map storage; no mirroring.
// A saved config never writes a raw account number; the mask is resolved from the fixed catalog.

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
type Ctl = ReturnType<typeof makeCtl>;
function saveCmd(
  c: Ctl,
  key: string,
  over: Partial<Pick<SetPayoutBeneficiaryCommandValue, 'displayName' | 'bankId' | 'accountChoiceId'>> = {},
): SetPayoutBeneficiaryCommandValue {
  return {
    scope: gscope(),
    expectedRevision: c.beneficiaryConfig().revision,
    idempotencyKey: key,
    displayName: over.displayName ?? 'มดดำ คชาภา',
    bankId: over.bankId ?? 'bank-scb',
    accountChoiceId: over.accountChoiceId ?? 'acct-1',
  };
}
const key = (segments: string[]) => segments.map(encodeURIComponent).join('::');
const benKey = key([WITHDRAWAL_SCENARIO_MARKER, 'beneficiary', 'golden', 'u1', 'partner-1', 'perm-1', 'labsd-th', 'THB']);
const moneyKey = key([WITHDRAWAL_SCENARIO_MARKER, 'golden', 'u1', 'partner-1', 'perm-1', 'labsd-th', 'THB']);

// A storage that can fault ONLY the beneficiary key's read/write (money store shares the storage).
function benFaultStorage(base: DevKeyValueStorage) {
  const state = { blockWrite: false, blockRead: false };
  const storage: DevKeyValueStorage = {
    getItem: (k) => {
      if (state.blockRead && k.includes('::beneficiary::')) throw new Error('config read denied');
      return base.getItem(k);
    },
    setItem: (k, v) => {
      if (state.blockWrite && k.includes('::beneficiary::')) throw new Error('config write denied');
      base.setItem(k, v);
    },
    removeItem: (k) => base.removeItem(k),
  };
  return { storage, state };
}

// A storage whose beneficiary-key mutations fault AFTER committing (write-then-throw) or on
// removeItem — an UNCERTAIN durable outcome distinct from benFaultStorage's before-write cut. The
// read can also be blocked to force a fail-closed recovery.
function benCutStorage(base: DevKeyValueStorage) {
  const state = { cutAfterWrite: false, cutRemove: false, blockRead: false };
  const storage: DevKeyValueStorage = {
    getItem: (k) => {
      if (state.blockRead && k.includes('::beneficiary::')) throw new Error('config read denied');
      return base.getItem(k);
    },
    setItem: (k, v) => {
      base.setItem(k, v); // commit FIRST, then possibly throw -> the write is durable but "lost"
      if (state.cutAfterWrite && k.includes('::beneficiary::')) throw new Error('after commit');
    },
    removeItem: (k) => {
      if (state.cutRemove && k.includes('::beneficiary::')) throw new Error('remove denied');
      base.removeItem(k);
    },
  };
  return { storage, state };
}

// =====================================================================================
// Save -> pending; blocks; DEV verify enables (one effective beneficiary)
// =====================================================================================

describe('save -> pending blocks; DEV verify enables', () => {
  it('a pending config blocks quote/readiness; simulateVerified enables and shows the catalog mask', () => {
    const c = makeCtl('golden');
    expect(c.quote('500000').state).toBe('quoted'); // fixture known initially
    c.setBeneficiary(saveCmd(c, 'k'));
    expect(c.beneficiaryConfig().state).toBe('pending');
    expect(c.quote('500000')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['beneficiary_pending']),
    });
    expect(c.summary().readiness.requestGate).toBe('blocked');
    c.simulateBeneficiaryVerified();
    expect(c.beneficiaryConfig().state).toBe('verified');
    expect(c.quote('500000').state).toBe('quoted');
    expect(c.summary().readiness.requestGate).toBe('ready');
    expect(c.summary().beneficiary).toMatchObject({ state: 'known', maskedAccount: 'XXX-X-X1234-5' });
  });
});

// =====================================================================================
// Save/replay/stale semantics
// =====================================================================================

describe('save / replay / stale', () => {
  it('a fresh key saves pending; the same key replays as unknown with no write (via the loader)', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const cmd0 = saveCmd(c, 'k');
    const saved = await setPayoutBeneficiary(t, { command: cmd0, signal });
    expect(saved.outcome).toBe('saved');
    if (saved.outcome === 'saved') expect(saved.config.state).toBe('pending');
    const replay = await setPayoutBeneficiary(t, { command: cmd0, signal });
    expect(replay.outcome).toBe('unknown'); // no write, authoritative reread
    expect(c.beneficiaryConfig().state).toBe('pending');
  });

  it('a same-key replay after DEV verify stays unknown and never reverts/claims saved', () => {
    const c = makeCtl('golden');
    const cmd0 = saveCmd(c, 'k');
    c.setBeneficiary(cmd0);
    c.simulateBeneficiaryVerified();
    const replay = c.setBeneficiary(cmd0);
    expect(replay.outcome).toBe('unknown');
    expect(c.beneficiaryConfig().state).toBe('verified'); // unchanged, not reverted to pending
  });

  it('a stale expectedRevision is rejected and never overwrites a newer config', () => {
    const c = makeCtl('golden');
    const cmd0 = saveCmd(c, 'k'); // expectedRevision = c0
    c.setBeneficiary(cmd0); // -> c1 pending
    const stale = c.setBeneficiary({ ...cmd0, idempotencyKey: 'k2' }); // fresh key, OLD revision
    expect(stale.outcome === 'rejected' && stale.code).toBe('stale_revision');
    expect(c.beneficiaryConfig().state).toBe('pending');
    expect(c.beneficiaryConfig().revision).toBe('cfg-golden-c1');
  });
});

// =====================================================================================
// Atomicity / uncertain reply / reboot recovery
// =====================================================================================

describe('atomic write and uncertain reply', () => {
  it('a denied write returns unknown (no false saved); reboot preserves prior state; recovery works', () => {
    const base = memoryStorage();
    const { storage, state } = benFaultStorage(base);
    const c = makeCtl('golden', storage);
    state.blockWrite = true;
    const res = c.setBeneficiary(saveCmd(c, 'k1'));
    expect(res.outcome).toBe('unknown'); // no false saved
    // Reboot: the write never committed -> config absent -> fixture (golden known), not a phantom pending.
    state.blockWrite = false;
    expect(makeCtl('golden', storage).beneficiaryConfig().state).toBe('verified');
    // A subsequent save commits and is recovered on reboot.
    const c2 = makeCtl('golden', storage);
    expect(c2.setBeneficiary(saveCmd(c2, 'k2')).outcome).toBe('saved');
    expect(makeCtl('golden', storage).beneficiaryConfig().state).toBe('pending');
  });

  it("save-mode 'unknown' commits atomically but reports unknown; reboot recovers; replay stays unknown", () => {
    const base = memoryStorage();
    const c = makeCtl('golden', base);
    c.setBeneficiarySaveMode('unknown');
    const res = c.setBeneficiary(saveCmd(c, 'k'));
    expect(res.outcome).toBe('unknown'); // never a false saved/verified
    expect(c.beneficiaryConfig().state).toBe('pending'); // authoritative reread shows the commit
    expect(makeCtl('golden', base).beneficiaryConfig().state).toBe('pending'); // reboot recovers
    const replay = makeCtl('golden', base).setBeneficiary(saveCmd(c, 'k'));
    expect(replay.outcome).toBe('unknown');
  });

  it('a late save after reset is fenced by the captured reset epoch (no post-reset write)', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 20 });
    const cmd0 = saveCmd(c, 'k');
    const pending = setPayoutBeneficiary(t, { command: cmd0, signal });
    c.reset(); // epoch advances; config cleared
    const res = await pending;
    expect(res.outcome).toBe('rejected'); // stale_revision (epoch mismatch)
    expect(c.beneficiaryConfig().state).toBe('verified'); // absent after reset -> golden fixture
  });
});

// =====================================================================================
// Fail-closed: present-invalid/unreadable/foreign-scope vs truly-absent legacy
// =====================================================================================

describe('present-but-invalid config is fail-closed (never fixture)', () => {
  it('a corrupt config reads unavailable, blocks new quotes, and shows summary beneficiary missing', () => {
    const base = memoryStorage();
    base.setItem(benKey, '{"broken":true}');
    const c = makeCtl('golden', base);
    expect(c.beneficiaryConfig().state).toBe('unavailable');
    expect(c.beneficiaryConfig().allowedEdit).toBe(false);
    expect(c.quote('500000')).toMatchObject({
      state: 'unavailable',
      codes: expect.arrayContaining(['beneficiary_unavailable']),
    });
    expect(c.summary().beneficiary.state).toBe('missing');
    expect(c.summary().readiness.requestGate).toBe('blocked');
  });

  it('a config read outage is unavailable (fail-closed), and a bad stored scope is not fixture-verified', () => {
    const base = memoryStorage();
    const { storage, state } = benFaultStorage(base);
    state.blockRead = true;
    expect(makeCtl('golden', storage).beneficiaryConfig().state).toBe('unavailable');
    // Bad stored scope must NOT fall back to a verified fixture.
    const foreign = {
      version: 1,
      scope: { ...gscope(), payerId: 'other-payer' },
      configVersion: 3,
      state: 'verified',
      displayName: 'x',
      bankId: 'bank-scb',
      accountChoiceId: 'acct-1',
      lastSaveKey: 'k',
    };
    const base2 = memoryStorage();
    base2.setItem(benKey, JSON.stringify(foreign));
    expect(makeCtl('golden', base2).beneficiaryConfig().state).toBe('unavailable');
  });

  it('a truly absent (legacy) config uses the scenario fixture only', () => {
    const c = makeCtl('golden', memoryStorage());
    expect(c.beneficiaryConfig().state).toBe('verified'); // golden fixture known
    expect(c.quote('500000').state).toBe('quoted');
  });
});

// =====================================================================================
// Money independence, changed recipient, own revision, foreign scope, capacity, minimization
// =====================================================================================

describe('money independence and quote/request invalidation', () => {
  it('a config save leaves the money-store bytes and requests untouched', () => {
    const base = memoryStorage();
    const c = makeCtl('golden', base);
    reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'req')));
    const moneyBefore = base.getItem(moneyKey);
    c.setBeneficiary(saveCmd(c, 'k'));
    expect(base.getItem(moneyKey)).toBe(moneyBefore); // money v2 bytes preserved
    expect(c.recover({ idempotencyKey: 'req' })).toMatchObject({ state: 'found' });
  });

  it('a config change stales an old quote and never mutates an old frozen request recipient', () => {
    const c = makeCtl('golden');
    const ref = reqRefOf(c.submit(submissionFrom(c.quote('500000'), 'req')));
    const before = c.detail(ref);
    const q = c.quote('300000'); // outstanding quote at the current beneficiary version
    c.setBeneficiary(saveCmd(c, 'k')); // beneficiary version moves (c0 -> c1)
    expect(c.submit(submissionFrom(q, 'late')).outcome).toBe('rejected'); // beneficiary_changed
    const after = c.detail(ref);
    if (before.state === 'found' && after.state === 'found')
      expect(after.detail.request.beneficiary).toEqual(before.detail.request.beneficiary); // frozen
  });

  it("the config's own revision is unaffected by money mutations", () => {
    const c = makeCtl('golden');
    c.setBeneficiary(saveCmd(c, 'k'));
    c.simulateBeneficiaryVerified();
    const rev = c.beneficiaryConfig().revision;
    c.submit(submissionFrom(c.quote('500000'), 'req')); // money seq++
    c.releaseNextPeriod(); // money
    expect(c.beneficiaryConfig().revision).toBe(rev); // unchanged by withdrawals
    expect(c.setBeneficiary(saveCmd(c, 'k2')).outcome).toBe('saved'); // not stale from the withdrawals
  });
});

describe('scope, name, catalog, capacity and data minimization', () => {
  it('rejects a foreign-scope save (command) and a foreign-scope config read (gate)', async () => {
    const c = makeCtl('golden');
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    const foreignCmd = { ...saveCmd(c, 'k'), scope: { ...gscope(), payerId: 'other-payer' } };
    const res = await setPayoutBeneficiary(t, { command: foreignCmd, signal });
    expect(res.outcome === 'rejected' && res.code).toBe('payer_mismatch');
    await expect(
      loadPayoutBeneficiaryConfig(t, { scope: { ...gscope(), payerId: 'other-payer' }, signal }),
    ).rejects.toMatchObject({ reason: 'scope_mismatch' });
  });

  it('rejects a whitespace-only payee name and unknown bank/account choices', () => {
    const c = makeCtl('golden');
    const blank = c.setBeneficiary(saveCmd(c, 'k', { displayName: '   ' }));
    expect(blank.outcome === 'rejected' && blank.code).toBe('invalid_name');
    const badBank = c.setBeneficiary(saveCmd(c, 'k', { bankId: 'nope' }));
    expect(badBank.outcome === 'rejected' && badBank.code).toBe('unknown_bank');
    const badAcct = c.setBeneficiary(saveCmd(c, 'k', { accountChoiceId: 'nope' }));
    expect(badAcct.outcome === 'rejected' && badAcct.code).toBe('unknown_account');
  });

  it('rejects a save at the config-version bound BEFORE any write', () => {
    const base = memoryStorage();
    base.setItem(
      benKey,
      JSON.stringify({
        version: 1,
        scope: gscope(),
        configVersion: 10_000,
        state: 'pending',
        displayName: 'x',
        bankId: 'bank-scb',
        accountChoiceId: 'acct-1',
        lastSaveKey: 'old',
      }),
    );
    const c = makeCtl('golden', base);
    expect(c.beneficiaryConfig().revision).toBe('cfg-golden-c10000');
    const res = c.setBeneficiary(saveCmd(c, 'k-new'));
    expect(res.outcome === 'rejected' && res.code).toBe('capacity_reached');
    expect(c.beneficiaryConfig().revision).toBe('cfg-golden-c10000'); // unchanged
  });

  it('never accepts or persists a raw account number (masked/ids only)', () => {
    // The command is strict: a raw account-number field is rejected outright.
    expect(() =>
      SetPayoutBeneficiaryCommand.parse({
        scope: gscope(),
        expectedRevision: 'cfg-golden-c0',
        idempotencyKey: 'k',
        displayName: 'x',
        bankId: 'bank-scb',
        accountChoiceId: 'acct-1',
        accountNumber: '1234567890',
      }),
    ).toThrow();
    const base = memoryStorage();
    const c = makeCtl('golden', base);
    c.setBeneficiary(saveCmd(c, 'k'));
    const persisted = JSON.parse(base.getItem(benKey) as string);
    expect(persisted).not.toHaveProperty('accountNumber');
    expect(persisted.accountChoiceId).toBe('acct-1'); // a catalog id, not a number
    expect(c.beneficiaryConfig().maskedAccount).toBe('XXX-X-X1234-5'); // resolved masked LABEL
  });
});

// =====================================================================================
// Root S2 reproductions (B-F01..B-F04). Real controller + Map storage; distinct fault cuts.
// =====================================================================================

describe('B-F01 an uncertain config commit is recovered authoritatively', () => {
  it('a write that commits-then-throws is unknown; the NEW pending is recovered and blocks (never the old verified)', () => {
    const base = memoryStorage();
    const { storage, state } = benCutStorage(base);
    const c = makeCtl('golden', storage);
    expect(c.beneficiaryConfig().state).toBe('verified'); // golden fixture (config absent)
    state.cutAfterWrite = true;
    const res = c.setBeneficiary(saveCmd(c, 'k1'));
    expect(res.outcome).toBe('unknown'); // never a false saved
    // A check-current read must be authoritative: the durable record is now a NEW pending config,
    // so the previously-verified fixture can no longer quote.
    expect(c.beneficiaryConfig().state).toBe('pending');
    expect(c.quote('500000').state).not.toBe('quoted');
    // Reboot confirms the recovered in-memory state equals the durable bytes.
    state.cutAfterWrite = false;
    expect(makeCtl('golden', storage).beneficiaryConfig().state).toBe('pending');
  });

  it('when the authoritative reread ALSO fails after an uncertain write, the config is unavailable (fail-closed)', () => {
    const base = memoryStorage();
    const { storage, state } = benCutStorage(base);
    const c = makeCtl('golden', storage);
    state.cutAfterWrite = true;
    state.blockRead = true; // recovery read cannot establish the durable state
    const res = c.setBeneficiary(saveCmd(c, 'k1'));
    expect(res.outcome).toBe('unknown');
    expect(c.beneficiaryConfig().state).toBe('unavailable'); // blocked, not the stale verified
    expect(c.quote('500000').state).not.toBe('quoted');
  });

  it('an uncertain DEV verify write does not falsely mark verified (recovers the durable pending)', () => {
    const base = memoryStorage();
    const { storage, state } = benFaultStorage(base); // before-write cut
    const c = makeCtl('golden', storage);
    c.setBeneficiary(saveCmd(c, 'k')); // pending committed
    state.blockWrite = true;
    c.simulateBeneficiaryVerified(); // the verify write throws before committing
    expect(c.beneficiaryConfig().state).toBe('pending'); // NOT falsely verified in-memory
    expect(c.quote('500000').state).not.toBe('quoted');
    state.blockWrite = false;
    expect(makeCtl('golden', storage).beneficiaryConfig().state).toBe('pending'); // durable pending
  });

  it('an uncertain write does not resurrect a stale outstanding quote for the old recipient', () => {
    const base = memoryStorage();
    const { storage, state } = benCutStorage(base);
    const c = makeCtl('golden', storage);
    const q = c.quote('500000'); // issued against the verified fixture
    expect(q.state).toBe('quoted');
    state.cutAfterWrite = true;
    c.setBeneficiary(saveCmd(c, 'k1')); // uncertain commit -> now durable pending
    if (q.state === 'quoted') expect(c.submit(submissionFrom(q, 'late')).outcome).toBe('rejected');
  });
});

describe('B-F02 an unavailable config is never overwritten by a crafted matching-revision save', () => {
  it('rejects the save, preserves the corrupt bytes, and only an explicit reset re-enables saving', () => {
    const base = memoryStorage();
    const c = makeCtl('golden', base);
    c.setBeneficiary(saveCmd(c, 'k'));
    base.setItem(benKey, '{invalid'); // externally corrupted bytes; UI unavailable on reload
    c.reload();
    expect(c.beneficiaryConfig().state).toBe('unavailable');
    // A crafted command whose expectedRevision COINCIDES with the current (both c0 while unusable).
    const crafted = { ...saveCmd(c, 'k2'), expectedRevision: c.beneficiaryConfig().revision };
    const res = c.setBeneficiary(crafted);
    expect(res.outcome === 'rejected' && res.code).toBe('config_unavailable');
    expect(base.getItem(benKey)).toBe('{invalid'); // bytes untouched (no silent overwrite)
    // An explicit reset re-establishes an authoritative (absent) config; saving is then allowed.
    c.reset();
    expect(c.setBeneficiary(saveCmd(c, 'k3')).outcome).toBe('saved');
  });
});

describe('B-F03 a failed scoped config reset does not reopen the legacy verified fixture', () => {
  it('keeps the durable pending (blocks), matches a reboot, and retains unrelated scopes', () => {
    const base = memoryStorage();
    const { storage, state } = benCutStorage(base);
    const c = makeCtl('golden', storage);
    c.setBeneficiary(saveCmd(c, 'k')); // pending
    // Seed an UNRELATED scope's config (distinct scenario -> distinct key) to prove it survives.
    const other = createWithdrawalController({ scope: gscope('applies-wht'), storage, idGen: counterId() });
    other.setBeneficiary({ ...saveCmd(other, 'ok'), scope: gscope('applies-wht') });
    state.cutRemove = true;
    c.reset(); // the scoped config removeItem throws
    expect(c.beneficiaryConfig().state).not.toBe('verified');
    expect(c.beneficiaryConfig().state).toBe('pending'); // durable config still present
    expect(c.quote('500000').state).not.toBe('quoted');
    // The reboot's authoritative state equals the (failed-reset) current state.
    const reboot = createWithdrawalController({ scope: gscope(), storage, idGen: counterId() });
    expect(reboot.beneficiaryConfig().state).toBe(c.beneficiaryConfig().state);
    // The unrelated scope's config is untouched by this scope's failed reset.
    const otherReboot = createWithdrawalController({ scope: gscope('applies-wht'), storage, idGen: counterId() });
    expect(otherReboot.beneficiaryConfig().state).toBe('pending');
  });
});

describe('B-F04 a semantically-corrupt persisted config reads unavailable, not verified', () => {
  const mutations: Array<[string, (cfg: Record<string, unknown>) => Record<string, unknown>]> = [
    ['unknown catalog bank', (cfg) => ({ ...cfg, bankId: 'not-a-bank' })],
    ['whitespace-only name', (cfg) => ({ ...cfg, displayName: '   ' })],
  ];
  it.each(mutations)('%s -> unavailable; blocks quote; summary/readiness agree; bytes preserved', (_label, mutate) => {
    const base = memoryStorage();
    const c = makeCtl('golden', base);
    c.setBeneficiary(saveCmd(c, 'k'));
    c.simulateBeneficiaryVerified();
    const cfg = JSON.parse(base.getItem(benKey) as string) as Record<string, unknown>;
    expect(cfg.state).toBe('verified'); // schema-valid verified before tampering
    const bytes = JSON.stringify(mutate(cfg));
    base.setItem(benKey, bytes);
    c.reload();
    expect(c.beneficiaryConfig().state).toBe('unavailable');
    expect(c.quote('500000').state).not.toBe('quoted');
    expect(c.summary().beneficiary.state).toBe('missing'); // presentation agrees
    expect(c.summary().readiness.requestGate).toBe('blocked'); // readiness agrees
    expect(base.getItem(benKey)).toBe(bytes); // corrupt bytes preserved (never overwritten)
  });

  it('a coherent verified persisted config still reads verified and quotes (positive control)', () => {
    const base = memoryStorage();
    const c = makeCtl('golden', base);
    c.setBeneficiary(saveCmd(c, 'k'));
    c.simulateBeneficiaryVerified();
    c.reload();
    expect(c.beneficiaryConfig().state).toBe('verified');
    expect(c.quote('500000').state).toBe('quoted');
  });
});

describe('the model loader enforces the documented saved-result promise', () => {
  const savedTransport = (config: unknown, idempotencyKey: string) =>
    ({
      setBeneficiary: async () => ({ outcome: 'saved', scope: gscope(), idempotencyKey, config }),
    }) as unknown as Parameters<typeof setPayoutBeneficiary>[0];

  it('rejects a cross-recipient or non-advanced claimed saved config; accepts a well-formed one', async () => {
    const c = makeCtl('golden');
    const command = saveCmd(c, 'k'); // expectedRevision cfg-golden-c0
    const catalog = c.beneficiaryConfig().catalog;
    const good = {
      scope: gscope(),
      revision: 'cfg-golden-c1', // ADVANCED past the submitted revision
      state: 'pending',
      displayName: command.displayName,
      bankId: command.bankId,
      bankLabel: 'ธนาคารตัวอย่าง เอสซีบี',
      accountChoiceId: command.accountChoiceId,
      maskedAccount: 'XXX-X-X1234-5',
      reasons: ['บัญชีผู้รับเงินอยู่ระหว่างการยืนยัน (ตัวอย่าง)'],
      catalog,
      allowedEdit: true,
    };
    await expect(
      setPayoutBeneficiary(savedTransport({ ...good, displayName: 'someone-else' }, command.idempotencyKey), { command, signal }),
    ).rejects.toMatchObject({ reason: 'identity_mismatch' }); // cross-recipient
    await expect(
      setPayoutBeneficiary(savedTransport({ ...good, revision: command.expectedRevision }, command.idempotencyKey), { command, signal }),
    ).rejects.toMatchObject({ reason: 'invalid' }); // non-advanced revision
    await expect(
      setPayoutBeneficiary(savedTransport({ ...good, bankId: 'not-a-bank' }, command.idempotencyKey), { command, signal }),
    ).rejects.toMatchObject({ reason: 'identity_mismatch' }); // bankId not the submitted one
    const ok = await setPayoutBeneficiary(savedTransport(good, command.idempotencyKey), { command, signal });
    expect(ok.outcome).toBe('saved'); // a well-formed saved result is accepted
  });
});

// =====================================================================================
// B-F05 — the check-current read recovers durable config after a TRANSIENT post-commit read
// outage, via the real model + transport (never a manual controller.reload()).
// =====================================================================================

describe('B-F05 check-current recovers durable config after a transient read outage', () => {
  it('the actual model+transport read rereads durably and the recovered pending is current everywhere', async () => {
    const base = memoryStorage();
    const { storage, state } = benCutStorage(base);
    const c = makeCtl('golden', storage);
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    // A commit-then-throw save AND an immediate recovery reread that also throws -> fail-closed.
    state.cutAfterWrite = true;
    state.blockRead = true;
    expect(c.setBeneficiary(saveCmd(c, 'k1')).outcome).toBe('unknown');
    expect(c.beneficiaryConfig().state).toBe('unavailable'); // read still failing -> blocked
    // Storage reads recover; the ACTUAL check-current read (model -> transport -> controller) must
    // reread the durable record itself — no manual controller.reload().
    state.blockRead = false;
    const config = await loadPayoutBeneficiaryConfig(t, { scope: gscope(), signal });
    expect(config.state).toBe('pending'); // recovered NEW pending, not the stale unavailable
    // The recovered effective beneficiary is now current throughout summary/readiness/quote; the old
    // quote path stays blocked and no original command is auto-resent.
    expect(c.summary().beneficiary.state).toBe('pending');
    expect(c.summary().readiness.requestGate).toBe('blocked');
    expect(c.quote('500000').state).not.toBe('quoted');
  });

  it('remains unavailable while the recovery read keeps failing (fail-closed, no auto-recovery loop)', async () => {
    const base = memoryStorage();
    const { storage, state } = benCutStorage(base);
    const c = makeCtl('golden', storage);
    const t = createWithdrawalTransport(c, { latencyMs: 0 });
    state.cutAfterWrite = true;
    state.blockRead = true;
    expect(c.setBeneficiary(saveCmd(c, 'k1')).outcome).toBe('unknown');
    const config = await loadPayoutBeneficiaryConfig(t, { scope: gscope(), signal });
    expect(config.state).toBe('unavailable'); // still blocked; recovery did not fabricate a state
  });
});
