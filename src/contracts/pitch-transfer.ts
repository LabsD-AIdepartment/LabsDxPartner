import { z } from 'zod';
// Contains only the explicitly exported sample-wallet namespace, never browser credentials.
export const PitchTransfer = z.strictObject({
  version: z.literal(1),
  userId: z.string().min(1).max(200),
  partnerId: z.string().min(1).max(200),
  entries: z.array(z.strictObject({ key: z.string().min(1).max(2000), value: z.string().max(200000) })).max(20),
}).refine(value => new Set(value.entries.map(entry => entry.key)).size === value.entries.length);
export type PitchTransferValue = z.infer<typeof PitchTransfer>;
