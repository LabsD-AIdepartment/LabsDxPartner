import type { SessionValue } from '@/contracts/session';
import { Id } from '@/contracts/common';

// A selection is a preference, never an authorization grant. Bind it to the login identity.
export const PARTNER_COOKIE = '__Host-labsd-partner';
export function selectSessionPartner(session: SessionValue, cookie?: string): SessionValue {
  try {
    const [userId, partnerId] = JSON.parse(decodeURIComponent(cookie ?? ''));
    if (userId === session.userId && session.memberships.some((m) => m.partnerId === partnerId))
      return { ...session, activePartnerId: partnerId };
  } catch {
    /* Missing or stale preferences use the server-selected active membership. */
  }
  return session;
}
export function partnerCookie(session: SessionValue): string {
  const value = encodeURIComponent(
    JSON.stringify([session.userId, Id.parse(session.activePartnerId)]),
  );
  return `${PARTNER_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
export function readPartnerCookie(headers: Headers): string | undefined {
  return headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${PARTNER_COOKIE}=`))
    ?.slice(PARTNER_COOKIE.length + 1);
}
