import { pitchStorageKey } from './pitch-storage';
import { z } from 'zod';
import {
  AccountRequestIntent,
  AccountSettingsSnapshot,
  SaveContactPreferences,
  RequestIntentCommand,
  ContactChannels,
  NotificationPreferences,
  SettingsScope,
  type AccountRequestIntentValue,
  type AccountSettingsResultValue,
  type AccountSettingsSnapshotValue,
  type ContactChannelsValue,
  type NotificationPreferencesValue,
  type SettingsScopeValue,
} from '@/contracts/account-settings';
import { Id } from '@/contracts/common';
import { normalizeUsername, Username } from '@/contracts/credentials';
import type {
  AccountRequestRequest,
  AccountSettingsTransport,
  SaveContactPreferencesRequest,
} from '@/features/account/settings-model';

// Development-only, scoped synthetic authority for the account-settings surface (Comment 28). It is
// NEVER imported by any product feature or native client. It performs NO provider/money/native-DB/
// deletion/send side effects: leaving the partnership and account deletion are recorded as pending
// requests only, and the native username is never changed (only a request is filed). Password
// changes are out of scope here entirely (reuse /access-preview). The reused 'synthetic-account-
// request' marker string means that if this dev module ever leaks into a production bundle it TRIPS
// scripts/verify-no-demo.mjs (assertNoProductionFixtures) — no separate registration needed.
export const ACCOUNT_SETTINGS_MARKER = 'synthetic-account-request';

// A sessionStorage-like seam. Real preview injects window.sessionStorage; tests inject an in-memory
// or deliberately faulty implementation. Every method MAY throw (quota/disabled/security); the store
// handles that without ever touching auth or claiming a durable save it did not perform.
export interface DevKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryAccountStorage(seed: Record<string, string> = {}): DevKeyValueStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

// Lazy browser sessionStorage adapter: window is touched only inside a method, never at import, so
// importing this module never throws in SSR and any real access fault reaches the store try/catch.
export const browserAccountSettingsStorage: DevKeyValueStorage = {
  getItem: (key) => window.sessionStorage.getItem(pitchStorageKey(key)),
  setItem: (key, value) => window.sessionStorage.setItem(pitchStorageKey(key), value),
  removeItem: (key) => window.sessionStorage.removeItem(pitchStorageKey(key)),
};

// A persisted idempotency entry: which committed operation a stable key produced. Persisting this is
// what makes idempotency survive a reload — a repeated same-key request after reload replays instead
// of filing a DUPLICATE request; a reused key with a changed payload still conflicts.
const PersistedLedgerEntry = z.strictObject({
  fingerprint: z.string().max(4000),
  requestId: Id.nullable(),
});

// Versioned persisted schema. A foreign/older version fails validation; per root's fault rule that is
// treated as CORRUPT — the load fails `unavailable` and we never silently reset/repair over it.
const PersistedAccountSettings = z.strictObject({
  version: z.literal(1),
  scope: SettingsScope,
  revisionSeq: z.number().int().min(1).max(1_000_000),
  contact: ContactChannels,
  preferences: NotificationPreferences,
  requests: z.array(AccountRequestIntent).max(50),
  // Optional for backward compatibility with blobs written before the ledger existed.
  ledger: z
    .record(z.string().max(200), PersistedLedgerEntry)
    .refine((r) => Object.keys(r).length <= 200, 'ledger too large')
    .default({}),
});
type PersistedAccountSettingsValue = z.infer<typeof PersistedAccountSettings>;
type LedgerEntry = z.infer<typeof PersistedLedgerEntry>;

const DEFAULT_PREFERENCES: NotificationPreferencesValue = {
  withdrawals: true,
  releases: true,
  agreements: true,
  accountEvents: true,
};

// Composition input. Sample display name / username are passed IN (never hard-coded here) so each
// full scope stays isolated. Contacts default to null — real personal contacts are unknown and must
// never be invented.
export interface AccountSettingsInitial {
  displayName: string;
  currentUsername: string;
  contact?: Partial<ContactChannelsValue>;
  preferences?: Partial<NotificationPreferencesValue>;
  requests?: AccountRequestIntentValue[];
  revisionSeq?: number;
}

