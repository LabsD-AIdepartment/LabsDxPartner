'use client';
import { useId, useRef } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { RequestStatus, type WithdrawalScopeValue } from '@/contracts/withdrawal-journey';
import { WithdrawalDetail } from './WithdrawalDetail';
import { StaffWithdrawalQueue, type StaffWithdrawalQueueFilters } from './StaffWithdrawalQueue';
import {
  loadWithdrawalDetail,
  loadWithdrawalList,
  withdrawalKeys,
  withdrawalScopeKey,
  WithdrawalResponseError,
  type WithdrawalHistoryTransport,
} from './model';

export type StaffWithdrawalRosterEntry = {
  id: string;
  label: string;
  scope: WithdrawalScopeValue;
  transport: WithdrawalHistoryTransport;
  refreshKey: string | number;
};
export type StaffWithdrawalWorkspaceProps = {
  /** The caller supplies only authorized partners. This component cannot grant staff access. */
  roster: readonly StaffWithdrawalRosterEntry[];
  filters: StaffWithdrawalQueueFilters;
  onFiltersChange: (filters: StaffWithdrawalQueueFilters) => void;
  selection?: { selectionId: string; requestRef: string } | null;
  requestHref: (selectionId: string, requestRef: string) => string;
  backHref: string;
};

type Context = {
  descriptor: string;
  versionDescriptor: string;
  transports: readonly WithdrawalHistoryTransport[];
  generation: number;
  readGeneration: number;
};

/** A new roster/scope/selection gets a fresh component lifetime before it can render.
 * Version changes replace only the read lifetime, preserving the focused filter DOM.
 * The local query namespace also fences transport replacement and cache reuse after removal.
 * Only reads receive abort signals; no financial command or recovery is issued here. */
export function StaffWithdrawalWorkspace(props: StaffWithdrawalWorkspaceProps) {
  const instance = useId();
  const descriptor = JSON.stringify([
    props.roster.map((entry) => [entry.id, entry.label, withdrawalScopeKey(entry.scope)]),
    props.selection ?? null,
    props.selection ? null : props.filters.partner,
  ]);
  const versionDescriptor = JSON.stringify(
    props.roster
      .filter((entry) =>
        props.selection
          ? entry.id === props.selection.selectionId
          : !props.filters.partner || entry.id === props.filters.partner,
      )
      .map((entry) => [entry.id, entry.refreshKey]),
  );
  const transports = props.roster.map((entry) => entry.transport);
  const context = useRef<Context>({
    descriptor,
    versionDescriptor,
    transports,
    generation: 0,
    readGeneration: 0,
  });
  if (
    context.current.descriptor !== descriptor ||
    transports.some((transport, index) => context.current.transports[index] !== transport)
  ) {
    context.current = {
      descriptor,
      versionDescriptor,
      transports,
      generation: context.current.generation + 1,
      readGeneration: context.current.readGeneration + 1,
    };
  } else if (context.current.versionDescriptor !== versionDescriptor) {
    context.current = {
      ...context.current,
      versionDescriptor,
      readGeneration: context.current.readGeneration + 1,
    };
  }
  const identity = `${instance}:${context.current.generation}`;
  const namespace = `${identity}:${context.current.readGeneration}`;
  return <ScopedWorkspace key={identity} {...props} namespace={namespace} />;
}

function dateIssue(filters: StaffWithdrawalQueueFilters): string | undefined {
  if (
    [filters.from, filters.toExclusive].some(
      (date) => date !== '' && !z.iso.date().safeParse(date).success,
    )
  )
    return 'กรุณาระบุวันที่ให้ถูกต้อง';
  if (filters.from && filters.toExclusive && filters.from >= filters.toExclusive)
    return 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น และไม่รวมวันสิ้นสุด';
}

