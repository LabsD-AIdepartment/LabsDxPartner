import { z } from 'zod';
import { Id, Instant } from './common';
import { Provider } from './session';

export const MethodRevision = z.string().regex(/^[a-f0-9]{64}$/);
export const UnlinkMethod = z.strictObject({ accountId: Id, expectedRevision: MethodRevision, idempotencyKey: Id });
export const IdentityMethod = z.strictObject({ id: Id, provider: Provider, connectedAt: Instant, canUnlink: z.boolean() });
