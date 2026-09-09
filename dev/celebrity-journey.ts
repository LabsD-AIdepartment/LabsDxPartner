import { z } from 'zod';
import { ActivateAccount } from '@/contracts/invitations';
import { ResetPassword, ChangePassword } from '@/contracts/passwords';
import { CredentialLogin } from '@/contracts/credentials';
import { CredentialError, type credentialRequest } from '@/features/login/credential-client';

/** Synthetic, memory-only lifecycle. Never an authentication backend or persistent account. */
export function createCelebrityJourney(now = () => Date.now()) {
  const newToken = () =>
    Array.from(
      crypto.getRandomValues(new Uint8Array(43)),
      (n) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[n % 64],
    ).join('');
  const invitation = { token: newToken(), expiresAt: now() + 7 * 86400000, used: false };
  let account: { username: string; digest: string } | null = null;
  let authenticated = false;
  let reset: { token: string; expiresAt: number; used: boolean } | null = null;
  const digest = async (value: string) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
  const assertInvite = (token: string) => {
    if (token !== invitation.token || invitation.used || now() >= invitation.expiresAt)
      throw new CredentialError('INVALID_INVITE');
  };
  const assertReset = (token: string) => {
    if (!reset || token !== reset.token || reset.used || now() >= reset.expiresAt || !account)
      throw new CredentialError('INVALID_RESET');
    return reset;
  };
  const request: typeof credentialRequest = async (path, input, schema, signal) => {
    signal?.throwIfAborted();
    let result: unknown;
    if (path === '/api/access/invitations/inspect') {
      const { token } = z.object({ token: z.string() }).parse(input);
      assertInvite(token);
      result = {
        partnerName: 'Labs D × คุณ · ดีลตัวอย่าง',
        recipientName: 'คุณ (ดาราพาร์ทเนอร์ตัวอย่าง)',
        expiresAt: new Date(invitation.expiresAt).toISOString(),
      };
    } else if (path === '/api/access/invitations/register') {
      const value = ActivateAccount.parse(input);
      assertInvite(value.token);
      if (account) throw new CredentialError('USERNAME_UNAVAILABLE');
      invitation.used = true;
      try {
        account = { username: value.username, digest: await digest(value.password) };
      } catch (error) {
        invitation.used = false;
        throw error;
      }
      result = {
        userId: 'preview-user',
        partnerId: 'preview-partner',
        membershipId: 'preview-member',
        status: 'active',
      };
    } else if (path === '/api/access/passwords/change') {
      const value = ChangePassword.parse(input);
      const candidate = account;
      if (!authenticated || !candidate) throw new CredentialError('UNAUTHENTICATED');
      if ((await digest(value.currentPassword)) !== candidate.digest || account !== candidate)
        throw new CredentialError('INVALID_PASSWORD');
      const nextDigest = await digest(value.password);
      if (!authenticated || account !== candidate) throw new CredentialError('UNAUTHENTICATED');
      account = { username: candidate.username, digest: nextDigest };
      authenticated = false;
      reset = null;
      result = { status: 'requires-login' };
    } else if (path === '/api/access/passwords/inspect') {
      const { token } = z.object({ token: z.string() }).parse(input);
      const current = assertReset(token);
      result = {
        username: account!.username,
        expiresAt: new Date(current.expiresAt).toISOString(),
      };
    } else if (path === '/api/access/passwords/reset') {
      const value = ResetPassword.parse(input);
      const current = assertReset(value.token);
      current.used = true;
      try {
        account = { username: account!.username, digest: await digest(value.password) };
        authenticated = false;
      } catch (error) {
        current.used = false;
        throw error;
      }
      result = { status: 'requires-login' };
    } else {
      throw new CredentialError('INVALID_INPUT');
    }
    signal?.throwIfAborted();
    return schema.parse(result);
  };
  return {
    request,
    invitationToken: invitation.token,
    get username() {
      return account?.username ?? null;
    },
    get authenticated() {
      return authenticated;
    },
    async signIn(username: string, password: string) {
      const value = CredentialLogin.parse({ username, password });
      const candidate = account;
      if (
        !candidate ||
        value.username !== candidate.username ||
        (await digest(value.password)) !== candidate.digest ||
        account !== candidate
      )
        throw new CredentialError('INVALID_USERNAME_OR_PASSWORD');
      authenticated = true;
      return { user: { id: 'preview-user' } };
    },
    logout() {
      authenticated = false;
    },
    issueReset() {
      if (!account) throw new CredentialError('INVALID_RESET');
      reset = { token: newToken(), expiresAt: now() + 1800000, used: false };
      return reset.token;
    },
  };
}
