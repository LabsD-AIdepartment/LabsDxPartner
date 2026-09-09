import type { z } from 'zod';
import type { PartnerCapability } from '@/contracts/access';
import type { QueryScope } from './keys';
import { AccessLost } from './revision-watcher';

export async function loadChanges(
  scope: QueryScope,
  capability: z.infer<typeof PartnerCapability>,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({
    partnerId: scope.partnerId,
    permissionRevision: scope.permissionRevision,
    capability,
  });
  const response = await fetch('/api/v1/partner/changes?' + query, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (response.status === 401 || response.status === 403)
    throw new AccessLost('Membership changed');
  if (!response.ok) throw new Error('Change metadata unavailable');
  return response.json();
}
