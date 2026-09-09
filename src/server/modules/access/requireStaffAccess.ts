import { redirect } from 'next/navigation';
/** Deny-only until A02/A03 verify staff sessions and current capabilities on the server. */
export function requireStaffAccess(): never {
  redirect('/login');
}
