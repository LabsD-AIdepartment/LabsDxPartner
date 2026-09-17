import { safeTransactionReturn } from '@/features/transactions/model';
import type { WithdrawalScopeValue } from '@/contracts/withdrawal-journey';
import { SCENARIO_NAMES, type ScenarioName } from './scenarios';

// Development-only PURE navigation/scope helpers shared by the two preview pages (WithdrawalPreview
// and TransactionsPreview, both owned by the UI author). No React, no side effects. They derive the
// FULL synthetic scope from ONLY an allowlisted scenario + A/B identity — arbitrary actor/payer
// identity is NEVER read from a URL — and they use the EXISTING Transactions query lane (no new app
// route). A statement PATH segment (/transactions-preview/:statementId) is handled by the existing
// route and always takes precedence; these helpers only read/build the query.

export const PREVIEW_IDENTITIES = ['a', 'b'] as const;
export type PreviewIdentity = (typeof PREVIEW_IDENTITIES)[number];

// The fixed, non-identity parts of the synthetic scope. Shared here (not duplicated in UI literals)
// so the preview and the history lane always resolve the same namespace.
export const PREVIEW_SCOPE_BASE = {
  userId: 'SYNTH-withdrawal-user',
  permissionRevision: 'SYNTH-permission-1',
  currency: 'THB' as const,
} as const;

export function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIO_NAMES as string[]).includes(value);
}
export function isPreviewIdentity(value: string): value is PreviewIdentity {
  return (PREVIEW_IDENTITIES as readonly string[]).includes(value);
}

// Unknown scenario/identity fall back to the safe defaults (golden / 'a'); the payer/partner are
// DERIVED from the identity, never supplied directly.
export function previewScopeFor(scenario: string, identity: string): WithdrawalScopeValue {
  const s: ScenarioName = isScenarioName(scenario) ? scenario : 'golden';
  const id: PreviewIdentity = isPreviewIdentity(identity) ? identity : 'a';
  return {
    ...PREVIEW_SCOPE_BASE,
    partnerId: `SYNTH-withdrawal-partner-${id}`,
    payerId: `SYNTH-payer-${id}`,
    scenario: s,
  };
}

// `view=withdrawals` is the withdrawal-history lane; `view=periods` (and any absent/other value) is
// the retained legacy statements lane. `request` deep-links a withdrawal detail (withdrawals lane
// only).
export type WithdrawalLaneView = 'withdrawals' | 'periods';
export interface WithdrawalLane {
  view: WithdrawalLaneView;
  requestRef: string | null;
  scenario: ScenarioName;
  identity: PreviewIdentity;
}

const REF_RE = /^[A-Za-z0-9_-]+$/;

export function readWithdrawalLane(search: string): WithdrawalLane {
  const p = new URLSearchParams(search);
  const view: WithdrawalLaneView = p.get('view') === 'withdrawals' ? 'withdrawals' : 'periods';
  const rawRef = p.get('request');
  const scenarioParam = p.get('scenario') ?? '';
  const identityParam = p.get('identity') ?? '';
  return {
    view,
    requestRef: view === 'withdrawals' && rawRef && REF_RE.test(rawRef) ? rawRef : null,
    scenario: isScenarioName(scenarioParam) ? scenarioParam : 'golden',
    identity: isPreviewIdentity(identityParam) ? identityParam : 'a',
  };
}

// Build a Transactions-lane href carrying scenario/identity (so the synthetic scope survives
// navigation/back/reload) and an optional, sanitised return context. `returnTo` passes through the
// preview allowlist (which now includes /withdrawal-preview).
export function withdrawalLaneHref(
  base: string,
  lane: {
    view: WithdrawalLaneView;
    requestRef?: string | null;
    scenario: ScenarioName;
    identity: PreviewIdentity;
    returnTo?: string | null;
  },
): string {
  const p = new URLSearchParams();
  p.set('view', lane.view);
  if (lane.view === 'withdrawals' && lane.requestRef && REF_RE.test(lane.requestRef))
    p.set('request', lane.requestRef);
  p.set('scenario', lane.scenario);
  p.set('identity', lane.identity);
  if (lane.returnTo) p.set('returnTo', safeTransactionReturn(lane.returnTo, true));
  return `${base}?${p.toString()}`;
}

