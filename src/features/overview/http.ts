import { OverviewResponse } from '@/contracts/overview-http';
import { AccessLost } from '@/shared/query/revision-watcher';
import { SourceUnavailableError } from '@/shared/query/source-unavailable';
import type { OverviewTransport } from './model';

export const overviewHttp: OverviewTransport = async ({ scope, filters, signal }) => {
  const query = new URLSearchParams({ partnerId: scope.partnerId, permissionRevision: scope.permissionRevision,
    from: filters.from, toExclusive: filters.toExclusive, ...(filters.brand ? { brand: filters.brand } : {}) });
  const response = await fetch('/api/v1/partner/overview?' + query, { credentials: 'same-origin', cache: 'no-store', signal });
  if (response.status === 401 || response.status === 403) throw new AccessLost('Overview membership changed');
  if (response.status === 503) throw new SourceUnavailableError();
  if (!response.ok) throw new Error('Overview unavailable');
  const result = OverviewResponse.parse(await response.json());
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (result.partnerId !== scope.partnerId || result.permissionRevision !== scope.permissionRevision)
    throw new AccessLost('Overview response scope changed');
  if (result.brand !== filters.brand) throw new Error('Overview response brand changed');
  return result.data;
};
