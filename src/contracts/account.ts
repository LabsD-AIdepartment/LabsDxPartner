import { z } from 'zod';
import { Id, Freshness } from './common';
import { PermissionRevision } from './access';
import { Username } from './credentials';
import { AgreementVersion } from './earnings';
export const Account = z.strictObject({
  userId: Id,
  displayName: z.string().min(1),
  username: Username,
  agreement: AgreementVersion.nullable(),
  termsSummary: z.string().min(1).nullable().default(null),
  supportUrl: z
    .url()
    .refine((v) => v.startsWith('https://'))
    .nullable(),
});
export const AccountResponse = Freshness.extend({
  revision: Id,
  partnerId: Id,
  permissionRevision: PermissionRevision,
  data: Account,
});
// Credential mutation belongs to the maintained identity service, not this metadata transport.
export const AccountAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('recover') }),
  z.strictObject({ action: z.literal('logout') }),
]);
export const AccountActionResult = z.strictObject({
  userId: Id,
  requestId: Id,
  status: z.enum(['complete', 'pending', 'requires-reauth', 'recovery-required']),
  message: z.string().min(1),
});
