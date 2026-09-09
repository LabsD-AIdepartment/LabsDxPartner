import { createHash } from 'node:crypto';
import { z } from 'zod';

const subjectSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value.trim() === value && !value.includes('\u0000'));
/** Auth storage only. Never use this address as contact, recovery, membership or linking evidence. */
export function authOnlyEmail(namespace: string, subject: unknown): string {
  const parsed = subjectSchema.safeParse(subject);
  if (!parsed.success) throw new Error('Invalid provider subject');
  return `${createHash('sha256')
    .update(JSON.stringify([namespace, parsed.data]))
    .digest('hex')}@identity.invalid`;
}
export function isAuthOnlyEmail(email: string): boolean {
  return email.toLowerCase().endsWith('.invalid');
}

export function mapProfile(
  namespace: string,
  profile: { sub: unknown; email?: unknown; email_verified?: unknown; name?: unknown },
  provider: 'line' | 'apple' | 'google',
) {
  const fallback = authOnlyEmail(namespace, profile.sub);
  // LINE's approved scope is openid/profile; email is not requested or treated as verified.
  const candidate = provider === 'line' ? undefined : z.email().safeParse(profile.email);
  const email = candidate?.success && !isAuthOnlyEmail(candidate.data) ? candidate.data : fallback;
  return {
    email,
    emailVerified:
      email !== fallback && (profile.email_verified === true || profile.email_verified === 'true'),
    name:
      typeof profile.name === 'string' && profile.name.trim()
        ? profile.name.trim().slice(0, 200)
        : 'Partner',
  };
}
