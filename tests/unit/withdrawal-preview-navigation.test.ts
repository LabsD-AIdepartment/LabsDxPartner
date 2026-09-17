import { describe, expect, it } from 'vitest';
import { safeTransactionReturn } from '@/features/transactions/model';
import {
  PREVIEW_SCOPE_BASE,
  previewScopeFor,
  readWithdrawalLane,
  withdrawalLaneHref,
} from '../../dev/withdrawals/navigation';
import { SCENARIO_NAMES } from '../../dev/withdrawals/scenarios';

// WU02 navigation seam: pure helpers over the EXISTING Transactions query lane. Full synthetic
// scope is derived from an allowlisted scenario + A/B identity ONLY — never arbitrary actor/payer
// strings from a URL — and the return context is preserved through the preview allowlist.

describe('previewScopeFor derives a full six-field scope from allowlisted inputs only', () => {
  it('builds partner/payer from the A/B identity and carries the scenario', () => {
    const a = previewScopeFor('golden', 'a');
    expect(a).toEqual({
      ...PREVIEW_SCOPE_BASE,
      partnerId: 'SYNTH-withdrawal-partner-a',
      payerId: 'SYNTH-payer-a',
      scenario: 'golden',
    });
    const b = previewScopeFor('applies-wht', 'b');
    expect(b.partnerId).toBe('SYNTH-withdrawal-partner-b');
    expect(b.payerId).toBe('SYNTH-payer-b');
    expect(b.scenario).toBe('applies-wht');
    // Every scenario name is accepted as-is.
    for (const name of SCENARIO_NAMES) expect(previewScopeFor(name, 'a').scenario).toBe(name);
  });

  it('falls back to golden / identity a for unknown or injected values (no arbitrary identity)', () => {
    const injected = previewScopeFor('../etc/passwd', 'attacker-payer');
    expect(injected.scenario).toBe('golden');
    expect(injected.partnerId).toBe('SYNTH-withdrawal-partner-a');
    expect(injected.payerId).toBe('SYNTH-payer-a');
    // The literal injected string never appears anywhere in the derived scope.
    expect(JSON.stringify(injected)).not.toContain('attacker-payer');
    expect(JSON.stringify(injected)).not.toContain('passwd');
  });
});

describe('readWithdrawalLane parses the Transactions query lane', () => {
  it('reads the withdrawals lane with a validated request ref', () => {
    const lane = readWithdrawalLane('view=withdrawals&request=wr-1-abc&scenario=applies-wht&identity=b');
    expect(lane).toEqual({
      view: 'withdrawals',
      requestRef: 'wr-1-abc',
      scenario: 'applies-wht',
      identity: 'b',
    });
  });

  it('treats absent/other view as the legacy periods lane and carries no request ref there', () => {
    expect(readWithdrawalLane('').view).toBe('periods');
    expect(readWithdrawalLane('view=periods&request=wr-1').requestRef).toBeNull();
  });

  it('rejects a malformed request ref and unknown scenario/identity', () => {
    const lane = readWithdrawalLane('view=withdrawals&request=../secret&scenario=nope&identity=z');
    expect(lane.requestRef).toBeNull();
    expect(lane.scenario).toBe('golden');
    expect(lane.identity).toBe('a');
  });
});

describe('withdrawalLaneHref builds a lane URL and preserves a safe return context', () => {
  it('carries view/scenario/identity and a request ref only in the withdrawals lane', () => {
    const href = withdrawalLaneHref('/transactions-preview', {
      view: 'withdrawals',
      requestRef: 'wr-9-zz',
      scenario: 'golden',
      identity: 'a',
    });
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/transactions-preview');
    expect(url.searchParams.get('view')).toBe('withdrawals');
    expect(url.searchParams.get('request')).toBe('wr-9-zz');
    expect(url.searchParams.get('scenario')).toBe('golden');
    expect(url.searchParams.get('identity')).toBe('a');
    // Round-trips through the reader.
    expect(readWithdrawalLane(url.search.replace(/^\?/, '')).requestRef).toBe('wr-9-zz');
  });

  it('sanitises the return context: keeps /withdrawal-preview, drops a foreign origin', () => {
    const keep = withdrawalLaneHref('/transactions-preview', {
      view: 'withdrawals',
      scenario: 'golden',
      identity: 'a',
      returnTo: '/withdrawal-preview',
    });
    expect(new URL(keep, 'http://x').searchParams.get('returnTo')).toBe('/withdrawal-preview');
    const drop = withdrawalLaneHref('/transactions-preview', {
      view: 'periods',
      scenario: 'golden',
      identity: 'a',
      returnTo: 'https://evil.example/withdraw',
    });
    expect(new URL(drop, 'http://x').searchParams.get('returnTo')).toBe('/overview-preview');
  });
});

describe('safeTransactionReturn preview allowance', () => {
  it('permits /withdrawal-preview in preview mode only', () => {
    expect(safeTransactionReturn('/withdrawal-preview', true)).toBe('/withdrawal-preview');
    // Native mode never allows the dev preview origin.
    expect(safeTransactionReturn('/withdrawal-preview', false)).toBe('/overview');
    // Existing behaviour intact.
    expect(safeTransactionReturn('/overview-preview', true)).toBe('/overview-preview');
    expect(safeTransactionReturn('//evil', true)).toBe('/overview-preview');
  });
});
