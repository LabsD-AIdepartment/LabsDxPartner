import { z } from 'zod';
import { Id, Freshness } from './common';
import { Provider } from './session';
import { AgreementVersion } from './earnings';
export const Account = z.strictObject({
  userId: Id,
  displayName: z.string().min(1),
  agreement: AgreementVersion.nullable(),
  termsSummary: z.string().min(1).nullable().default(null),
  providers: z.array(z.strictObject({ provider: Provider, canUnlink: z.boolean() })).min(1),
  supportUrl: z
    .url()
    .refine((v) => v.startsWith('https://'))
    .nullable(),
});
export const AccountResponse = Freshness.extend({ revision: Id, data: Account });
export const AccountAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('link'), provider: Provider }),
  z.strictObject({ action: z.literal('unlink'), provider: Provider }),
  z.strictObject({ action: z.literal('recover') }),
  z.strictObject({ action: z.literal('logout') }),
]);
export const AccountActionResult = z.strictObject({
  userId: Id,
  requestId: Id,
  status: z.enum([
    'complete',
    'pending',
    'requires-reauth',
    'conflict',
    'last-method',
    'recovery-required',
  ]),
  message: z.string().min(1),
});
