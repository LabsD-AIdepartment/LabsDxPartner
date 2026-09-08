import { redirect } from 'next/navigation';
import { loginHref } from '@/shared/routing/partner-paths';
/** F03 deny-only gate. A03 replaces this with verified sessions and membership checks.
 * No query parameter, development flag, or cookie can grant access here. */
export function requirePartnerAccess(destination: string): never {
  redirect(loginHref(destination));
}
