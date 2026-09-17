'use client';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';
import { useEffect, useState } from 'react';
import type { WithdrawalHistoryFilters } from '@/features/withdrawals/WithdrawalHistory';
import type { StaffWithdrawalQueueFilters } from '@/features/withdrawals/StaffWithdrawalQueue';
import { safeTransactionReturn, transactionHref } from '@/features/transactions/model';
import {
  readWithdrawalLane,
  readStaffRequestLane,
  withdrawalLaneHref,
  type WithdrawalLane,
  type PreviewIdentity,
} from './navigation';

type Selection = Pick<WithdrawalLane, 'scenario' | 'identity'>;

/** Retained statement links carry report return context. Recover its allowlisted preview scope
 * when a legacy link has no outer selection; explicit query selections still take precedence. */
export function withdrawalNavigationSearch(search: string) {
  const params = new URLSearchParams(search);
  const returnTo = safeTransactionReturn(params.get('returnTo'), true);
  if (['/withdrawal-preview', '/overview'].includes(returnTo.split('?')[0])) {
    const returned = readWithdrawalLane(returnTo.split('?')[1] ?? '');
    if (!params.has('scenario')) params.set('scenario', returned.scenario);
    if (!params.has('identity')) params.set('identity', returned.identity);
  }
  return params.toString();
}
/** UI URL state only. Navigation/scope authority still comes from the allowlisted pure helpers. */
export function useWithdrawalPreviewLocation(search: string, path: string) {
  const { resolveHref } = useApplicationPresentation();
  path = resolveHref(path);
  const [edited, setEdited] = useState<{ source: string; search: string } | null>(null);
  const current = edited?.source === search ? edited.search : search;
  function replace(next: string) {
    setEdited({ source: search, search: next });
    if (window.location.pathname === path)
      window.history.replaceState(window.history.state, '', resolveHref(`${path}?${next}`));
  }
  useEffect(() => {
    const restore = () => {
      if (window.location.pathname === path)
        setEdited({ source: search, search: window.location.search.slice(1) });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [search, path]);
  return { search: current, replace };
}

export function withWithdrawalPreviewScope(href: string, selection: Selection) {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set('scenario', selection.scenario);
  params.set('identity', selection.identity);
  return `${path}?${params.toString()}`;
}
export function changeWithdrawalPreviewScope(search: string, selection: Selection) {
  const params = new URLSearchParams(search);
  params.set('scenario', selection.scenario);
  params.set('identity', selection.identity);
  params.delete('request');
  const returnTo = safeTransactionReturn(params.get('returnTo'), true);
  if (['/withdrawal-preview', '/overview'].includes(returnTo.split('?')[0]))
    params.set('returnTo', withWithdrawalPreviewScope(returnTo, selection));
  return params.toString();
}
export function readWithdrawalHistoryFilters(search: string): WithdrawalHistoryFilters {
  const params = new URLSearchParams(search);
  return {
    // Preserve invalid display drafts so the feature reports an error, never silently resets them.
    status: (params.get('status') ?? 'all') as WithdrawalHistoryFilters['status'],
    from: params.get('requestedFrom') ?? '',
    toExclusive: params.get('requestedToExclusive') ?? '',
  };
}
export function withdrawalHistoryHref(
  search: string,
  filters: WithdrawalHistoryFilters,
  requestRef: string | null = null,
) {
  const lane = readWithdrawalLane(search);
  const base = withdrawalLaneHref('/transactions-preview', {
    ...lane,
    view: 'withdrawals',
    requestRef,
    returnTo: new URLSearchParams(search).get('returnTo'),
  });
  const [path, query] = base.split('?');
  const params = new URLSearchParams(query);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.from) params.set('requestedFrom', filters.from);
  if (filters.toExclusive) params.set('requestedToExclusive', filters.toExclusive);
  return `${path}?${params.toString()}`;
}

export function withdrawalPeriodsHref(
  search: string,
  filters: WithdrawalHistoryFilters,
  statementId?: string,
) {
  const params = new URLSearchParams(withdrawalHistoryHref(search, filters).split('?')[1]);
  params.set('view', 'periods');
  return `${transactionHref('/transactions-preview', statementId)}?${params.toString()}`;
}

/** Staff display filters never supply the identity/payer authority used by runtime reads. */
export function readStaffWithdrawalFilters(search: string): StaffWithdrawalQueueFilters {
  return {
    ...readWithdrawalHistoryFilters(search),
    partner: new URLSearchParams(search).get('partner') ?? '',
  };
}

export function staffWithdrawalHref(
  search: string,
  options: {
    view?: 'requests' | 'periods';
    identity?: PreviewIdentity;
    requestRef?: string | null;
    filters?: StaffWithdrawalQueueFilters;
  } = {},
) {
  const lane = readStaffRequestLane(search);
  const params = new URLSearchParams();
  const view = options.view ?? 'requests';
  params.set('scenario', lane.scenario);
  params.set('identity', options.identity ?? lane.identity);
  if (view === 'periods') params.set('view', 'withdrawals');
  const requestRef = options.requestRef ?? null;
  const safeRef = readStaffRequestLane(
    new URLSearchParams({ request: requestRef ?? '' }).toString(),
  ).requestRef;
  if (view === 'requests' && safeRef) params.set('request', safeRef);
  const filters = options.filters ?? readStaffWithdrawalFilters(search);
  if (filters.partner) params.set('partner', filters.partner);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.from) params.set('requestedFrom', filters.from);
  if (filters.toExclusive) params.set('requestedToExclusive', filters.toExclusive);
  const returnTo = new URLSearchParams(search).get('returnTo');
  if (returnTo) params.set('returnTo', safeTransactionReturn(returnTo, true));
  return `/ops-preview/${view}?${params.toString()}`;
}

export function staffPartnerSummaryHref(search: string) {
  const lane = readStaffRequestLane(search);
  const returned = safeTransactionReturn(new URLSearchParams(search).get('returnTo'), true);
  return withWithdrawalPreviewScope(
    ['/withdrawal-preview', '/overview'].includes(returned.split('?')[0]) ? returned : '/withdrawal-preview',
    lane,
  );
}
