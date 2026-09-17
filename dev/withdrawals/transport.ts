import {
  createWithdrawalController,
  type ControllerOptions,
  WithdrawalController,
} from './controller';
import type { DevKeyValueStorage } from './store';
import type {
  SetPayoutBeneficiaryCommandValue,
  WithdrawalCancelCommandValue,
  WithdrawalOutcomeSimCommandValue,
  WithdrawalScopeValue,
  WithdrawalSubmissionValue,
} from '@/contracts/withdrawal-journey';

// Development-only transport that adapts the synthetic WithdrawalController to the injected
// WithdrawalTransport seam consumed by the (independently authored) UI. No live endpoint, DB
// or gateway. It only adds abort handling and a small synthetic latency around the pure,
// in-memory controller. The returned object is structurally a `WithdrawalTransport`
// (verified in tests); this file does NOT import the feature model, keeping the dev adapter's
// import closure limited to the audited pure modules + contracts.

// A caller-scope gate error. The transport is bound to ONE controller scope (a synthetic
// namespace); a read/quote/recover asking under a DIFFERENT declared scope is refused at the
// adapter BEFORE any controller call — so a foreign scope never rides the bound controller's
// answer and a mismatched quote is never minted (F02). This is synthetic namespace isolation,
// NOT a trusted user-auth assumption. It is intentionally distinct from the feature model's
// response-scope validation: the model still re-checks the returned envelope, but the adapter
// no longer discards `input.scope`. Defined locally so the dev adapter never imports the
// feature model (keeping the audited import closure intact).
export class WithdrawalScopeError extends Error {
  constructor(
    readonly operation:
      | 'summary'
      | 'quote'
      | 'recover'
      | 'list'
      | 'detail'
      | 'recoverCancellation'
      | 'periods'
      | 'beneficiaryConfig',
    message: string,
  ) {
    super(message);
    this.name = 'WithdrawalScopeError';
  }
}

// Exact full-scope equality across EVERY declared field. A single differing field (user,
// partner, permission, payer, currency or scenario) is a foreign namespace.
function scopeEqual(a: WithdrawalScopeValue, b: WithdrawalScopeValue): boolean {
  return (
    a.userId === b.userId &&
    a.partnerId === b.partnerId &&
    a.permissionRevision === b.permissionRevision &&
    a.payerId === b.payerId &&
    a.currency === b.currency &&
    a.scenario === b.scenario
  );
}

