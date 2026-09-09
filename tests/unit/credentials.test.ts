import { describe, expect, it } from 'vitest';
import { CredentialLogin, NewPassword, Username } from '@/contracts/credentials';
import {
  readCredentialConfig,
  credentialBindingDigest,
} from '@/server/modules/identity/credential-auth';

describe('invitation credential contracts', () => {
  it('normalizes handles, preserves passwords exactly and rejects malformed input', () => {
    expect(Username.parse('  My.Name_1 ')).toBe('my.name_1');
    expect(CredentialLogin.parse({ username: 'person', password: ' password ' }).password).toBe(
      ' password ',
    );
    for (const name of ['ab', 'x'.repeat(31), 'two words', 'name@host', 'มดดำ', 'user\u200bname'])
      expect(Username.safeParse(name).success).toBe(false);
    expect(NewPassword.safeParse('x'.repeat(7)).success).toBe(false);
    expect(NewPassword.safeParse('x'.repeat(8)).success).toBe(true);
    expect(NewPassword.safeParse('x'.repeat(129)).success).toBe(false);
    expect(
      CredentialLogin.safeParse({ username: 'person', password: 'x', partnerId: 'other' }).success,
    ).toBe(false);
  });
  it('needs no social credentials; origin binds the deployment while secret rotation does not change it', () => {
    const env = {
      BETTER_AUTH_URL: 'https://partner.example.test',
      BETTER_AUTH_SECRET: 'synthetic-only-secret-with-at-least-32-chars',
      DATABASE_URL: 'postgresql://127.0.0.1/test',
    };
    const config = readCredentialConfig(env);
    expect(Object.keys(config).sort()).toEqual([
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'DATABASE_URL',
    ]);
    expect(credentialBindingDigest(config)).toBe(
      credentialBindingDigest({ ...config, BETTER_AUTH_SECRET: 'rotated-synthetic-secret' }),
    );
    expect(credentialBindingDigest(config)).not.toBe(
      credentialBindingDigest({ ...config, BETTER_AUTH_URL: 'https://other.example.test' }),
    );
    expect(() =>
      readCredentialConfig({ ...env, BETTER_AUTH_URL: 'http://localhost:4187' }),
    ).toThrow('Identity configuration is incomplete or invalid');
    try {
      readCredentialConfig({ BETTER_AUTH_SECRET: 'do-not-print' });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('do-not-print');
    }
  });
});