export interface AccountSettingsTransportOptions {
  scope: SettingsScopeValue;
  storage: DevKeyValueStorage;
  initial: AccountSettingsInitial;
  now?: () => number;
  // OPTIONAL dataset generation/epoch marker. It further partitions the persisted namespace WITHOUT
  // broadening SettingsScope/QueryScope globally: two transports with the same full scope but a
  // different `namespace` never read each other's persisted state (no cross-generation carryover).
  namespace?: string | null;
  // Synthetic round-trip latency (ms); kept short. The abort path is honoured regardless.
  latencyMs?: number;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function scopeEqual(a: SettingsScopeValue, b: SettingsScopeValue): boolean {
  return (
    a.userId === b.userId &&
    a.partnerId === b.partnerId &&
    a.permissionRevision === b.permissionRevision
  );
}

function namespaceKey(scope: SettingsScopeValue, namespace: string | null | undefined): string {
  // The default (no namespace) key is unchanged so existing persisted state keeps loading; a provided
  // namespace appends a distinct final segment, isolating that dataset generation/epoch.
  const base = [ACCOUNT_SETTINGS_MARKER, scope.userId, scope.partnerId, scope.permissionRevision];
  const parts = namespace == null ? base : [...base, namespace];
  return parts.map(encodeURIComponent).join('::');
}

// A scope/availability error surfaced as a plain typed code. Distinct from the model's
// AccountSettingsError so the dev adapter never imports the feature model at runtime (import-closure
// hygiene). `unavailable` means the persisted authority is unreadable/corrupt: reads must NOT present
// composed defaults as loaded settings, and nothing is written over the bad bytes (owner recovery).
export class AccountSettingsScopeError extends Error {
  constructor(
    readonly code:
      'forbidden' | 'stale-revision' | 'idempotency-conflict' | 'invalid-input' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'AccountSettingsScopeError';
  }
}

interface State {
  revisionSeq: number;
  contact: ContactChannelsValue;
  preferences: NotificationPreferencesValue;
  requests: AccountRequestIntentValue[];
  // idempotencyKey -> committed operation. Persisted so idempotency survives a reload.
  ledger: Record<string, LedgerEntry>;
}

// null = healthy; otherwise the persisted authority is unreadable ('read') or corrupt ('corrupt').
type FaultCode = null | 'read' | 'corrupt';

export function createAccountSettingsTransport(
  options: AccountSettingsTransportOptions,
): AccountSettingsTransport {
  const boundScope = SettingsScope.parse(options.scope);
  const clock = options.now ?? (() => Date.now());
  const latency = options.latencyMs ?? 10;
  const key = namespaceKey(boundScope, options.namespace);
  const currentUsername = Username.parse(options.initial.currentUsername);
  const displayName = options.initial.displayName;

  // Compose the in-memory default from `initial`. Contacts stay null unless explicitly provided.
  const composed = (): State => ({
    revisionSeq: options.initial.revisionSeq ?? 1,
    contact: {
      email: options.initial.contact?.email ?? null,
      phone: options.initial.contact?.phone ?? null,
    },
    preferences: { ...DEFAULT_PREFERENCES, ...(options.initial.preferences ?? {}) },
    requests: options.initial.requests ? structuredClone(options.initial.requests) : [],
    ledger: {},
  });

  // Attempt to adopt persisted state. Per root's fault rule, an unreadable read OR corrupt/foreign
  // bytes are NOT silently repaired and the composed defaults are NOT presented as loaded settings:
  // we record a FaultCode and every method then fails `unavailable` until an owner recovers the
  // namespace. A `null` read (nothing stored yet) is the healthy first-run case, not a fault.
  const readState = (): { state: State; faultCode: FaultCode } => {
    let raw: string | null;
    try {
      raw = options.storage.getItem(key);
    } catch {
      return { state: composed(), faultCode: 'read' };
    }
    if (raw === null) return { state: composed(), faultCode: null };
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return { state: composed(), faultCode: 'corrupt' };
    }
    const parsed = PersistedAccountSettings.safeParse(parsedJson);
    if (!parsed.success) return { state: composed(), faultCode: 'corrupt' };
    const persisted: PersistedAccountSettingsValue = parsed.data;
    // A blob written under another scope in our namespace is treated as corrupt, never adopted.
    if (!scopeEqual(persisted.scope, boundScope))
      return { state: composed(), faultCode: 'corrupt' };
    return {
      state: {
        revisionSeq: persisted.revisionSeq,
        contact: persisted.contact,
        preferences: persisted.preferences,
        requests: persisted.requests,
        ledger: persisted.ledger,
      },
      faultCode: null,
    };
  };

