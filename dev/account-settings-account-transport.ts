import { z } from 'zod';
import { Id, DataState } from '@/contracts/common';
import { Account, AccountAction, AccountActionResult, AccountResponse } from '@/contracts/account';
import type { AccountTransport } from '@/features/account/model';
import type { QueryScope } from '@/shared/query/keys';

type AccountActionResultValue = z.infer<typeof AccountActionResult>;

// Development-only, SCOPED synthetic authority for the account METADATA surface consumed by
// AccountPage (identity / agreement / support / logout). It exists so a partner A/B preview can be
// composed against an EXPLICIT, validated full QueryScope + a composed typed AccountMetadata value,
// instead of the fixed-global `accountScope` factory in dev/account-transport.ts (which cannot render
// two different partners safely). It is NEVER imported by a product feature or the native client.
//
// Honesty guarantees (root review):
//   - No network / native auth request is ever made. Everything is in-memory and per-instance.
//   - No invented agreement/contact: unknown fields stay exactly as composed in (agreement may be
//     null, supportUrl may be null). Nothing is fabricated here.
//   - No fake signout success: `logout` reports an explicitly SIMULATED, local-only sign-out (it only
//     lets AccountPage clear the on-device view); it never claims a native session was invalidated.
//   - The reused 'synthetic-account-request' marker means a leak into a production bundle TRIPS
//     scripts/verify-no-demo.mjs (assertNoProductionFixtures) — no separate registration needed.
export const ACCOUNT_METADATA_MARKER = 'synthetic-account-request';

// A composed, typed metadata value (the `Account` contract). Passed IN by the composition author, so
// each scope stays isolated and no sample identity is hard-coded in this module.
export type AccountMetadata = z.infer<typeof Account>;

// Local scope schema: validate the FULL QueryScope without importing/broadening the global type. The
// global QueryScope is intentionally NOT widened with a dataset generation — see `namespace` below.
const ScopeSchema = z.strictObject({
  userId: Id,
  partnerId: Id,
  permissionRevision: Id,
});

export interface ScopedAccountMetadataOptions {
  // The full scope this transport is bound to. Every read/act is refused for any other scope.
  scope: QueryScope;
  // Composed typed metadata. Its `userId` MUST equal `scope.userId` and, when an agreement is present,
  // `agreement.partnerId` MUST equal `scope.partnerId` — otherwise this is a mis-composed (forged)
  // envelope and the factory throws at construction so the UI author catches it immediately.
  metadata: AccountMetadata;
  // Freshness controls (default a ready snapshot). `unavailable`/`stale` drive AccountPage's banners.
  dataState?: z.infer<typeof DataState>;
  reasons?: readonly string[];
  generatedAt?: string;
  dataThrough?: string | null;
  // Opaque optimistic-concurrency token echoed to AccountPage (default '1').
  revision?: string;
  // OPTIONAL dataset generation/epoch marker. It isolates one composed dataset from another WITHOUT
  // broadening the global QueryScope: it only tags this instance's synthetic requestId so A/B/epoch
  // envelopes are distinguishable. Because the transport holds no shared or persisted state, two
  // instances built for different generations never carry data across.
  namespace?: string | null;
  // Synthetic round-trip latency (ms). The abort path is honoured regardless.
  latencyMs?: number;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
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

function scopeEqual(a: QueryScope, b: QueryScope): boolean {
  return (
    a.userId === b.userId &&
    a.partnerId === b.partnerId &&
    a.permissionRevision === b.permissionRevision
  );
}

export function createScopedAccountTransport(
  options: ScopedAccountMetadataOptions,
): AccountTransport {
  const boundScope = ScopeSchema.parse(options.scope);
  const metadata = Account.parse(options.metadata);
  // Compose-time fence: never let a forged identity/partner slip into the envelope. loadAccount
  // re-checks these at the seam too, but failing loudly here helps the UI author.
  if (metadata.userId !== boundScope.userId)
    throw new Error('AccountMetadata.userId must equal scope.userId');
  if (metadata.agreement && metadata.agreement.partnerId !== boundScope.partnerId)
    throw new Error('AccountMetadata.agreement.partnerId must equal scope.partnerId');

  const requestId = options.namespace
    ? `${ACCOUNT_METADATA_MARKER}-${options.namespace}`
    : ACCOUNT_METADATA_MARKER;
  const latency = options.latencyMs ?? 20;

  // Build (and validate) the envelope once. `metadata` is used verbatim — unknown fields stay unknown.
  const value = AccountResponse.parse({
    revision: options.revision ?? '1',
    partnerId: boundScope.partnerId,
    permissionRevision: boundScope.permissionRevision,
    dataState: options.dataState ?? 'ready',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    dataThrough:
      options.dataThrough === undefined
        ? (options.generatedAt ?? new Date().toISOString())
        : options.dataThrough,
    reasons: options.reasons ? [...options.reasons] : [],
    requestId,
    data: metadata,
  });

  const assertScope = (scope: QueryScope): void => {
    if (!scopeEqual(ScopeSchema.parse(scope), boundScope))
      throw new Error('ไม่มีสิทธิ์เข้าบัญชีนี้');
  };

  // Idempotency ledger (in-memory, per instance): a replayed key returns its stored result; the same
  // key with a different command is a conflict.
  const ledger = new Map<string, { fingerprint: string; result: AccountActionResultValue }>();

  return {
    read: async (scope, signal) => {
      await wait(latency, signal);
      assertScope(scope);
      return structuredClone(value);
    },
    act: async (request) => {
      await wait(latency, request.signal);
      assertScope(request.scope);
      const command = AccountAction.parse(request.command);
      const fingerprint = JSON.stringify(command);
      const prior = ledger.get(request.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error('รหัสรายการถูกใช้กับคำสั่งอื่นแล้ว');
        return structuredClone(prior.result);
      }
      if (request.expectedRevision !== value.revision)
        throw new Error('ข้อมูลบัญชีเปลี่ยนแล้ว กรุณารีเฟรช');

      const result: AccountActionResultValue =
        command.action === 'recover'
          ? {
              userId: boundScope.userId,
              requestId,
              status: 'recovery-required',
              message:
                'ติดต่อผู้ดูแลที่ประสานงานกับคุณ เมื่อยืนยันเจ้าของบัญชีแล้ว ทีมจะส่งลิงก์ให้ตั้งรหัสผ่านใหม่ด้วยตัวเอง ยังไม่มีการส่งลิงก์หรือเปลี่ยนรหัสผ่าน',
            }
          : {
              userId: boundScope.userId,
              requestId,
              // Simulated, LOCAL-ONLY sign-out: it only clears the on-device preview view. No native
              // session is invalidated and no auth request is sent.
              status: 'complete',
              message:
                'ล้างมุมมองตัวอย่างบนเครื่องนี้แล้ว (จำลอง ไม่ได้ออกจากระบบจริงกับบริการยืนยันตัวตน)',
            };

      // Only a `logout` completion is recorded for replay; `recover` never mutates and is safe to
      // repeat. Recording logout keeps a repeated confirm idempotent.
      if (command.action === 'logout') ledger.set(request.idempotencyKey, { fingerprint, result });
      return result;
    },
  };
}
