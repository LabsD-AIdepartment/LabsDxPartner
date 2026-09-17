import { z } from 'zod';
import { Id } from '@/contracts/common';
const Users = z
  .array(Id)
  .max(100)
  .transform((ids) => [...ids].sort());
/** Trusted operator input, deliberately not an HTTP/browser contract. No credentials or source IDs. */
export const ProvisionCommand = z
  .strictObject({
    schemaVersion: z.literal(1),
    commandId: z.uuid(),
    operatorRef: Id,
    evidenceRef: z.string().min(1).max(500),
    connectionId: Id,
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(40)
      .nullable(),
    label: Id,
    grantUserIds: Users,
    revokeUserIds: Users,
  })
  .refine(
    (c) =>
      new Set([...c.grantUserIds, ...c.revokeUserIds]).size ===
      c.grantUserIds.length + c.revokeUserIds.length,
    'Grant and revoke IDs must be unique and disjoint',
  );
export class ProvisionFailure extends Error {
  constructor(
    public code:
      | 'invalid-input'
      | 'not-configured'
      | 'identity-mismatch'
      | 'stale-plan'
      | 'ineligible-staff'
      | 'command-conflict',
  ) {
    super(code);
  }
}
export function parseProvisionCommand(raw: unknown) {
  const parsed = ProvisionCommand.safeParse(raw);
  if (!parsed.success) throw new ProvisionFailure('invalid-input');
  return parsed.data;
}
