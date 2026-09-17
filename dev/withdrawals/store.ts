import { z } from 'zod';
import { Id, Instant } from '@/contracts/common';
import {
  MutationSeq,
  QuoteDeduction,
  WithdrawalCancellationReceipt,
  WithdrawalRequest,
  type WithdrawalRequestValue,
  WithdrawalScope,
  WithdrawalSourceContext,
  WithdrawalTimelineEntry,
} from '@/contracts/withdrawal-journey';

// Development-only persistence for the synthetic withdrawal scenario. NEVER imported by any
// product feature/native client and excluded from production by the dev alias/no-demo
// boundary. This unique marker registers the dev store in scripts/verify-no-demo.mjs so a
// leak into a production bundle FAILS the build.
export const WITHDRAWAL_SCENARIO_MARKER = 'synthetic-withdrawal-journey';

// A sessionStorage-like seam. The real preview injects window.sessionStorage; tests inject an
// in-memory or deliberately-faulty implementation. All three methods may throw (quota,
// disabled storage, security errors) and the store handles that without touching auth.
export interface DevKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStorage(seed: Record<string, string> = {}): DevKeyValueStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

// Versioned persisted schema. The `version` literal makes an older/foreign schema fail
// validation, which resets ONLY this namespace (see PersistedStore.load).
export const PersistedControls = z.strictObject({
  staleQuote: z.boolean(),
  changedBeneficiary: z.boolean(),
  unknownOutcome: z.boolean(),
});
export type PersistedControlsValue = z.infer<typeof PersistedControls>;

// WU02 preview control set: extends the WU01 controls with a cancel-simulation mode selecting the
// synthetic outcome of the NEXT cancellation. A DEV control only (Astra surfaces it); never a live
// provider behaviour.
export const CancelSimMode = z.enum([
  'success', // the cancel takes effect (request cancelled, reserve released once)
  'race', // a concurrent transition moved the request first (too-late / not_cancellable)
  'operation_failure', // the cancel OPERATION fails definitively (reserve UNCHANGED; new key allowed)
  'unknown', // the cancel outcome is uncertain (reserve retained; recover by the same key)
  'lost_after_accept', // the cancel WAS accepted (released once) but the response is lost
]);
export type CancelSimModeValue = z.infer<typeof CancelSimMode>;

export const PersistedControlsV2 = PersistedControls.extend({
  cancelMode: CancelSimMode,
});
export type PersistedControlsV2Value = z.infer<typeof PersistedControlsV2>;

// A v1 request evolves into this v2 record WITHOUT losing anything: the immutable WithdrawalRequest
// core plus the FROZEN source-period context, a legal timeline (sequence-ordered) and an explicit
// completeness flag. A v1-upgraded record has `historyComplete: false` and an `unavailable` source
// context — its earlier history is honestly marked unknown, never fabricated.
export const PersistedWithdrawalRecord = WithdrawalRequest.extend({
  timeline: z.array(WithdrawalTimelineEntry).min(1).max(50),
  historyComplete: z.boolean(),
  sourceContext: WithdrawalSourceContext,
});
export type PersistedWithdrawalRecordValue = z.infer<typeof PersistedWithdrawalRecord>;

// The ACTUAL clock time a releasable period was released during a v2 session. Used only to give a
// frozen request's source context an honest `releasedAt` (a v1-migrated release has no recorded
// time, so it is absent here and surfaces as null — never fabricated).
export const ReleaseEvent = z.strictObject({ periodId: Id, at: Instant });
export type ReleaseEventValue = z.infer<typeof ReleaseEvent>;

// v1 (WU01) — kept BYTE-COMPATIBLE so actual WU01 stored blobs still parse and upgrade in place.
export const PersistedStateV1 = z.strictObject({
  version: z.literal(1),
  // The FULL declared scope the state was written under. The store key already namespaces by
  // scope, but persisting the scope lets the controller re-verify identity on load (defence in
  // depth) so a delimiter collision or a hand-edited blob for another actor is caught.
  scope: WithdrawalScope,
  scenario: z.string().min(1).max(80),
  requests: z.array(WithdrawalRequest).max(200),
  releasedPeriods: z.array(Id).max(200),
  controls: PersistedControls,
  beneficiaryBump: z.number().int().min(0).max(10000),
  staleBump: z.number().int().min(0).max(10000),
});
export type PersistedStateV1Value = z.infer<typeof PersistedStateV1>;

// v2 (WU02) — additive: a bounded monotonic mutation `seq` (revision source), records that carry
// timeline + frozen provenance, and a bounded durable cancellation-receipt log. `settled` is NOT
// persisted: it is re-derived from `status === 'paid'` records so a stored figure can never
// disagree with the request set.
export const PersistedStateV2 = z.strictObject({
  version: z.literal(2),
  scope: WithdrawalScope,
  scenario: z.string().min(1).max(80),
  seq: MutationSeq,
  requests: z.array(PersistedWithdrawalRecord).max(200),
  cancellations: z.array(WithdrawalCancellationReceipt).max(400),
  releasedPeriods: z.array(Id).max(200),
  releaseLog: z.array(ReleaseEvent).max(200),
  controls: PersistedControlsV2,
  beneficiaryBump: z.number().int().min(0).max(10000),
  staleBump: z.number().int().min(0).max(10000),
});
export type PersistedStateV2Value = z.infer<typeof PersistedStateV2>;

