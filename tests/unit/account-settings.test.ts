import { describe, expect, it, vi } from 'vitest';
import {
  filterNotices,
  loadAccountSettings,
  noticeAllowed,
  saveContactPreferences,
  submitAccountRequest,
  validateSnapshotScope,
  type AccountSettingsTransport,
} from '@/features/account/settings-model';
import { ContactPhone } from '@/contracts/account-settings';
import type {
  NotificationPreferencesValue,
  SettingsScopeValue,
} from '@/contracts/account-settings';
import {
  AccountSettingsScopeError,
  ACCOUNT_SETTINGS_MARKER,
  createAccountSettingsTransport,
  memoryAccountStorage,
  type AccountSettingsInitial,
  type DevKeyValueStorage,
} from '../../dev/account-settings-transport';

// Valid FIXTURE scopes and profile — composed in, never a live account.
const scopeA: SettingsScopeValue = {
  userId: 'preview-user',
  partnerId: 'preview-partner',
  permissionRevision: '1',
};
const scopeB: SettingsScopeValue = {
  userId: 'preview-user-b',
  partnerId: 'preview-partner-b',
  permissionRevision: '9',
};
const initialA: AccountSettingsInitial = {
  displayName: 'พาร์ตเนอร์ A',
  currentUsername: 'partner.demo',
};

const signal = () => new AbortController().signal;
const build = (
  overrides: Partial<Parameters<typeof createAccountSettingsTransport>[0]> = {},
): AccountSettingsTransport =>
  createAccountSettingsTransport({
    scope: scopeA,
    storage: memoryAccountStorage(),
    initial: initialA,
    latencyMs: 0,
    ...overrides,
  });

const saveReq = (
  scope: SettingsScopeValue,
  expectedRevision: string,
  idempotencyKey: string,
  preferences: NotificationPreferencesValue,
  email: string | null,
  phone: string | null,
) => ({
  scope,
  expectedRevision,
  idempotencyKey,
  command: { contact: { email, phone }, preferences },
  signal: signal(),
});

const allOn: NotificationPreferencesValue = {
  withdrawals: true,
  releases: true,
  agreements: true,
  accountEvents: true,
};

describe('account-settings snapshot read', () => {
  it('loads unknown (null) contacts, default toggles, current username and honest capabilities', async () => {
    const snap = await loadAccountSettings(build(), scopeA, signal());
    expect(snap.contact).toEqual({ email: null, phone: null });
    expect(snap.preferences).toEqual(allOn);
    expect(snap.currentUsername).toBe('partner.demo');
    expect(snap.revision).toBe('1');
    expect(snap.capabilities).toEqual({
      usernameChange: 'request-intent',
      passwordChange: 'access-preview-lifecycle',
    });
  });

  it('refuses a foreign scope at the gate (no auth assumption, just namespace isolation)', async () => {
    await expect(loadAccountSettings(build(), scopeB, signal())).rejects.toBeInstanceOf(
      AccountSettingsScopeError,
    );
  });
});

