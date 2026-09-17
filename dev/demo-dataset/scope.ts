// Development-only identity → scope mapping for the coherent partner-demo dataset. Browser-safe
// (type-only contract import). The A/B identity is a strict ALLOWLIST resolved to a server-owned
// dataset id; the generation is server-owned. The resulting withdrawal scope is the SAME six-field
// shape the existing controller uses EXCEPT `permissionRevision` carries the datasetId + generation,
// so a new generation gets its OWN persisted withdrawal namespace and never merges with the old
// demo-500 / prior-session state. Snapshots for a and b stay isolated by partnerId/payerId.

import type { WithdrawalScopeValue } from '@/contracts/withdrawal-journey';
import { DATASET_IDS, DEFAULT_GENERATION, type DatasetRecords } from './dataset';

export const IDENTITIES = ['a', 'b'] as const;
export type Identity = (typeof IDENTITIES)[number];

export function isIdentity(value: string): value is Identity {
  return (IDENTITIES as readonly string[]).includes(value);
}

/** The allowlisted dataset id for a preview identity. Throws on anything not in the allowlist. */
export function datasetIdForIdentity(identity: string): string {
  if (!isIdentity(identity)) throw new Error(`demo-dataset: identity ${identity} is not allowlisted`);
  return DATASET_IDS[identity];
}

/** The preview identity a dataset belongs to (reverse of datasetIdForIdentity). */
export function identityForDatasetId(datasetId: string): Identity {
  const found = (IDENTITIES as readonly Identity[]).find((id) => DATASET_IDS[id] === datasetId);
  if (!found) throw new Error(`demo-dataset: dataset id ${datasetId} is not allowlisted`);
  return found;
}

/** Strict guard: the dataset's stored datasetId MUST equal the allowlisted id for `identity`. */
export function assertIdentityMatchesDataset(dataset: DatasetRecords, identity: string): void {
  const expected = datasetIdForIdentity(identity);
  if (dataset.meta.datasetId !== expected)
    throw new Error(
      `demo-dataset: identity ${identity} expects dataset ${expected}, got ${dataset.meta.datasetId}`,
    );
}

// Mirrors dev/withdrawals/navigation.ts PREVIEW_SCOPE_BASE (userId / currency); a scope test asserts
// they stay in lock-step so the new namespace only differs in permissionRevision + derived ids.
export const DEMO_SCOPE_BASE = {
  userId: 'SYNTH-withdrawal-user',
  currency: 'THB' as const,
  scenario: 'partner-demo',
} as const;
const BASE_PERMISSION_REVISION = 'SYNTH-permission-1';

/**
 * The withdrawal scope for a dataset + identity. `permissionRevision` carries the datasetId +
 * generation so the new DB-backed generation is a fresh, isolated namespace (no mixing with the old
 * demo state). Requires the identity to strictly match the dataset (assertIdentityMatchesDataset).
 */
export function datasetScope(dataset: DatasetRecords, identity: string): WithdrawalScopeValue {
  assertIdentityMatchesDataset(dataset, identity);
  const id = identity as Identity;
  const { datasetId, generation } = dataset.meta;
  return {
    userId: DEMO_SCOPE_BASE.userId,
    partnerId: `SYNTH-withdrawal-partner-${id}`,
    permissionRevision: `${BASE_PERMISSION_REVISION}::${datasetId}::${generation || DEFAULT_GENERATION}`,
    payerId: `SYNTH-payer-${id}`,
    currency: DEMO_SCOPE_BASE.currency,
    scenario: DEMO_SCOPE_BASE.scenario,
  };
}
