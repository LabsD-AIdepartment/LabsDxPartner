import { Overview, type OverviewValue } from '@/contracts/overview';
import { QueryFilters } from '@/contracts/common';
import type { FilterValue } from '@/shared/ui/FilterBar';
import type { QueryScope } from '@/shared/query/keys';
export type OverviewTransport = (request: {
  scope: QueryScope;
  filters: FilterValue;
  signal: AbortSignal;
}) => Promise<unknown>;
export const defaultOverviewFilters: FilterValue = {
  from: '2026-07-01',
  toExclusive: '2026-09-01',
  brand: null,
};
export function validateFilters(filters: FilterValue) {
  return QueryFilters.safeParse(filters).success;
}
export async function loadOverview(
  transport: OverviewTransport,
  request: Parameters<OverviewTransport>[0],
): Promise<OverviewValue> {
  if (!validateFilters(request.filters)) throw new Error('Invalid period');
  const data = Overview.parse(await transport(request));
  // A response for another date window must never appear underneath the selected filters.
  const expectedFrom = Date.parse(request.filters.from + 'T00:00:00+07:00');
  const expectedTo = Date.parse(request.filters.toExclusive + 'T00:00:00+07:00');
  if (
    Date.parse(data.earnings.period.from) !== expectedFrom ||
    Date.parse(data.earnings.period.toExclusive) !== expectedTo
  )
    throw new Error('Mismatched response period');
  return data;
}
export function earningsHref(path: string, data: OverviewValue, filters: FilterValue) {
  return `${path}?${new URLSearchParams({ generation: data.earnings.generation, origin: 'overview', from: filters.from, toExclusive: filters.toExclusive, ...(filters.brand ? { brand: filters.brand } : {}) })}`;
}
export function obligationHref(
  data: OverviewValue,
  statementId?: string,
  basePath = '/transactions',
  returnTo?: string,
) {
  return `${basePath}${statementId ? '/' + encodeURIComponent(statementId) : ''}?${new URLSearchParams({ obligationAsOf: data.obligation.asOf, ...(returnTo ? { returnTo } : {}) })}`;
}
export { timestamp, dateLabel } from '@/shared/ui/format-date';
