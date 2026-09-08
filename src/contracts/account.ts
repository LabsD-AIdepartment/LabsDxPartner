import { z } from 'zod';
import { Id } from './common';
import { Provider } from './session';
import { AgreementVersion } from './earnings';
export const Account = z.strictObject({
  userId: Id,
  displayName: z.string().min(1),
  agreement: AgreementVersion.nullable(),
  providers: z.array(z.strictObject({ provider: Provider, canUnlink: z.boolean() })).min(1),
  supportUrl: z
    .url()
    .refine((v) => v.startsWith('https://'))
    .nullable(),
});
