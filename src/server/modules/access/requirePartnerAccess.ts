import { redirect } from 'next/navigation';
import { loginHref } from '@/shared/routing/partner-paths';
import { headers } from 'next/headers';
import { getIdentityRuntime } from '../identity/runtime';
import { AccessFailure } from '../partners/access';
import { readPartnerCookie, selectSessionPartner } from './partner-session';
import { accessHref } from '@/features/login/access';
import type { SessionValue } from '@/contracts/session';

/** Every leaf resolves maintained identity and current memberships. No cached cookie claims. */
export async function requirePartnerAccess(destination: string): Promise<SessionValue> {
  let session: SessionValue;
  try {
    const runtime = getIdentityRuntime();
    if (!runtime) throw new Error('Identity unavailable');
    await runtime.assertBinding();
    const incoming = new Headers(await headers());
    session = selectSessionPartner(
      await runtime.partners.session(incoming),
      readPartnerCookie(incoming),
    );
  } catch (error) {
    if (error instanceof AccessFailure && error.code === 'unauthenticated')
      redirect(loginHref(destination));
    redirect(accessHref('retry', destination));
  }
  return session;
}
