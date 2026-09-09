import { NotificationResponse, SeenResponse } from '@/contracts/notifications-http';
import type { QueryScope } from '@/shared/query/keys';
import { AccessLost } from '@/shared/query/revision-watcher';
function checkScope(
  value: { userId: string; partnerId: string; permissionRevision: string },
  scope: QueryScope,
) {
  if (
    value.userId !== scope.userId ||
    value.partnerId !== scope.partnerId ||
    value.permissionRevision !== scope.permissionRevision
  )
    throw new AccessLost();
}
async function checked(response: Response, signal: AbortSignal) {
  if (response.status === 401 || response.status === 403) throw new AccessLost();
  if (!response.ok) throw new Error('Notifications unavailable');
  const value: unknown = await response.json();
  signal.throwIfAborted();
  return value;
}
export async function loadNotifications(
  scope: QueryScope,
  cursor: string | null,
  signal: AbortSignal,
) {
  const q = new URLSearchParams({
    partnerId: scope.partnerId,
    permissionRevision: scope.permissionRevision,
  });
  if (cursor) q.set('cursor', cursor);
  const response = await fetch('/api/v1/partner/notifications?' + q, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  const value = NotificationResponse.parse(await checked(response, signal));
  checkScope(value, scope);
  return value.data;
}
export async function markNotificationsSeen(
  scope: QueryScope,
  throughNoticeId: string,
  signal: AbortSignal,
) {
  const response = await fetch('/api/v1/partner/notifications/seen', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      partnerId: scope.partnerId,
      permissionRevision: scope.permissionRevision,
      throughNoticeId,
    }),
  });
  const value = SeenResponse.parse(await checked(response, signal));
  checkScope(value, scope);
  return value;
}
