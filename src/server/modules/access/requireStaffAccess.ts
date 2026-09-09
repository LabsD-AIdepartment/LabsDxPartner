import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getIdentityRuntime } from '../identity/runtime';
import { AccessFailure } from '../partners/access';
import { loginHref } from '@/shared/routing/partner-paths';
import type { StaffAccessSessionValue } from '@/contracts/staff-access';
export async function requireStaffAccess(): Promise<StaffAccessSessionValue> {
  try {
    const identity = getIdentityRuntime();
    if (!identity) throw new Error('Identity unavailable');
    await identity.assertBinding();
    return await identity.partners.staffSession(new Headers(await headers()));
  } catch (error) {
    if (error instanceof AccessFailure && error.code === 'unauthenticated')
      redirect(loginHref('/ops/access'));
    if (error instanceof AccessFailure && error.code === 'forbidden') redirect('/account');
    redirect('/access?reason=retry&next=%2Fops%2Faccess');
  }
}
