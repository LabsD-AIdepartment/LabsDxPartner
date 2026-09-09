import type { z } from 'zod';
import type { OpsCapability } from '@/contracts/operations';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getIdentityRuntime } from '../identity/runtime';
import { AccessFailure } from '../partners/access';
import { loginHref } from '@/shared/routing/partner-paths';
import type { StaffAccessSessionValue } from '@/contracts/staff-access';
export async function requireStaffAccess(
  capability: z.infer<typeof OpsCapability> = 'manage_partners',
  next = '/ops/access',
): Promise<StaffAccessSessionValue> {
  try {
    const identity = getIdentityRuntime();
    if (!identity) throw new Error('Identity unavailable');
    await identity.assertBinding();
    return await identity.partners.withStaffCapability(
      new Headers(await headers()),
      capability,
      false,
      async (_tx, session) => session,
    );
  } catch (error) {
    if (error instanceof AccessFailure && error.code === 'unauthenticated')
      redirect(loginHref(next));
    if (error instanceof AccessFailure && error.code === 'forbidden') redirect('/account');
    redirect('/access?reason=retry&next=' + encodeURIComponent(next));
  }
}