// Load accepts EITHER version; the controller upgrades a v1 blob in memory and writes v2 on the
// next save. A truly foreign/corrupt blob matches neither arm and resets only this namespace.
export const PersistedState = z.discriminatedUnion('version', [PersistedStateV1, PersistedStateV2]);
export type PersistedStateValue = z.infer<typeof PersistedState>;
export const STORE_VERSION = 2 as const;

// Re-export so callers can reference the request/deduction contracts through the store.
export { WithdrawalRequest, QuoteDeduction };
export type { WithdrawalRequestValue };

export interface LoadResult {
  state: PersistedStateValue | null;
  // A human-facing caveat surfaced verbatim to the preview banner, or null when the load was
  // clean. A schema-invalid/corrupt blob resets the namespace and explains why; a recoverable
  // read OUTAGE warns but LEAVES the stored data untouched (see `readFaulted`).
  warning: string | null;
  // True when the underlying storage denied the READ (threw). The stored bytes were NOT
  // deleted, so a later successful read can still recover them; the caller must not treat this
  // as data loss.
  readFaulted: boolean;
}

// The full declared scope a namespace is keyed by. Two synthetic actors/partners/payers/
// currencies/scenarios therefore never share state (F03: user + permission were previously
// omitted, which let a different actor restore another actor's reserved money).
export interface StoreNamespace {
  scenario: string;
  userId: string;
  partnerId: string;
  permissionRevision: string;
  payerId: string;
  currency: string;
}

// Namespace-isolated store. The key embeds the marker plus the full declared scope, and every
// segment is percent-encoded before the `::` join so a value containing the delimiter can never
// collide two distinct namespaces into one.
export class PersistedStore {
  private readonly key: string;
  constructor(
    private readonly storage: DevKeyValueStorage,
    namespace: StoreNamespace,
  ) {
    this.key = [
      WITHDRAWAL_SCENARIO_MARKER,
      namespace.scenario,
      namespace.userId,
      namespace.partnerId,
      namespace.permissionRevision,
      namespace.payerId,
      namespace.currency,
    ]
      .map((segment) => encodeURIComponent(segment))
      .join('::');
  }

  load(): LoadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      // Storage denied the READ. This is a recoverable outage, NOT data loss: do not delete the
      // stored bytes. Warn and let the caller fall back to defaults in memory only.
      return {
        state: null,
        warning: 'อ่านสถานะตัวอย่างจาก storage ไม่ได้ชั่วคราว (ข้อมูลที่บันทึกไว้ยังอยู่)',
        readFaulted: true,
      };
    }
    if (raw === null) return { state: null, warning: null, readFaulted: false };
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.reset();
      return {
        state: null,
        warning: 'สถานะที่บันทึกไว้เสียหาย จึงรีเซ็ตเฉพาะสถานการณ์นี้',
        readFaulted: false,
      };
    }
    const parsed = PersistedState.safeParse(parsedJson);
    if (!parsed.success) {
      // Invalid/foreign/unknown-version blob: reset just this namespace with a visible warning. A
      // genuine v1 or v2 blob matches the union and is returned for the controller to upgrade/apply.
      this.reset();
      return {
        state: null,
        warning: 'สถานะที่บันทึกไว้ไม่ตรงรูปแบบปัจจุบัน จึงรีเซ็ตเฉพาะสถานการณ์นี้',
        readFaulted: false,
      };
    }
    return { state: parsed.data, warning: null, readFaulted: false };
  }

  // Returns a warning on failure and NEVER claims durability. The caller keeps its in-memory
  // state (a shown submission is not rolled back) but must warn that reload may not restore.
  save(state: PersistedStateValue): string | null {
    try {
      // The controller always writes v2; parsing through the union re-validates every bound BEFORE
      // it is persisted, so the store never writes a blob it could not later read back.
      this.storage.setItem(this.key, JSON.stringify(PersistedState.parse(state)));
      return null;
    } catch {
      return 'บันทึกสถานะตัวอย่างไม่สำเร็จ การรีโหลดอาจไม่คืนสถานะนี้';
    }
  }

  // Clears ONLY this namespace. Returns a durability caveat when the removal fails (the old
  // bytes may still be present and could reappear on reload) so the caller never silently
  // claims a clean reset — otherwise null.
  reset(): string | null {
    try {
      this.storage.removeItem(this.key);
      return null;
    } catch {
      return 'ล้างสถานะตัวอย่างไม่สำเร็จ การรีโหลดอาจคืนสถานะเดิม';
    }
  }
}
