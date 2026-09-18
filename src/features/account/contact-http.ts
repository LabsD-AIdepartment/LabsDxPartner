import {
  ContactSnapshot,
  type AccountContactValue,
  type ContactSnapshotValue,
} from '@/contracts/account-contact';
import type { QueryScope } from '@/shared/query/keys';

export interface ContactTransport {
  read(scope: QueryScope, signal: AbortSignal): Promise<ContactSnapshotValue>;
  save(
    scope: QueryScope,
    revision: string,
    contact: AccountContactValue,
    signal: AbortSignal,
  ): Promise<ContactSnapshotValue>;
}
export class ContactRequestError extends Error {
  constructor(readonly status: number) {
    super('Contact request failed');
  }
}
export function scopedContact(input: unknown, scope: QueryScope) {
  const result = ContactSnapshot.parse(input);
  if (
    result.userId !== scope.userId ||
    result.partnerId !== scope.partnerId ||
    result.permissionRevision !== scope.permissionRevision
  )
    throw new Error('Contact scope mismatch');
  return result;
}
async function responseData(response: Response, scope: QueryScope) {
  if (!response.ok) throw new ContactRequestError(response.status);
  return scopedContact(await response.json(), scope);
}
export const contactHttp: ContactTransport = {
  async read(scope, signal) {
    const query = new URLSearchParams({
      partnerId: scope.partnerId,
      permissionRevision: scope.permissionRevision,
    });
    return responseData(
      await fetch('/api/v1/partner/account/contacts?' + query, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      }),
      scope,
    );
  },
  async save(scope, expectedRevision, contact, signal) {
    return responseData(
      await fetch('/api/v1/partner/account/contacts', {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          partnerId: scope.partnerId,
          expectedUserId: scope.userId,
          permissionRevision: scope.permissionRevision,
          expectedRevision,
          contact,
        }),
      }),
      scope,
    );
  },
};