export interface TransportOptions extends ControllerOptions {
  // Synthetic round-trip latency in ms. Kept short so tests stay fast; the abort path is
  // honoured regardless.
  latencyMs?: number;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
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

// Structurally a WithdrawalHistoryTransport (the WU02 superset): the four WU01 methods plus the
// history reads and the durable cancellation command/recovery. Verified structurally in tests;
// this file never imports the feature model, keeping the audited import closure intact.
export interface WithdrawalScenarioTransport {
  summary(input: { scope: WithdrawalScopeValue; signal: AbortSignal }): Promise<unknown>;
  quote(input: {
    scope: WithdrawalScopeValue;
    grossMinor: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  submit(input: {
    submission: WithdrawalSubmissionValue;
    signal: AbortSignal;
  }): Promise<unknown>;
  recover(input: {
    scope: WithdrawalScopeValue;
    idempotencyKey?: string;
    requestRef?: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  list(input: { scope: WithdrawalScopeValue; signal: AbortSignal }): Promise<unknown>;
  detail(input: {
    scope: WithdrawalScopeValue;
    requestRef: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  cancel(input: {
    command: WithdrawalCancelCommandValue;
    signal: AbortSignal;
  }): Promise<unknown>;
  recoverCancellation(input: {
    scope: WithdrawalScopeValue;
    operationKey?: string;
    requestRef?: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  // WU03 S1: also structurally a WithdrawalStaffTransport (periods read + outcome-simulation command).
  periods(input: { scope: WithdrawalScopeValue; signal: AbortSignal }): Promise<unknown>;
  outcome(input: {
    command: WithdrawalOutcomeSimCommandValue;
    signal: AbortSignal;
  }): Promise<unknown>;
  // WU03 S2: also structurally a WithdrawalBeneficiaryTransport (payout config read + save command).
  beneficiaryConfig(input: { scope: WithdrawalScopeValue; signal: AbortSignal }): Promise<unknown>;
  setBeneficiary(input: {
    command: SetPayoutBeneficiaryCommandValue;
    signal: AbortSignal;
  }): Promise<unknown>;
}

// Build a transport bound to an existing controller (so the preview can share one controller
// between its banner controls and the transport).
export function createWithdrawalTransport(
  controller: WithdrawalController,
  options: { latencyMs?: number } = {},
): WithdrawalScenarioTransport {
  const latency = options.latencyMs ?? 10;
  // Reject a foreign declared scope BEFORE any latency or controller call, so a mismatch never
  // has a side effect (in particular, `quote` never mints an issued quote for a foreign scope).
  const gate = (
    operation:
      | 'summary'
      | 'quote'
      | 'recover'
      | 'list'
      | 'detail'
      | 'recoverCancellation'
      | 'periods'
      | 'beneficiaryConfig',
    scope: WithdrawalScopeValue,
  ): void => {
    if (!scopeEqual(scope, controller.currentScope()))
      throw new WithdrawalScopeError(
        operation,
        'ขอบเขต (scope) ที่ร้องขอไม่ตรงกับขอบเขตของบริการนี้',
      );
  };
  return {
    async summary({ scope, signal }) {
      gate('summary', scope);
      await delay(latency, signal);
      return controller.summary();
    },
    async quote({ scope, grossMinor, signal }) {
      gate('quote', scope);
      await delay(latency, signal);
      return controller.quote(grossMinor);
    },
    async submit({ submission, signal }) {
      // A command, not a read: the controller returns a TYPED `rejected` result for a scope
      // mismatch (never a throw), which the UI shows as this command's outcome. The gate above
      // guards the read/quote side effects; submit's scope is enforced inside the controller.
      await delay(latency, signal);
      return controller.submit(submission);
    },
    async recover({ scope, idempotencyKey, requestRef, signal }) {
      gate('recover', scope);
      await delay(latency, signal);
      return controller.recover({ idempotencyKey, requestRef });
    },
    async list({ scope, signal }) {
      gate('list', scope);
      await delay(latency, signal);
      return controller.list();
    },
    async detail({ scope, requestRef, signal }) {
      gate('detail', scope);
      await delay(latency, signal);
      return controller.detail(requestRef);
    },
    async cancel({ command, signal }) {
      // Persist the cancellation INTENT synchronously BEFORE the round-trip delay, so a hard reload
      // during send discovers the operation and recovers by the same key (durable intent, S05).
      // Validation rejects and replays of a known operation need no async resolution.
      const begun = controller.beginCancel(command);
      if (!begun.needsResolve) return begun.result;
      await delay(latency, signal);
      // Resolve the final outcome. The COMMIT for `lost_after_accept` happens here, then the
      // response is dropped to the caller AFTER the reserve is released and the accepted receipt is
      // persisted — recovery by the same operationKey then finds it (no second release).
      const resolved = controller.resolveCancel(command);
      if (controller.cancelSimMode() === 'lost_after_accept' && resolved.outcome === 'cancelled')
        throw new Error('response lost after accepted cancellation');
      return resolved;
    },
    async recoverCancellation({ scope, operationKey, requestRef, signal }) {
      gate('recoverCancellation', scope);
      await delay(latency, signal);
      return controller.recoverCancellation({ operationKey, requestRef });
    },
    async periods({ scope, signal }) {
      gate('periods', scope);
      await delay(latency, signal);
      return controller.periods();
    },
    async outcome({ command, signal }) {
      // A COMMAND (scope validated inside the controller as a typed reject). Capture the reset epoch
      // at call ENTRY and pass it to the controller, which checks it AFTER the delay before any
      // mutation — so a reset during the round-trip cannot let this command touch post-reset state,
      // even if a fresh request re-reaches the same seq/ref namespace.
      const atEpoch = controller.epoch();
      await delay(latency, signal);
      return controller.applyOutcomeSim(command, atEpoch);
    },
    async beneficiaryConfig({ scope, signal }) {
      gate('beneficiaryConfig', scope);
      await delay(latency, signal);
      return controller.beneficiaryConfig();
    },
    async setBeneficiary({ command, signal }) {
      // A COMMAND. Capture the reset epoch at call ENTRY; the controller checks it AFTER the delay
      // before the single atomic write, so a late save cannot write post-reset config.
      const atEpoch = controller.epoch();
      await delay(latency, signal);
      return controller.setBeneficiary(command, atEpoch);
    },
  };
}

// Convenience: create a controller and its transport together.
export function createWithdrawalScenario(options: TransportOptions): {
  controller: WithdrawalController;
  transport: WithdrawalScenarioTransport;
} {
  const controller = createWithdrawalController(options);
  const transport = createWithdrawalTransport(controller, { latencyMs: options.latencyMs });
  return { controller, transport };
}

// ---- Shared runtime registry (ONE writer per full-scope + storage identity) -----------
//
// Both dev pages (WithdrawalPreview, TransactionsPreview) resolve the SAME controller/transport for
// a given six-field scope + injected storage, so navigating between them — even while an earlier
// mutation is still finishing — never spawns a second competing controller that could overwrite the
// other's newer state. A different scope (A/B identity or scenario switch) gets its OWN controller;
// a command finishing on the old scope mutates only that scope. Keyed in a WeakMap by the storage
// OBJECT (test storage injection stays isolated; the lazy browser getter stays a stable object),
// then by the serialized scope. `subscribe`/`version` only drive UI refresh (see the controller).
export interface WithdrawalRuntime {
  controller: WithdrawalController;
  transport: WithdrawalScenarioTransport;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

const RUNTIME_REGISTRY = new WeakMap<DevKeyValueStorage, Map<string, WithdrawalRuntime>>();

function runtimeScopeKey(scope: WithdrawalScopeValue): string {
  return [
    scope.userId,
    scope.partnerId,
    scope.permissionRevision,
    scope.payerId,
    scope.currency,
    scope.scenario,
  ]
    .map(encodeURIComponent)
    .join('::');
}

export function getWithdrawalRuntime(
  options: TransportOptions & { storage: DevKeyValueStorage },
): WithdrawalRuntime {
  let byScope = RUNTIME_REGISTRY.get(options.storage);
  if (!byScope) {
    byScope = new Map<string, WithdrawalRuntime>();
    RUNTIME_REGISTRY.set(options.storage, byScope);
  }
  const key = runtimeScopeKey(options.scope);
  const existing = byScope.get(key);
  if (existing) return existing;
  const controller = createWithdrawalController(options);
  const transport = createWithdrawalTransport(controller, { latencyMs: options.latencyMs });
  const runtime: WithdrawalRuntime = {
    controller,
    transport,
    subscribe: (listener) => controller.subscribe(listener),
    // The REACTIVE UI version (changes on every notify — read-error/cancel-mode/reset/reload/warning
    // AND money transitions), NOT the financial seq. A useSyncExternalStore consumer therefore always
    // sees a changed snapshot on a relevant notify.
    version: () => controller.uiVersion(),
  };
  byScope.set(key, runtime);
  return runtime;
}

// Test/utility seam: drop a cached runtime (e.g. after an explicit reset in a test) so a fresh
// controller is built on the next resolve. Never used to abort an in-flight command.
export function releaseWithdrawalRuntime(
  storage: DevKeyValueStorage,
  scope: WithdrawalScopeValue,
): void {
  RUNTIME_REGISTRY.get(storage)?.delete(runtimeScopeKey(scope));
}