describe('account-settings contact/preferences save', () => {
  it('saves optimistically, bumps revision, and restores on reload from the same storage', async () => {
    const storage = memoryAccountStorage();
    const t1 = build({ storage });
    const before = await loadAccountSettings(t1, scopeA, signal());
    const prefs = { ...allOn, releases: false };
    const result = await saveContactPreferences(
      t1,
      saveReq(scopeA, before.revision, 'idem-save-1', prefs, 'a@example.com', '+66 81 000 0000'),
    );
    expect(result.persistenceWarning).toBeNull();
    expect(result.snapshot.contact.email).toBe('a@example.com');
    expect(result.snapshot.preferences.releases).toBe(false);
    expect(result.snapshot.revision).not.toBe(before.revision);

    // Reload = a fresh transport over the same storage adopts the persisted state.
    const reloaded = await loadAccountSettings(build({ storage }), scopeA, signal());
    expect(reloaded.contact.email).toBe('a@example.com');
    expect(reloaded.contact.phone).toBe('+66 81 000 0000');
    expect(reloaded.preferences.releases).toBe(false);
    expect(reloaded.revision).toBe(result.snapshot.revision);
  });

  it('rejects a stale expectedRevision instead of silently overwriting', async () => {
    const t = build();
    const before = await loadAccountSettings(t, scopeA, signal());
    await saveContactPreferences(t, saveReq(scopeA, before.revision, 'idem-a', allOn, null, null));
    await expect(
      saveContactPreferences(
        t,
        saveReq(scopeA, before.revision, 'idem-b', allOn, 'x@example.com', null),
      ),
    ).rejects.toMatchObject({ code: 'stale-revision' });
  });

  it('replays an identical idempotent save once and rejects a reused key with a changed payload', async () => {
    const t = build();
    const rev = (await loadAccountSettings(t, scopeA, signal())).revision;
    const first = await saveContactPreferences(
      t,
      saveReq(scopeA, rev, 'idem-x', allOn, 'same@example.com', null),
    );
    const replay = await saveContactPreferences(
      t,
      saveReq(scopeA, rev, 'idem-x', allOn, 'same@example.com', null),
    );
    expect(replay.snapshot.revision).toBe(first.snapshot.revision); // no double apply
    await expect(
      saveContactPreferences(
        t,
        saveReq(scopeA, rev, 'idem-x', allOn, 'different@example.com', null),
      ),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' });
  });

  it('keeps two scopes isolated on one shared storage object', async () => {
    const storage = memoryAccountStorage();
    const tA = build({ storage });
    const tB = createAccountSettingsTransport({
      scope: scopeB,
      storage,
      initial: { displayName: 'พาร์ตเนอร์ B', currentUsername: 'partner.two' },
      latencyMs: 0,
    });
    const revA = (await loadAccountSettings(tA, scopeA, signal())).revision;
    await saveContactPreferences(
      tA,
      saveReq(scopeA, revA, 'idem-A', allOn, 'a-only@example.com', null),
    );
    const snapB = await loadAccountSettings(tB, scopeB, signal());
    expect(snapB.contact.email).toBeNull();
    expect(snapB.currentUsername).toBe('partner.two');
    expect(snapB.revision).toBe('1');
  });
});

describe('account-settings request intents', () => {
  it('files a pending username-change WITHOUT editing the current login username', async () => {
    const t = build();
    const rev = (await loadAccountSettings(t, scopeA, signal())).revision;
    const result = await submitAccountRequest(t, {
      scope: scopeA,
      expectedRevision: rev,
      idempotencyKey: 'idem-user',
      command: { kind: 'username-change', desiredUsername: 'partner.new' },
      signal: signal(),
    });
    const intent = result.snapshot.requests.at(-1)!;
    expect(intent.kind).toBe('username-change');
    expect(intent.status).toBe('pending');
    expect(intent.desiredUsername).toBe('partner.new');
    expect(result.snapshot.currentUsername).toBe('partner.demo'); // unchanged
    expect(result.requestId).toBe(intent.id);
  });

  it('rejects a username-change request that does not actually change the username', async () => {
    const t = build();
    const rev = (await loadAccountSettings(t, scopeA, signal())).revision;
    await expect(
      submitAccountRequest(t, {
        scope: scopeA,
        expectedRevision: rev,
        idempotencyKey: 'idem-same',
        command: { kind: 'username-change', desiredUsername: 'PARTNER.DEMO' },
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('records deletion/partnership-withdrawal as pending only — no destructive side effect', async () => {
    const t = build();
    const rev = (await loadAccountSettings(t, scopeA, signal())).revision;
    const result = await submitAccountRequest(t, {
      scope: scopeA,
      expectedRevision: rev,
      idempotencyKey: 'idem-del',
      command: { kind: 'account-deletion' },
      signal: signal(),
    });
    const after = await loadAccountSettings(t, scopeA, signal());
    expect(result.snapshot.requests.some((r) => r.kind === 'account-deletion')).toBe(true);
    expect(result.snapshot.requests.every((r) => r.status === 'pending')).toBe(true);
    // Account still fully readable and username intact: nothing was deleted or logged out.
    expect(after.currentUsername).toBe('partner.demo');
    expect(after.requests.length).toBe(1);
  });

  it('dedups the same pending kind even when a distinct key is supplied', async () => {
    const t = build();
    const rev = (await loadAccountSettings(t, scopeA, signal())).revision;
    const cmd = { kind: 'partnership-withdrawal' as const };
    const one = await submitAccountRequest(t, {
      scope: scopeA,
      expectedRevision: rev,
      idempotencyKey: 'idem-wd',
      command: cmd,
      signal: signal(),
    });
    const dup = await submitAccountRequest(t, {
      scope: scopeA,
      expectedRevision: rev,
      idempotencyKey: 'idem-wd',
      command: cmd,
      signal: signal(),
    });
    expect(dup.requestId).toBe(one.requestId);
    expect(dup.snapshot.requests.length).toBe(1);
    const fresh = (await loadAccountSettings(t, scopeA, signal())).revision;
    const two = await submitAccountRequest(t, {
      scope: scopeA,
      expectedRevision: fresh,
      idempotencyKey: 'idem-wd-2',
      command: cmd,
      signal: signal(),
    });
    expect(two.snapshot.requests.length).toBe(1);
    expect(two.requestId).toBe(one.requestId);
  });
});

describe('account-settings storage faults', () => {
  it('does not reset or claim saved when persisted bytes are corrupt', async () => {
    const storage = memoryAccountStorage();
    const t1 = build({ storage });
    const rev = (await loadAccountSettings(t1, scopeA, signal())).revision;
    await saveContactPreferences(
      t1,
      saveReq(scopeA, rev, 'idem-corrupt', allOn, 'keep@example.com', null),
    );
    // Corrupt the persisted blob under this namespace.
    const key = [
      ACCOUNT_SETTINGS_MARKER,
      scopeA.userId,
      scopeA.partnerId,
      scopeA.permissionRevision,
    ]
      .map(encodeURIComponent)
      .join('::');
    storage.setItem(key, '}{ not json');
    const fresh = build({ storage });
    await expect(loadAccountSettings(fresh, scopeA, signal())).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(
      saveContactPreferences(fresh, saveReq(scopeA, '1', 'repair-not-allowed', allOn, null, null)),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      fresh.requestIntent({
        scope: scopeA,
        expectedRevision: '1',
        idempotencyKey: 'fault-intent',
        command: { kind: 'account-deletion' },
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(storage.getItem(key)).toBe('}{ not json');
  });

  it('never overwrites unread state and warns when the read faulted', async () => {
    const sets: Array<[string, string]> = [];
    const faulty: DevKeyValueStorage = {
      getItem: () => {
        throw new Error('read denied');
      },
      setItem: (k, v) => void sets.push([k, v]),
      removeItem: () => undefined,
    };
    const t = build({ storage: faulty });
    await expect(loadAccountSettings(t, scopeA, signal())).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(
      saveContactPreferences(t, saveReq(scopeA, '1', 'idem-faulted', allOn, 'x@example.com', null)),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(sets).toHaveLength(0);
  });

  it('honours an abort signal before answering', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(build({ latencyMs: 5 }).load(scopeA, controller.signal)).rejects.toBeInstanceOf(
      DOMException,
    );
  });
});

describe('account-settings pure helpers', () => {
  it('scope fence validation catches a mismatched snapshot', () => {
    expect(() =>
      validateSnapshotScope(
        {
          revision: '1',
          userId: scopeA.userId,
          partnerId: 'other',
          permissionRevision: '1',
          displayName: 'x',
          currentUsername: 'partner.demo',
          contact: { email: null, phone: null },
          preferences: allOn,
          requests: [],
          capabilities: {
            usernameChange: 'request-intent',
            passwordChange: 'access-preview-lifecycle',
          },
        },
        scopeA,
      ),
    ).toThrow();
  });

  it('notification toggles actually govern which synthetic notices present', () => {
    const prefs = { ...allOn, withdrawals: false };
    expect(noticeAllowed('withdrawals', prefs)).toBe(false);
    expect(noticeAllowed('releases', prefs)).toBe(true);
    const notices = [
      { category: 'withdrawals' as const, text: 'ถอนเงิน' },
      { category: 'releases' as const, text: 'ตัดรอบ' },
    ];
    expect(filterNotices(notices, prefs).map((n) => n.category)).toEqual(['releases']);
  });

  it('uses the injected clock for createdAt (no wall-clock dependency)', async () => {
    const now = vi.fn(() => Date.parse('2026-09-17T10:00:00.000Z'));
    const t = build({ now });
    const rev = (await loadAccountSettings(t, scopeA, signal())).revision;
    const result = await submitAccountRequest(t, {
      scope: scopeA,
      expectedRevision: rev,
      idempotencyKey: 'idem-clock',
      command: { kind: 'account-deletion' },
      signal: signal(),
    });
    expect(result.snapshot.requests.at(-1)!.createdAt).toBe('2026-09-17T10:00:00.000Z');
  });
});

describe('account settings authority hardening', () => {
  it('deduplicates a pending username intent without replacing it with a conflicting new desire', async () => {
    const t = build();
    const request = {
      scope: scopeA,
      expectedRevision: '1',
      idempotencyKey: 'name-first',
      command: { kind: 'username-change' as const, desiredUsername: 'name.next' },
      signal: signal(),
    };
    const first = await submitAccountRequest(t, request);
    await expect(
      submitAccountRequest(t, {
        ...request,
        expectedRevision: first.snapshot.revision,
        idempotencyKey: 'name-conflict',
        command: { kind: 'username-change', desiredUsername: 'name.other' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    const duplicate = await submitAccountRequest(t, {
      ...request,
      expectedRevision: first.snapshot.revision,
      idempotencyKey: 'name-repeat',
    });
    expect(duplicate.requestId).toBe(first.requestId);
    expect(duplicate.snapshot.requests).toHaveLength(1);
    expect(duplicate.snapshot.currentUsername).toBe('partner.demo');
  });
  it('does not register a failed durable intent, and a later retry files exactly one', async () => {
    const backing = memoryAccountStorage();
    let fail = true;
    const storage = {
      ...backing,
      setItem: (key: string, value: string) => {
        if (fail) throw new Error('quota');
        backing.setItem(key, value);
      },
    };
    const t = build({ storage });
    const request = {
      scope: scopeA,
      expectedRevision: '1',
      idempotencyKey: 'intent-retry',
      command: { kind: 'account-deletion' as const },
      signal: signal(),
    };
    await expect(
      t.requestIntent({
        ...request,
        command: { kind: 'account-deletion', extra: 'not allowed' } as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(submitAccountRequest(t, request)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await loadAccountSettings(t, scopeA, signal())).requests).toHaveLength(0);
    fail = false;
    const saved = await submitAccountRequest(t, request);
    expect((await submitAccountRequest(build({ storage }), request)).requestId).toBe(
      saved.requestId,
    );
    expect(saved.snapshot.requests).toHaveLength(1);
  });
  it('fences another user under the same partner on both requests and forged responses', async () => {
    const other = { ...scopeA, userId: 'other-user' };
    const t = build();
    await expect(loadAccountSettings(t, other, signal())).rejects.toMatchObject({
      code: 'forbidden',
    });
    const snapshot = await loadAccountSettings(t, scopeA, signal());
    await expect(
      loadAccountSettings(
        { ...t, load: async () => ({ ...snapshot, userId: other.userId }) },
        scopeA,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'scope-mismatch' });
  });
  it('isolates generations in permission scope and explicit namespaces', async () => {
    const storage = memoryAccountStorage();
    await saveContactPreferences(
      build({ storage, namespace: 'g1' }),
      saveReq(scopeA, '1', 'same-key', allOn, 'g1@example.com', null),
    );
    expect(
      (await loadAccountSettings(build({ storage, namespace: 'g2' }), scopeA, signal())).contact
        .email,
    ).toBeNull();
    const nextScope = { ...scopeA, permissionRevision: 'g2' };
    expect(
      (
        await loadAccountSettings(
          build({ storage, scope: nextScope, namespace: 'g1' }),
          nextScope,
          signal(),
        )
      ).contact.email,
    ).toBeNull();
  });
  it('rereads shared storage and refuses a stale parallel writer without clobbering', async () => {
    const storage = memoryAccountStorage();
    const a = build({ storage }),
      b = build({ storage });
    await loadAccountSettings(b, scopeA, signal());
    await saveContactPreferences(a, saveReq(scopeA, '1', 'first', allOn, 'keep@example.com', null));
    await expect(
      saveContactPreferences(b, saveReq(scopeA, '1', 'second', allOn, 'lost@example.com', null)),
    ).rejects.toMatchObject({ code: 'stale-revision' });
    expect((await loadAccountSettings(b, scopeA, signal())).contact.email).toBe('keep@example.com');
  });
  it('replays a persisted intent after reload and rejects a changed-payload key', async () => {
    const storage = memoryAccountStorage();
    const request = {
      scope: scopeA,
      expectedRevision: '1',
      idempotencyKey: 'durable',
      command: { kind: 'username-change' as const, desiredUsername: 'new.partner' },
      signal: signal(),
    };
    const first = await submitAccountRequest(build({ storage }), request);
    const reloaded = build({ storage });
    expect((await submitAccountRequest(reloaded, request)).requestId).toBe(first.requestId);
    await expect(
      submitAccountRequest(reloaded, {
        ...request,
        command: { kind: 'username-change', desiredUsername: 'other.partner' },
      }),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' });
    expect((await loadAccountSettings(reloaded, scopeA, signal())).requests).toHaveLength(1);
  });
  it('rejects failed persistence without installing an in-memory success or replay', async () => {
    const backing = memoryAccountStorage();
    let fail = true;
    const storage = {
      ...backing,
      setItem: (k: string, v: string) => {
        if (fail) throw new Error('quota');
        backing.setItem(k, v);
      },
    };
    const t = build({ storage });
    const request = saveReq(scopeA, '1', 'retry-save', allOn, 'saved@example.com', null);
    await expect(saveContactPreferences(t, request)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await loadAccountSettings(t, scopeA, signal())).revision).toBe('1');
    await expect(saveContactPreferences(t, request)).rejects.toMatchObject({ code: 'unavailable' });
    fail = false;
    expect((await saveContactPreferences(t, request)).snapshot.contact.email).toBe(
      'saved@example.com',
    );
    expect((await saveContactPreferences(build({ storage }), request)).snapshot.revision).toBe('2');
  });
  it('validates direct commands and prototype-sensitive keys before mutation', async () => {
    const t = build();
    await expect(
      t.saveContactPreferences(saveReq(scopeA, '1', 'bad-phone', allOn, null, '( ) -')),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      t.saveContactPreferences(saveReq(scopeA, '1', '__proto__', allOn, null, null)),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      t.saveContactPreferences(saveReq(scopeA, '1', 'x'.repeat(201), allOn, null, null)),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    const own = saveReq(scopeA, '1', 'toString', allOn, null, null);
    expect((await saveContactPreferences(t, own)).snapshot.revision).toBe('2');
    expect((await saveContactPreferences(t, own)).snapshot.revision).toBe('2');
  });
  it('rejects revision, request and ledger capacity before storage accepts an unpersistable success', async () => {
    const write = vi.fn();
    const storage: DevKeyValueStorage = {
      getItem: () => null,
      setItem: write,
      removeItem: () => {},
    };
    await expect(
      saveContactPreferences(
        build({ storage, initial: { ...initialA, revisionSeq: 1_000_000 } }),
        saveReq(scopeA, '1000000', 'overflow', allOn, null, null),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const requests = Array.from({ length: 50 }, (_, i) => ({
      id: `seed-${i}`,
      reference: `seed-${i}`,
      kind: 'username-change' as const,
      createdAt: '2026-09-17T00:00:00Z',
      status: 'pending' as const,
      desiredUsername: 'already.pending',
    }));
    await expect(
      submitAccountRequest(build({ storage, initial: { ...initialA, requests } }), {
        scope: scopeA,
        expectedRevision: '1',
        idempotencyKey: 'capacity',
        command: { kind: 'account-deletion' },
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(write).not.toHaveBeenCalled();
    const backing = memoryAccountStorage();
    const t = build({ storage: backing });
    await saveContactPreferences(t, saveReq(scopeA, '1', 'seed', allOn, null, null));
    const key = [
      ACCOUNT_SETTINGS_MARKER,
      scopeA.userId,
      scopeA.partnerId,
      scopeA.permissionRevision,
    ]
      .map(encodeURIComponent)
      .join('::');
    const nearCapacity = JSON.parse(backing.getItem(key)!);
    nearCapacity.revisionSeq = 200;
    nearCapacity.ledger = Object.fromEntries(
      Array.from({ length: 199 }, (_, i) => [`seed-${i}`, nearCapacity.ledger.seed]),
    );
    backing.setItem(key, JSON.stringify(nearCapacity));
    // The transport validates the seeded authority before the real boundary commit.
    expect((await loadAccountSettings(t, scopeA, signal())).revision).toBe('200');
    const finalRequest = saveReq(scopeA, '200', 'final-key', allOn, null, null);
    expect((await saveContactPreferences(t, finalRequest)).snapshot.revision).toBe('201');
    const committed = backing.getItem(key);
    await expect(
      saveContactPreferences(t, saveReq(scopeA, '201', 'overflow-key', allOn, null, null)),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(backing.getItem(key)).toBe(committed);
    expect(
      (await saveContactPreferences(build({ storage: backing }), finalRequest)).snapshot.revision,
    ).toBe('201');
    expect(backing.getItem(key)).toBe(committed);
    expect(
      (await loadAccountSettings(build({ storage: backing }), scopeA, signal())).revision,
    ).toBe('201');
  });
  it.each(['( ) -', '12345', '1'.repeat(16)])(
    'rejects an invalid phone digit count: %s',
    (phone) => {
      expect(ContactPhone.safeParse(phone).success).toBe(false);
    },
  );
  it.each(['081-234-5678', '+66 (81) 234 5678', '02123456'])(
    'accepts a formatted real-digit phone: %s',
    (phone) => {
      expect(ContactPhone.safeParse(phone).success).toBe(true);
    },
  );
});
