import { z } from 'zod';
import { Id, Instant } from './common';
import { RegistrationScope } from './ad-registration';
export const ConnectionCommand = RegistrationScope.extend({
  connectionId: Id,
  revision: z.string().regex(/^[1-9]\d*$/),
  action: z.enum(['verify', 'pause', 'retry']),
  idempotencyKey: z.uuid(),
});
export const ConnectionResult = z.strictObject({
  connectionId: Id,
  revision: Id,
  enabled: z.boolean(),
  replayed: z.boolean(),
});
export const VerifiedAccount = z.strictObject({
  accountId: Id,
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: Id,
  apiVersion: Id,
  checkedAt: Instant,
});
export const ConnectionsSnapshot = RegistrationScope.extend({
  connections: z
    .array(
      z.strictObject({
        id: Id,
        label: Id,
        platform: z.enum(['facebook', 'tiktok']),
        accountId: Id,
        revision: Id,
        enabled: z.boolean(),
        configured: z.boolean(),
        verifiedAt: Instant.nullable(),
        jobs: z.number().int().nonnegative(),
        attention: z.number().int().nonnegative(),
        retryable: z.number().int().nonnegative().optional(),
        lastSuccessAt: Instant.nullable(),
      }),
    )
    .max(100),
});