  // Storage is the authority, not a construction-time snapshot. Each operation adopts the
  // latest validated state; corrupt/unreadable bytes never become successful default settings.
  const current = (): State => {
    const { state, faultCode } = readState();
    if (faultCode)
      throw new AccountSettingsScopeError(
        'unavailable',
        'อ่านสถานะบัญชีที่บันทึกไว้ไม่ได้ ต้องให้เจ้าของกู้คืนก่อน ระบบจะไม่เขียนทับหรือรีเซ็ตอัตโนมัติ',
      );
    snapshot(state);
    return state;
  };
  const snapshot = (state: State): AccountSettingsSnapshotValue =>
    AccountSettingsSnapshot.parse({
      revision: String(state.revisionSeq),
      userId: boundScope.userId,
      partnerId: boundScope.partnerId,
      permissionRevision: boundScope.permissionRevision,
      displayName,
      currentUsername,
      contact: structuredClone(state.contact),
      preferences: { ...state.preferences },
      requests: structuredClone(state.requests),
      capabilities: {
        usernameChange: 'request-intent',
        passwordChange: 'access-preview-lifecycle',
      },
    });
  const gate = (scope: SettingsScopeValue): void => {
    if (!scopeEqual(SettingsScope.parse(scope), boundScope))
      throw new AccountSettingsScopeError('forbidden', 'ขอบเขตบัญชีที่ร้องขอไม่ตรงกับบริการนี้');
  };
  const commandEnvelope = (request: { idempotencyKey: string; expectedRevision: string }) => {
    if (
      !Id.safeParse(request.expectedRevision).success ||
      !z.string().min(1).max(200).safeParse(request.idempotencyKey).success ||
      ['__proto__', 'prototype', 'constructor'].includes(request.idempotencyKey)
    )
      throw new AccountSettingsScopeError('invalid-input', 'รหัสรายการหรือรุ่นข้อมูลไม่ถูกต้อง');
  };
  const replay = (
    state: State,
    idempotencyKey: string,
    fingerprint: string,
  ): AccountSettingsResultValue | null => {
    if (!Object.hasOwn(state.ledger, idempotencyKey)) return null;
    const prior = state.ledger[idempotencyKey];
    if (prior.fingerprint !== fingerprint)
      throw new AccountSettingsScopeError(
        'idempotency-conflict',
        'รหัสรายการถูกใช้กับคำสั่งอื่นแล้ว',
      );
    return {
      snapshot: snapshot(state),
      idempotencyKey,
      requestId: prior.requestId,
      persistenceWarning: null,
    };
  };
  const requireFresh = (state: State, revision: string) => {
    if (revision !== String(state.revisionSeq))
      throw new AccountSettingsScopeError('stale-revision', 'ข้อมูลบัญชีเปลี่ยนแล้ว กรุณารีเฟรช');
  };
  const commit = (
    previous: State,
    candidate: State,
    idempotencyKey: string,
    fingerprint: string,
    requestId: string | null,
  ): AccountSettingsResultValue => {
    if (previous.revisionSeq >= 1_000_000 || Object.keys(previous.ledger).length >= 200)
      throw new AccountSettingsScopeError(
        'unavailable',
        'พื้นที่บันทึกรายการบัญชีเต็ม กรุณาติดต่อผู้ดูแล',
      );
    candidate.revisionSeq = previous.revisionSeq + 1;
    candidate.ledger = { ...previous.ledger, [idempotencyKey]: { fingerprint, requestId } };
    const parsed = PersistedAccountSettings.safeParse({
      version: 1,
      scope: boundScope,
      ...candidate,
    });
    if (!parsed.success)
      throw new AccountSettingsScopeError(
        'invalid-input',
        'รายการบัญชีไม่ถูกต้องหรือเกินจำนวนที่รองรับ',
      );
    const result = snapshot(candidate);
    // No await between this comparison and synchronous storage commit. This fences parallel
    // preview instances sharing this sessionStorage authority without retaining stale writes.
    if (JSON.stringify(current()) !== JSON.stringify(previous))
      throw new AccountSettingsScopeError('stale-revision', 'ข้อมูลบัญชีเปลี่ยนแล้ว กรุณารีเฟรช');
    try {
      options.storage.setItem(key, JSON.stringify(parsed.data));
    } catch {
      // Reject atomically: candidate and ledger were never installed in memory. A retry can
      // safely attempt the same command again; it cannot falsely replay a durable success.
      throw new AccountSettingsScopeError(
        'unavailable',
        'บันทึกการตั้งค่าบัญชีไม่สำเร็จ กรุณาลองอีกครั้ง',
      );
    }
    return { snapshot: result, idempotencyKey, requestId, persistenceWarning: null };
  };
  return {
    async load(scope, signal) {
      await delay(latency, signal);
      gate(scope);
      return snapshot(current());
    },
    async saveContactPreferences(request: SaveContactPreferencesRequest) {
      await delay(latency, request.signal);
      gate(request.scope);
      commandEnvelope(request);
      const parsed = SaveContactPreferences.safeParse(request.command);
      if (!parsed.success)
        throw new AccountSettingsScopeError('invalid-input', 'ข้อมูลที่กรอกไม่ถูกต้อง');
      const command = parsed.data;
      const state = current();
      const fingerprint = JSON.stringify({ op: 'save', command });
      const replayed = replay(state, request.idempotencyKey, fingerprint);
      if (replayed) return replayed;
      requireFresh(state, request.expectedRevision);
      const candidate = { ...state, contact: command.contact, preferences: command.preferences };
      return commit(state, candidate, request.idempotencyKey, fingerprint, null);
    },
    async requestIntent(request: AccountRequestRequest) {
      await delay(latency, request.signal);
      gate(request.scope);
      commandEnvelope(request);
      const parsed = RequestIntentCommand.safeParse(request.command);
      if (!parsed.success)
        throw new AccountSettingsScopeError('invalid-input', 'ข้อมูลคำขอไม่ถูกต้อง');
      const command = parsed.data;
      const state = current();
      const desiredUsername =
        command.kind === 'username-change' ? normalizeUsername(command.desiredUsername) : null;
      if (command.kind === 'username-change' && desiredUsername === currentUsername)
        throw new AccountSettingsScopeError(
          'invalid-input',
          'ชื่อผู้ใช้ที่ขอเปลี่ยนต้องต่างจากชื่อผู้ใช้ปัจจุบัน',
        );
      const fingerprint = JSON.stringify({ op: 'request', command });
      const replayed = replay(state, request.idempotencyKey, fingerprint);
      if (replayed) return replayed;
      requireFresh(state, request.expectedRevision);
      const pending = state.requests.find(
        (item) => item.kind === command.kind && item.status === 'pending',
      );
      if (pending) {
        if (pending.desiredUsername !== desiredUsername)
          throw new AccountSettingsScopeError(
            'invalid-input',
            'มีคำขอเปลี่ยนชื่อผู้ใช้ที่ยังดำเนินการอยู่',
          );
        return commit(state, { ...state }, request.idempotencyKey, fingerprint, pending.id);
      }
      const seq = state.requests.length + 1;
      const id = ACCOUNT_SETTINGS_MARKER + '-' + command.kind + '-' + seq;
      const intent: AccountRequestIntentValue = {
        id,
        reference: 'acr-' + seq,
        kind: command.kind,
        createdAt: new Date(clock()).toISOString(),
        status: 'pending',
        desiredUsername,
      };
      return commit(
        state,
        { ...state, requests: [...state.requests, intent] },
        request.idempotencyKey,
        fingerprint,
        id,
      );
    },
  };
}