function ScopedWorkspace({
  roster,
  filters,
  onFiltersChange,
  selection,
  requestHref,
  backHref,
  namespace,
}: StaffWithdrawalWorkspaceProps & { namespace: string }) {
  const duplicateIds = new Set(roster.map((entry) => entry.id)).size !== roster.length;
  const invalidRoster = duplicateIds || roster.some((entry) => entry.id === '');
  const selected = selection
    ? roster.find((entry) => entry.id === selection.selectionId)
    : undefined;
  const invalidPartner =
    filters.partner !== '' && !roster.some((entry) => entry.id === filters.partner);
  const invalidStatus =
    filters.status !== 'all' && !RequestStatus.safeParse(filters.status).success;
  const targets =
    invalidRoster || selection || invalidPartner
      ? []
      : roster.filter((entry) => filters.partner === '' || entry.id === filters.partner);
  const lists = useQueries({
    queries: targets.map((entry) => ({
      queryKey: [
        'staff-withdrawal-read',
        namespace,
        entry.id,
        ...withdrawalKeys.list(entry.scope, String(entry.refreshKey)),
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        loadWithdrawalList(entry.transport, { scope: entry.scope, signal }),
      retry: false,
      staleTime: 0,
      gcTime: 0,
    })),
  });
  const detailQuery = useQuery({
    queryKey: [
      'staff-withdrawal-read',
      namespace,
      selected?.id ?? null,
      ...(selected
        ? withdrawalKeys.detail(
            selected.scope,
            selection?.requestRef ?? '',
            String(selected.refreshKey),
          )
        : []),
    ],
    queryFn: ({ signal }) =>
      loadWithdrawalDetail(selected!.transport, {
        scope: selected!.scope,
        requestRef: selection!.requestRef,
        signal,
      }),
    enabled: !invalidRoster && !!selected && !!selection?.requestRef,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  if (selection) {
    const invalid =
      invalidRoster ||
      !selected ||
      !selection.requestRef ||
      detailQuery.error instanceof WithdrawalResponseError;
    const detail =
      !invalid && !detailQuery.isError && detailQuery.data?.state === 'found'
        ? detailQuery.data.detail
        : null;
    const state = invalid
      ? 'invalid'
      : detailQuery.isError
        ? 'read-error'
        : detailQuery.isFetching
          ? detail
            ? 'stale'
            : 'loading'
          : detailQuery.data?.state === 'missing'
            ? 'missing'
            : detail
              ? 'ready'
              : 'unavailable';
    const refetch = () => {
      void detailQuery.refetch();
    };
    return (
      <WithdrawalDetail
        detail={detail}
        state={state}
        backHref={backHref}
        onRetry={!invalidRoster && selected && selection.requestRef ? refetch : undefined}
        actions={
          detail?.request.allowedActions.includes('check_status')
            ? {
                checkStatus: { enabled: state === 'ready', onClick: refetch },
                busy: detailQuery.isFetching,
              }
            : undefined
        }
      />
    );
  }

  const valid = lists.filter((query) => !query.isError && query.data !== undefined);
  const failures = lists.filter((query) => query.isError);
  const pending = lists.some((query) => query.isPending);
  const state =
    invalidRoster || invalidPartner || invalidStatus
      ? 'invalid'
      : targets.length === 0
        ? 'unavailable'
        : pending
          ? 'loading'
          : failures.length > 0
            ? valid.length > 0
              ? 'partial-error'
              : failures.some((query) => query.error instanceof WithdrawalResponseError)
                ? 'invalid'
                : 'read-error'
            : lists.some((query) => query.isFetching)
              ? 'stale'
              : 'ready';
  const issue = dateIssue(filters);
  const from = filters.from ? Date.parse(`${filters.from}T00:00:00+07:00`) : -Infinity;
  const to = filters.toExclusive ? Date.parse(`${filters.toExclusive}T00:00:00+07:00`) : Infinity;
  const rows = targets.flatMap((entry, index) => {
    const query = lists[index];
    if (query.isError || !query.data || issue || invalidStatus) return [];
    return query.data.items
      .filter(
        (request) =>
          (filters.status === 'all' || request.status === filters.status) &&
          Date.parse(request.submittedAt) >= from &&
          Date.parse(request.submittedAt) < to,
      )
      .map((request) => ({
        partnerLabel: entry.label,
        request,
        href: requestHref(entry.id, request.requestRef),
      }));
  });
  const hasFilter = filters.status !== 'all' || filters.from !== '' || filters.toExclusive !== '';
  return (
    <StaffWithdrawalQueue
      rows={rows}
      partnerOptions={roster.map(({ id, label }) => ({ id, label }))}
      filters={filters}
      onFiltersChange={onFiltersChange}
      state={state}
      filterError={issue}
      emptyKind={hasFilter ? 'filtered' : 'history'}
      onRetry={
        targets.length
          ? () => {
              for (const query of lists) void query.refetch();
            }
          : undefined
      }
    />
  );
}