// ---- WU03 S1: staff request workspace navigation (dev-only, allowlisted) ----------------
//
// The staff view is a cross-partner READER over the SAME allowlisted A/B partner runtimes. It has
// NO separate money scope and NO auth/capability is modeled — the A/B labels are selectors, never
// arbitrary actor/payer strings. The staff UI resolves each partner runtime by these scopes and
// merges per-partner reads (surfacing a per-partner read failure explicitly; never a silent empty
// all-partners result); it never sums totals across payers.
export function staffPartnerRoster(
  scenario: string,
): { scope: WithdrawalScopeValue; identity: PreviewIdentity; partnerLabel: string }[] {
  return PREVIEW_IDENTITIES.map((identity) => ({
    scope: previewScopeFor(scenario, identity),
    identity,
    partnerLabel: `พาร์ทเนอร์ ${identity.toUpperCase()}`,
  }));
}

// The dev-only StaffShell entry. Opt-in ONLY: `nativeStaffRoutes()` never returns it and the native
// fallback never manufactures `/ops/requests`.
export const STAFF_PREVIEW_VIEWS = ['requests'] as const;
export type StaffPreviewView = (typeof STAFF_PREVIEW_VIEWS)[number];
export function isStaffPreviewView(value: string): value is StaffPreviewView {
  return (STAFF_PREVIEW_VIEWS as readonly string[]).includes(value);
}

// Route-guard allow-list for the dev staff request workspace: exactly `/ops-preview/requests`
// (the selected request ref + scenario/identity travel in the query, read below). No deeper path.
export function isStaffPreviewSegments(segments: string[]): boolean {
  return segments.length === 1 && segments[0] === 'requests';
}

// Parse the staff request lane query: an allowlisted scenario + A/B identity (which partner's
// detail) and an optional validated request reference. Nothing arbitrary is taken from the URL.
export function readStaffRequestLane(search: string): {
  scenario: ScenarioName;
  identity: PreviewIdentity;
  requestRef: string | null;
} {
  const p = new URLSearchParams(search);
  const scenarioParam = p.get('scenario') ?? '';
  const identityParam = p.get('identity') ?? '';
  const rawRef = p.get('request');
  return {
    scenario: isScenarioName(scenarioParam) ? scenarioParam : 'golden',
    identity: isPreviewIdentity(identityParam) ? identityParam : 'a',
    requestRef: rawRef && REF_RE.test(rawRef) ? rawRef : null,
  };
}

// ---- WU03 S2: focused payout subview lane (/account-preview?view=payout&scenario=&identity=) ----
//
// The shared payout panel mounts under the WITHDRAWAL scope (via getWithdrawalRuntime), NOT the
// legacy account transport. The lane carries only an allowlisted scenario + A/B identity, and a
// sanitised return context (through the existing preview allowlist).
export function payoutPreviewHref(
  base: string,
  lane: { scenario: ScenarioName; identity: PreviewIdentity; returnTo?: string | null },
): string {
  const p = new URLSearchParams();
  p.set('view', 'payout');
  p.set('scenario', lane.scenario);
  p.set('identity', lane.identity);
  if (lane.returnTo) p.set('returnTo', safeTransactionReturn(lane.returnTo, true));
  return `${base}?${p.toString()}`;
}

export function readPayoutLane(search: string): {
  scenario: ScenarioName;
  identity: PreviewIdentity;
} {
  const p = new URLSearchParams(search);
  const scenarioParam = p.get('scenario') ?? '';
  const identityParam = p.get('identity') ?? '';
  return {
    scenario: isScenarioName(scenarioParam) ? scenarioParam : 'golden',
    identity: isPreviewIdentity(identityParam) ? identityParam : 'a',
  };
}
